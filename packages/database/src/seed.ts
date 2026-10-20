import { hash } from 'bcryptjs';
import { prisma } from './index';
import { ensureBucket } from '../../infrastructure/src/storage';
const password = process.env.SEED_PASSWORD;
if (!password || password.length < 12) throw new Error('Set SEED_PASSWORD, at least 12 characters');
for (const [id, role, name] of [
  ['student', 'STUDENT', '林同学'],
  ['student2', 'STUDENT', '陈同学'],
  ['teacher', 'TEACHER', '王老师'],
  ['admin', 'ADMIN', '平台管理员'],
] as const) {
  await prisma.user.upsert({
    where: { email: `${id}@tuheng.local` },
    create: {
      id,
      email: `${id}@tuheng.local`,
      name,
      passwordHash: await hash(password, 12),
      roles: [role],
    },
    update: {},
  });
}
await prisma.course.upsert({
  where: { id: 'course-demo' },
  create: { id: 'course-demo', title: '画法几何及机械制图（演示课程）', code: 'DEMO-GE101' },
  update: {},
});
await prisma.courseOffering.upsert({
  where: { id: 'offering-demo' },
  create: { id: 'offering-demo', courseId: 'course-demo', term: '2026 秋季' },
  update: {},
});
await prisma.teachingClass.upsert({
  where: { id: 'class-demo' },
  create: { id: 'class-demo', offeringId: 'offering-demo', name: '机械工程 2601 · 演示班' },
  update: {},
});
for (const userId of ['student', 'student2'])
  await prisma.enrollment.upsert({
    where: { userId_classId: { userId, classId: 'class-demo' } },
    create: { userId, classId: 'class-demo' },
    update: {},
  });
await prisma.teachingGrant.upsert({
  where: { userId_classId: { userId: 'teacher', classId: 'class-demo' } },
  create: { userId: 'teacher', classId: 'class-demo' },
  update: {},
});
for (const [id, title, chapter] of [
  ['point', '点的投影规律', '第一章'],
  ['line', '直线投影对应关系', '第二章'],
  ['plane', '投影面的空间理解', '第三章'],
  ['drawing', '图线表达与作图规范', '制图基础'],
])
  await prisma.knowledgePoint.upsert({ where: { id }, create: { id, title, chapter }, update: {} });
if (!(await prisma.modelConfigurationVersion.count()))
  await prisma.modelConfigurationVersion.create({
    data: {
      provider: 'openai-compatible-vision',
      baseUrl: process.env.AI_BASE_URL ?? 'https://api.openai.com/v1',
      model: process.env.AI_MODEL ?? '',
      outputMode: process.env.AI_OUTPUT_MODE ?? 'json_object',
      timeoutMs: Number(process.env.AI_TIMEOUT_MS ?? 60000),
      concurrency: Number(process.env.AI_CONCURRENCY ?? 2),
    },
  });
await ensureBucket();
console.log(
  'Seed ready: explicitly marked demo course, accounts and knowledge points. No grades fabricated.',
);
await prisma.$disconnect();
