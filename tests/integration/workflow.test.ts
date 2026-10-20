import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { Worker, QueueEvents } from 'bullmq';
import sharp from 'sharp';
import { hash } from 'bcryptjs';
import { database as db, prisma } from '@tuheng/database';
import * as domain from '@tuheng/domain';
import type { Actor } from '@tuheng/domain';
import {
  uploadAsset,
  downloadAsset,
  ensureBucket,
  dispatchOutbox,
  queueFor,
  redisOptions,
} from '@tuheng/infrastructure';
import {
  executeGradingRun,
  recoverExpiredRuns,
} from '../../packages/infrastructure/src/grading-runner';
import { MockVisionProvider } from '@tuheng/ai-providers';
import { requestFixture, evaluationFixture } from '../fixtures';
const tag = `IT-${Date.now()}`;
process.env.QUEUE_NAMESPACE = tag;
let teacher: Actor,
  student: Actor,
  other: Actor,
  outsider: Actor,
  admin: Actor,
  classId: string,
  questionId: string,
  assignmentId: string,
  itemId: string,
  assetId: string,
  attemptId: string,
  decisionId: string;
async function makeActor(name: string, roles: Actor['roles']) {
  const u = await db.create('user', {
    name: `[自动化测试]${name}`,
    email: `${name}-${tag}@test.invalid`,
    passwordHash: await hash('Integration-Only-2026!', 4),
    roles,
  });
  return { id: u.id, name: u.name, roles };
}
beforeAll(async () => {
  await ensureBucket();
  teacher = await makeActor('teacher', ['TEACHER']);
  student = await makeActor('student', ['STUDENT']);
  other = await makeActor('other', ['STUDENT']);
  outsider = await makeActor('outsider', ['TEACHER']);
  admin = await makeActor('admin', ['ADMIN']);
  const course = await db.create('course', { title: `[自动化测试]${tag}`, code: tag });
  const offering = await db.create('courseOffering', { courseId: course.id, term: tag });
  const cls = await db.create('teachingClass', {
    offeringId: offering.id,
    name: `[自动化测试]${tag}`,
  });
  classId = cls.id;
  await db.create('teachingGrant', { userId: teacher.id, classId });
  for (const a of [student, other]) await db.create('enrollment', { userId: a.id, classId });
});
afterAll(async () => {
  const formal = queueFor('formal'),
    self = queueFor('selftest');
  await formal.obliterate({ force: true });
  await self.obliterate({ force: true });
  await formal.close();
  await self.close();
  await prisma.$disconnect();
});
describe.sequential(
  'real PostgreSQL + Redis + S3 workflow; model adapter explicitly MOCK_TEST_ONLY',
  () => {
    it('creates a verified version and publishes a frozen assignment', async () => {
      const f = requestFixture();
      const image = await sharp({
        create: { width: 1000, height: 1000, channels: 3, background: 'white' },
      })
        .png()
        .toBuffer();
      const stem = await uploadAsset(
        teacher,
        { name: '自动化测试-题干.png', bytes: image, mime: 'image/png' },
        'QUESTION',
      );
      const ref = await uploadAsset(
        teacher,
        { name: '自动化测试-参考.png', bytes: image, mime: 'image/png' },
        'REFERENCE',
      );
      const q = await domain.createQuestion(db, teacher, {
        title: `[自动化测试] ${tag} 点投影`,
        content: f.question.content,
        type: 'POINT_PROJECTION',
        chapter: '自动化测试专用',
        knowledgeIds: ['point'],
        assetIds: [stem.id],
        reference: { ...f.reference, assetIds: [ref.id] },
        rubric: f.rubric,
        confirmed: true,
      });
      questionId = q.id;
      const a = await domain.createAssignment(db, teacher, {
        title: `[自动化测试]${tag}`,
        classId,
        questionVersionIds: [q.id],
        startsAt: new Date(Date.now() - 60000),
        dueAt: new Date(Date.now() + 86400000),
        allowLate: false,
        maxAttempts: 2,
        releaseAnswers: false,
      });
      assignmentId = a.id;
      await domain.publishAssignment(db, teacher, a.id);
      itemId = (await db.list('assignmentItem', { assignmentId: a.id }))[0].id;
      expect(
        (await domain.assignmentDetails(db, student, a.id)).items[0].question.reference.assetIds,
      ).toEqual([]);
      await expect(downloadAsset(student, ref.id)).rejects.toMatchObject({ status: 403 });
    });
    it('saves actual bytes privately and creates an immutable attempt, job and outbox', async () => {
      const image = await sharp({
        create: { width: 900, height: 900, channels: 3, background: 'white' },
      })
        .png()
        .toBuffer();
      const asset = await uploadAsset(
        student,
        { name: '自动化测试-作答.png', bytes: image, mime: 'image/png' },
        'SUBMISSION',
      );
      assetId = asset.id;
      expect((await downloadAsset(student, asset.id)).buffer.equals(image)).toBe(true);
      await domain.saveDraft(db, student, itemId, [asset.id]);
      const at = await domain.submitAnswer(db, student, {
        itemId,
        assetIds: [asset.id],
        idempotencyKey: crypto.randomUUID(),
      });
      attemptId = at.id;
      const run = (await db.list('gradingRun', { attemptId }))[0];
      expect(run.status).toBe('QUEUED');
      expect((await db.list('outboxEvent', { runId: run.id }))[0].deliveredAt).toBeNull();
    });
    it('does not duplicate concurrent network retries', async () => {
      const key = crypto.randomUUID();
      const [a, b] = await Promise.all([
        domain.submitAnswer(db, student, { itemId, assetIds: [assetId], idempotencyKey: key }),
        domain.submitAnswer(db, student, { itemId, assetIds: [assetId], idempotencyKey: key }),
      ]);
      expect(a.id).toBe(b.id);
      expect(
        await db.list('submissionAttempt', { ownerId: student.id, idempotencyKey: key }),
      ).toHaveLength(1);
    });
    it('processes real BullMQ delivery through the test-only visual provider', async () => {
      const run = (await db.list('gradingRun', { attemptId }))[0];
      const evaluation = evaluationFixture();
      const queue = queueFor('formal');
      const events = new QueueEvents(queue.name, { connection: redisOptions() });
      await events.waitUntilReady();
      const worker = new Worker(
        queue.name,
        async (job) =>
          executeGradingRun(job.data.runId, {
            provider: new MockVisionProvider(evaluation),
            testMode: true,
          }),
        { connection: redisOptions(), concurrency: 1 },
      );
      try {
        await dispatchOutbox([run.id]);
        const job = await queue.getJob(run.id);
        expect(job).not.toBeUndefined();
        await job!.waitUntilFinished(events, 20000);
        const updated = await db.get('gradingRun', run.id);
        expect(updated?.status).toBe('SUCCEEDED');
        const suggestion = (await db.list('gradingSuggestion', { runId: run.id }))[0];
        expect((suggestion.result as { versions: { model: string } }).versions.model).toBe(
          'MOCK_TEST_ONLY',
        );
        expect(await db.list('gradeDecision', { attemptId })).toHaveLength(0);
      } finally {
        await worker.close();
        await events.close();
        await queue.close();
      }
    });
    it('AI suggestions remain hidden from students until formal publication', async () => {
      const view = await domain.viewAttempt(db, student, attemptId);
      expect(view.suggestions).toHaveLength(0);
      expect(view.decisions).toHaveLength(0);
      expect((await domain.viewAttempt(db, teacher, attemptId)).suggestions).toHaveLength(1);
    });
    it('isolates students, other teachers, admins and operators', async () => {
      await expect(domain.viewAttempt(db, other, attemptId)).rejects.toMatchObject({ status: 403 });
      await expect(domain.viewAttempt(db, outsider, attemptId)).rejects.toMatchObject({
        status: 403,
      });
      await expect(domain.viewAttempt(db, admin, attemptId)).rejects.toMatchObject({ status: 403 });
      await expect(downloadAsset(other, assetId)).rejects.toMatchObject({ status: 403 });
      await expect(downloadAsset(admin, assetId)).rejects.toMatchObject({ status: 403 });
      await expect(downloadAsset(outsider, assetId)).rejects.toMatchObject({ status: 403 });
      expect((await downloadAsset(teacher, assetId)).asset.id).toBe(assetId);
    });
    it('reviews item scores, publishes once, creates traceable error and knowledge evidence', async () => {
      const d = await domain.reviewGrade(db, teacher, {
        attemptId,
        items: [
          { criterionId: 'geometry', points: 76, evidence: '教师确认宽度转移存在局部偏差' },
          { criterionId: 'drawing', points: 18, evidence: '教师确认辅助线粗细不一致' },
        ],
        feedback: '按宽相等规律核对第三投影。',
        annotations: [],
        aiIncorrect: false,
      });
      decisionId = d.id;
      await domain.publishGrade(db, teacher, d.id);
      await domain.publishGrade(db, teacher, d.id);
      const view = await domain.viewAttempt(db, student, attemptId);
      expect(view.decisions[0]?.points).toBe(94);
      expect(await domain.listErrors(db, student)).toHaveLength(1);
      expect(await db.list('knowledgeEvidence', { decisionId: d.id })).toHaveLength(1);
    });
    it('new AI execution cannot overwrite published grades', async () => {
      const run = (await db.list('gradingRun', { attemptId }))[0];
      await executeGradingRun(run.id, {
        provider: new MockVisionProvider(evaluationFixture()),
        testMode: true,
      });
      expect((await db.get('submissionAttempt', attemptId))?.publishedDecisionId).toBe(decisionId);
      expect(await db.list('gradingSuggestion', { runId: run.id })).toHaveLength(1);
    });
    it('preserves grade corrections and avoids counting obsolete knowledge evidence', async () => {
      await domain.appealGrade(db, student, attemptId, '辅助线线型符合要求，请老师重新检查。');
      const d = await domain.reviewGrade(db, teacher, {
        attemptId,
        items: [
          { criterionId: 'geometry', points: 76, evidence: '宽度局部偏差仍成立' },
          { criterionId: 'drawing', points: 20, evidence: '复查确认图线正确' },
        ],
        feedback: '申诉已复查，图线项更正为满分。',
        annotations: [],
        aiIncorrect: true,
      });
      expect(d.revision).toBe(2);
      await domain.publishGrade(db, teacher, d.id);
      expect(await db.list('gradeDecision', { attemptId })).toHaveLength(2);
      expect((await domain.mastery(db, student)).find((k) => k.id === 'point')?.earned).toBe(96);
      const appeal = (await db.list('appeal', { attemptId }))[0];
      await domain.resolveAppeal(db, teacher, appeal.id, '已复查并更正图线项评分。');
    });
    it('archiving mistakes preserves scores and submission history', async () => {
      const e = (await domain.listErrors(db, student))[0];
      await domain.archiveErrors(db, student, [e.id]);
      expect(await domain.listErrors(db, student)).toHaveLength(0);
      expect((await db.get('submissionAttempt', attemptId))?.publishedDecisionId).toBeTruthy();
      await domain.collectError(db, student, attemptId);
      expect(await domain.listErrors(db, student)).toHaveLength(1);
    });
    it('private selftests reuse core and cannot claim teacher verification', async () => {
      const f = requestFixture();
      const set = await domain.createSelfTest(db, student, {
        title: `[自动化测试]自测 ${tag}`,
        folderId: null,
        mode: 'QUESTION_ONLY',
        question: {
          title: '[自动化测试]私人点投影',
          content: f.question.content,
          type: 'POINT_PROJECTION',
          chapter: '自测',
          knowledgeIds: ['point'],
          assetIds: [],
          reference: f.reference,
          rubric: f.rubric,
          confirmed: true,
        },
      });
      const item = (await db.list('selfTestItem', { setId: set.id }))[0];
      const q = await db.get('questionVersion', item.questionVersionId);
      expect(q?.reference.verified).toBe(false);
      const before = (await db.get('submissionAttempt', attemptId))?.publishedDecisionId;
      const at = await domain.submitAnswer(db, student, {
        selfTestItemId: item.id,
        assetIds: [assetId],
        idempotencyKey: crypto.randomUUID(),
      });
      await expect(domain.viewAttempt(db, other, at.id)).rejects.toMatchObject({ status: 403 });
      await expect(
        domain.reviewGrade(db, teacher, {
          attemptId: at.id,
          items: [],
          feedback: 'forbidden',
          annotations: [],
        }),
      ).rejects.toMatchObject({ status: 403 });
      expect((await db.get('submissionAttempt', attemptId))?.publishedDecisionId).toBe(before);
    });
    it('missing API credentials yield explicit blocked status, never fabricated score', async () => {
      const run = (await db.list('gradingRun', { attemptId }))[0];
      const config = await db.create('modelConfigurationVersion', {
        provider: 'test-unconfigured',
        model: '',
        baseUrl: 'https://unit.invalid',
        outputMode: 'json_object',
        timeoutMs: 1000,
        concurrency: 1,
        keyEnv: 'TUHENG_TEST_MISSING_KEY',
        active: false,
      });
      const id = crypto.randomUUID();
      await db.create('gradingRun', {
        id,
        attemptId,
        configId: config.id,
        status: 'QUEUED',
        strategyVersion: run.strategyVersion,
        promptVersion: run.promptVersion,
        request: { ...(run.request as object), runId: id, modelConfigId: config.id },
      });
      await db.create('backgroundJob', { runId: id, lane: 'formal' });
      await executeGradingRun(id);
      expect((await db.get('gradingRun', id))?.status).toBe('BLOCKED_CONFIG');
      expect(await db.list('gradingSuggestion', { runId: id })).toHaveLength(0);
    });
    it('recovers expired worker leases without mutating grades', async () => {
      const run = (await db.list('gradingRun', { attemptId }))[0];
      const id = crypto.randomUUID();
      await db.create('gradingRun', {
        id,
        attemptId,
        configId: run.configId,
        status: 'RUNNING',
        leaseUntil: new Date(Date.now() - 1000),
        leaseToken: 'dead-worker',
        strategyVersion: run.strategyVersion,
        promptVersion: run.promptVersion,
        request: { ...(run.request as object), runId: id },
      });
      await db.create('backgroundJob', {
        runId: id,
        lane: 'formal',
        attempts: 1,
        status: 'RUNNING',
      });
      await db.create('outboxEvent', { runId: id, lane: 'formal', deliveredAt: new Date() });
      await recoverExpiredRuns();
      expect((await db.get('gradingRun', id))?.status).toBe('RETRYING');
      expect((await db.list('outboxEvent', { runId: id }))[0].deliveredAt).toBeNull();
    });
    it('published assignment version remains unchanged when question evolves', async () => {
      const q = await db.get('questionVersion', questionId);
      const newer = await domain.createQuestion(
        db,
        teacher,
        { ...q, title: '[自动化测试]新版题目' },
        false,
        q!.questionId,
      );
      expect(newer.version).toBe(2);
      expect((await db.get('assignmentItem', itemId))?.questionVersionId).toBe(questionId);
      await expect(
        domain.createAssignment(db, outsider, {
          title: '跨班',
          classId,
          questionVersionIds: [questionId],
          startsAt: new Date(),
          dueAt: new Date(Date.now() + 10000),
          allowLate: false,
          maxAttempts: 1,
          releaseAnswers: false,
        }),
      ).rejects.toMatchObject({ status: 403 });
      expect((await db.get('assignment', assignmentId))?.status).toBe('PUBLISHED');
    });
  },
);

it('repairs a queued database job after Redis lost its delivered job', async () => {
  const { reconcileQueuedRuns } = await import('@tuheng/infrastructure');
  const prior = (await db.list('gradingRun', { attemptId }))[0];
  const id = crypto.randomUUID();
  await db.create('gradingRun', {
    id,
    attemptId,
    configId: prior.configId,
    status: 'QUEUED',
    strategyVersion: prior.strategyVersion,
    promptVersion: prior.promptVersion,
    request: { ...(prior.request as object), runId: id },
  });
  await db.create('backgroundJob', {
    runId: id,
    lane: 'formal',
    status: 'QUEUED',
    updatedAt: new Date(Date.now() - 60000),
  });
  await db.create('outboxEvent', { runId: id, lane: 'formal', deliveredAt: new Date() });
  await reconcileQueuedRuns([id]);
  expect((await db.list('outboxEvent', { runId: id }))[0].deliveredAt).toBeNull();
  await dispatchOutbox([id]);
  const queue = queueFor('formal');
  try {
    expect(await queue.getJob(id)).toBeDefined();
  } finally {
    await queue.close();
  }
});
