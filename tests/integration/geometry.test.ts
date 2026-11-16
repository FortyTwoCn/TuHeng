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
    expect(answer.schemaVersion).toBe('tuheng.geometry/2.1.0');
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
      expect(answer.schemaVersion).toBe('tuheng.geometry/2.2.0');
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
    evaluation.geometryAnnotations = [
      {
        errorId: 'e1',
        entityIds: [answer.entities.at(-1)!.id],
        relationIds: [],
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
    expect(result.versions.prompt).toBe(
      withCurve ? 'geometry-review/1.4.0' : 'geometry-review/1.3.0',
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
