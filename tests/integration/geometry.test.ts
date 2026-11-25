import { beforeAll, afterAll, expect, it } from 'vitest';
import { database as db, prisma } from '@tuheng/database';
import {
  createQuestion,
  createAssignment,
  publishAssignment,
  saveDraft,
  submitAnswer,
  viewAttempt,
  type Actor,
} from '@tuheng/domain';
import { GradingRequest, GradingResult } from '@tuheng/contracts';
import {
  addDrawing,
  addCurve,
  createDocument,
  moveEntities,
  addProjectionAxis,
  constructLine,
  transact,
} from '@tuheng/geometry-core';
import { executeGradingRun } from '../../packages/infrastructure/src/grading-runner';
import { MockVisionProvider } from '@tuheng/ai-providers';
import { aiFixture } from '../ai-fixture';
import { requestFixture, evaluationFixture } from '../fixtures';
beforeAll(async () => {
  const ai = await aiFixture();
  await ai.bind('grading.assignment');
});
afterAll(() => prisma.$disconnect());
it.each([false, true])(
  'freezes geometry answers (curve=%s), denies stem tampering and cross-student access, and passes structured evidence through the existing worker',
  async (withCurve) => {
    const teacher: Actor = {
        id: 'teacher',
        name: '教师',
        roles: ['TEACHER'],
        kind: 'TEACHER',
        realm: 'STAFF',
        schoolId: 'school-demo',
      },
      student: Actor = {
        id: 'student',
        name: '学生',
        roles: ['STUDENT'],
        kind: 'STUDENT',
        realm: 'STUDENT',
        schoolId: 'school-demo',
      },
      other: Actor = {
        id: 'student2',
        name: '其他学生',
        roles: ['STUDENT'],
        kind: 'STUDENT',
        realm: 'STUDENT',
        schoolId: 'school-demo',
      };
    const fixture = requestFixture();
    const stem = addDrawing(
      createDocument('VHW_PROJECTION'),
      'segment',
      'view-0',
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      'teacher',
    );
    const questionInput = {
      title: `[自动化测试]几何 ${Date.now()}`,
      content: fixture.question.content,
      type: 'POINT_PROJECTION',
      chapter: '几何测试',
      knowledgeIds: ['point'],
      assetIds: [],
      reference: fixture.reference,
      rubric: fixture.rubric,
      confirmed: true,
      geometryDocument: stem,
    };
    const q = await createQuestion(db, teacher, questionInput);
    const assignment = await createAssignment(db, teacher, {
      title: q.title,
      classId: 'class-demo',
      questionVersionIds: [q.id],
      startsAt: new Date(Date.now() - 60000),
      dueAt: new Date(Date.now() + 86400000),
      allowLate: false,
      maxAttempts: 3,
      releaseAnswers: false,
    });
    await publishAssignment(db, teacher, assignment.id);
    const item = (await db.list('assignmentItem', { assignmentId: assignment.id }))[0];
    let answer = addDrawing(
      stem,
      'hidden',
      'view-1',
      [
        { x: 4, y: 5 },
        { x: 14, y: 5 },
      ],
      'student',
    );
    answer = addProjectionAxis(
      answer,
      {
        name: 'X1',
        viewName: 'V1',
        retainedViewId: 'view-1',
        replacedViewId: 'view-0',
        parentId: null,
        method: 'PARALLEL',
        referenceEntityId: answer.entities.at(-1)!.id,
        anchor: { x: -40, y: -20 },
        through: { x: -20, y: -20 },
        side: 1,
      },
      'student',
    );
    answer = constructLine(
      answer,
      'view-1',
      { kind: 'projectionAxis', systemId: answer.auxiliarySystems![0].id },
      { x: 30, y: 15 },
      undefined,
      {
        directionMode: 'PERPENDICULAR',
        geometryExtent: 'segment',
        semanticStyle: 'visible',
        length: 10,
      },
      'student',
    );
    expect(answer.schemaVersion).toBe('tuheng.geometry/3.0.0');
    answer = transact(
      answer,
      (draft) => {
        const segment = stem.entities.find((e) => e.kind === 'segment')!;
        const common = {
          viewId: segment.viewId,
          layerId: 'answer',
          lineStyle: 'ANSWER_VISIBLE',
        } as const;
        draft.entities.push(
          {
            ...common,
            id: 'cad-ellipse',
            kind: 'ellipse',
            center: segment.startPoint,
            majorRadius: 8,
            minorRadius: 4,
            angle: 23,
            startAngle: 0,
            sweep: 360,
          },
          {
            ...common,
            id: 'cad-dimension',
            kind: 'dimension',
            dimensionType: 'ALIGNED',
            referenceIds: [segment.startPoint, segment.endPoint],
            position: { x: 2, y: 3 },
            precision: 2,
            textOverride: '100',
            arrowStyle: 'OPEN',
            textSize: 2,
          },
          {
            ...common,
            id: 'cad-text',
            kind: 'text',
            position: { x: 2, y: 4 },
            angle: 15,
            size: 4,
            content: '作答说明',
          },
          {
            ...common,
            id: 'cad-hatch',
            kind: 'hatch',
            loops: [['cad-ellipse']],
            angle: 45,
            origin: { x: 0, y: 0 },
            spacing: 1,
          },
          {
            ...common,
            id: 'cad-datum',
            kind: 'engineeringAnnotation',
            annotationType: 'DATUM',
            fields: ['A'],
            position: { x: 3, y: 4 },
            angle: 0,
            size: 3,
          },
          {
            ...common,
            id: 'cad-direction',
            kind: 'symbol',
            symbolType: 'RIGHT_ROTATION',
            position: { x: 4, y: 4 },
            angle: 35,
            size: 3,
          },
        );
      },
      'student',
    );
    if (withCurve) {
      answer = addCurve(
        answer,
        'view-0',
        [
          { x: 0, y: 0 },
          { x: 5, y: 6 },
          { x: 10, y: 0 },
        ],
        'student',
        [stem.entities[0].id, '', stem.entities[1].id],
      );
      expect(answer.schemaVersion).toBe('tuheng.geometry/3.0.0');
    }
    const badReference = structuredClone(answer);
    badReference.referenceRelations![0].reference = {
      kind: 'projectionAxis',
      systemId: 'does-not-exist',
    };
    await expect(saveDraft(db, student, item.id, [], badReference)).rejects.toThrow();
    const forgedAxis = structuredClone(answer);
    forgedAxis.views[0].transform!.origin.x = 3;
    await expect(saveDraft(db, student, item.id, [], forgedAxis)).rejects.toMatchObject({
      code: 'GEOMETRY_STEM_CHANGED',
    });
    const forgedRelation = structuredClone(answer);
    forgedRelation.referenceRelations!.push({
      id: crypto.randomUUID(),
      kind: 'POINT_ON_REFERENCE',
      targetId: stem.entities[0].id,
      reference: { kind: 'baseAxis', axisId: 'X' },
      mode: 'POSITION',
      source: 'USER',
      status: 'SATISFIED',
    });
    await expect(saveDraft(db, student, item.id, [], forgedRelation)).rejects.toMatchObject({
      code: 'GEOMETRY_STEM_CHANGED',
    });
    const submission = await saveDraft(db, student, item.id, [], answer);
    expect(submission.draftGeometry).toEqual(answer);
    const tampered = moveEntities(answer, [stem.entities[0].id], { x: 2, y: 0 }, 'teacher');
    await expect(
      submitAnswer(db, student, {
        itemId: item.id,
        assetIds: [],
        geometry: tampered,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'GEOMETRY_STEM_CHANGED' });
    await expect(
      submitAnswer(db, student, {
        itemId: item.id,
        assetIds: [],
        geometry: stem,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'ANSWER_EVIDENCE_REQUIRED' });
    const key = crypto.randomUUID();
    const [attempt, retry] = await Promise.all(
      [0, 1].map(() =>
        submitAnswer(db, student, {
          itemId: item.id,
          assetIds: [],
          geometry: answer,
          idempotencyKey: key,
        }),
      ),
    );
    expect(attempt.id).toBe(retry.id);
    expect(attempt.geometryAnswer).toEqual(answer);
    await expect(viewAttempt(db, other, attempt.id)).rejects.toMatchObject({ status: 403 });
    const changed = addDrawing(stem, 'point', 'view-2', [{ x: 30, y: 20 }], 'teacher');
    const next = await createQuestion(
      db,
      teacher,
      { ...questionInput, geometryDocument: changed },
      false,
      q.questionId,
    );
    expect(next.version).toBe(2);
    expect((await db.get('questionVersion', q.id))?.geometryDocument).toEqual(stem);
    await saveDraft(
      db,
      student,
      item.id,
      [],
      addDrawing(answer, 'point', 'view-2', [{ x: 10, y: 20 }], 'student'),
    );
    expect((await db.get('submissionAttempt', attempt.id))?.geometryAnswer).toEqual(answer);
    const run = (await db.list('gradingRun', { attemptId: attempt.id }))[0];
    const request = GradingRequest.parse(run.request);
    expect(request.submissionAssets).toEqual([]);
    expect(request.geometryEvidence?.narrative).toContain('线');
    expect(request.geometryEvidence?.problemDocument).toEqual(stem);
    const evaluation = evaluationFixture();
    const cited = request.geometryEvidence!.derivedRelations[0];
    expect(cited?.entityIds.length).toBeGreaterThan(1);
    evaluation.geometryAnnotations = [
      {
        errorId: 'e1',
        entityIds: [answer.entities.at(-1)!.id],
        relationIds: [cited.id],
        explanation: '测试定位',
      },
      { errorId: null, entityIds: ['missing'], relationIds: [], explanation: '应过滤' },
    ];
    await executeGradingRun(run.id, {
      testMode: true,
      provider: new MockVisionProvider(evaluation),
    });
    expect((await db.get('gradingRun', run.id))?.status).toBe('SUCCEEDED');
    const suggestion = (await db.list('gradingSuggestion', { runId: run.id }))[0];
    const result = GradingResult.parse(suggestion.result);
    expect(result.geometryAnnotations).toHaveLength(1);
    const review = await viewAttempt(db, teacher, attempt.id);
    expect(review.suggestions[0].geometryHighlights[0]).toEqual([
      ...new Set([answer.entities.at(-1)!.id, ...cited.entityIds]),
    ]);
    expect(result.versions.prompt).toBe('geometry-review/1.5.0');
    expect(request.geometryEvidence?.narrative).toContain('实际测量值 10 mm');
    expect(request.geometryEvidence?.narrative).toContain('用户覆盖文字 "100"');
    expect(request.geometryEvidence?.answerDocument.entities.map((e) => e.kind)).toEqual(
      expect.arrayContaining([
        'ellipse',
        'dimension',
        'text',
        'symbol',
        'engineeringAnnotation',
        'hatch',
      ]),
    );
    if (withCurve) {
      expect(request.geometryEvidence?.narrative).toContain('插值曲线');
      expect(request.geometryEvidence?.answerDocument.entities.at(-1)?.kind).toBe('curve');
    }
    expect(
      request.geometryEvidence?.answerDocument.referenceRelations?.[0].reference,
    ).toMatchObject({
      kind: 'projectionAxis',
    });
    expect((await db.get('submissionAttempt', attempt.id))?.publishedDecisionId).toBeNull();
    expect(await db.list('gradeDecision', { attemptId: attempt.id })).toHaveLength(0);
  },
);
