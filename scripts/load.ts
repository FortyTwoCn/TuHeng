import 'dotenv/config';
import { performance } from 'node:perf_hooks';
import sharp from 'sharp';
import { hash } from 'bcryptjs';
import { database as db, prisma } from '@tuheng/database';
import {
  createQuestion,
  createAssignment,
  publishAssignment,
  submitAnswer,
  type Actor,
} from '@tuheng/domain';
import { uploadAsset, dispatchOutbox } from '@tuheng/infrastructure';
const url = new URL(process.env.DATABASE_URL!);
if (
  !['localhost', '127.0.0.1'].includes(url.hostname) ||
  process.env.LOAD_CONFIRM !== 'local-test-only'
)
  throw new Error(
    'Local load tests require LOAD_CONFIRM=local-test-only and a loopback PostgreSQL database',
  );
if (process.env.AI_API_KEY)
  throw new Error('Run load tests in a local environment without live model credentials');
const count = Math.min(2000, Math.max(1, Number(process.env.LOAD_USERS ?? 20))),
  concurrency = Math.min(50, Math.max(1, Number(process.env.LOAD_CONCURRENCY ?? 5))),
  tag = `LOAD-${Date.now()}`;
const passwordHash = await hash(crypto.randomUUID(), 4);
const teacher = await db.create('user', {
  name: `[压测]教师 ${tag}`,
  email: `teacher-${tag}@test.invalid`,
  passwordHash,
  roles: ['TEACHER'],
});
const actor: Actor = { id: teacher.id, name: teacher.name, roles: ['TEACHER'] };
const course = await db.create('course', { title: `[压测] ${tag}`, code: tag });
const offering = await db.create('courseOffering', { courseId: course.id, term: '压测专用' });
const cls = await db.create('teachingClass', { name: `[压测] ${tag}`, offeringId: offering.id });
await db.create('teachingGrant', { userId: teacher.id, classId: cls.id });
const q = await createQuestion(db, actor, {
  title: `[压测]点的投影 ${tag}`,
  content: '已知两面投影，求第三投影。仅用于可靠提交与队列压测，不评价模型准确率。',
  type: 'POINT_PROJECTION',
  chapter: '压测专用',
  knowledgeIds: ['point'],
  assetIds: [],
  reference: {
    version: 'load-ref-1',
    content: '长对正、高平齐、宽相等',
    assetIds: [],
    verified: true,
    source: 'TEACHER',
  },
  rubric: {
    version: 'load-rubric-1',
    maxPoints: 100,
    items: [
      {
        id: 'projection',
        name: '投影关系',
        maxPoints: 100,
        knowledgeIds: ['point'],
        correctness: '三面投影关系正确',
        partialCredit: '部分正确',
        deductions: '有证据的独立错误',
        deductionCap: null,
      },
    ],
  },
  confirmed: true,
});
const ass = await createAssignment(db, actor, {
  title: `[压测] ${tag}`,
  classId: cls.id,
  questionVersionIds: [q.id],
  startsAt: new Date(Date.now() - 10000),
  dueAt: new Date(Date.now() + 86400000),
  allowLate: false,
  maxAttempts: 1,
  releaseAnswers: false,
});
await publishAssignment(db, actor, ass.id);
const item = (await db.list('assignmentItem', { assignmentId: ass.id }))[0];
const image = await sharp({
  create: { width: 1000, height: 1000, channels: 3, background: 'white' },
})
  .png()
  .toBuffer();
let cursor = 0,
  failed = 0;
const times: number[] = [];
const failureReasons: Record<string, number> = {};
const runIds: string[] = [];
const start = performance.now();
await Promise.all(
  Array.from({ length: concurrency }, async () => {
    while (cursor < count) {
      const n = cursor++;
      try {
        const user = await db.create('user', {
          name: `[压测]学生 ${n}`,
          email: `student-${tag}-${n}@test.invalid`,
          passwordHash,
          roles: ['STUDENT'],
        });
        const a: Actor = { id: user.id, name: user.name, roles: ['STUDENT'] };
        await db.create('enrollment', { userId: a.id, classId: cls.id });
        const asset = await uploadAsset(
          a,
          { name: '[压测]空白流程测试.png', bytes: image, mime: 'image/png' },
          'SUBMISSION',
        );
        const t = performance.now();
        const at = await submitAnswer(db, a, {
          itemId: item.id,
          assetIds: [asset.id],
          idempotencyKey: crypto.randomUUID(),
        });
        times.push(performance.now() - t);
        runIds.push((await db.list('gradingRun', { attemptId: at.id }))[0].id);
      } catch (e) {
        failed++;
        const code = (e as { code?: string }).code ?? (e as Error).name;
        failureReasons[code] = (failureReasons[code] ?? 0) + 1;
      }
    }
  }),
);
await dispatchOutbox(runIds);
times.sort((a, b) => a - b);
const elapsed = performance.now() - start;
console.log(
  JSON.stringify(
    {
      testOnly: true,
      tag,
      users: count,
      concurrency,
      success: times.length,
      failed,
      failureReasons,
      totalMs: Math.round(elapsed),
      submissionsPerSecond: Number((times.length / (elapsed / 1000)).toFixed(2)),
      submissionTransactionP50Ms: Math.round(times[Math.floor(times.length * 0.5)] ?? 0),
      submissionTransactionP95Ms: Math.round(times[Math.floor(times.length * 0.95)] ?? 0),
      note: 'Includes real PostgreSQL submissions, S3 uploads and Redis delivery; no model throughput or 2000-user capacity claim.',
    },
    null,
    2,
  ),
);
await prisma.$disconnect();
console.log('Load resources closed.');
if (failed) process.exitCode = 1;
