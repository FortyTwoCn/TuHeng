import { hash } from 'bcryptjs';
import { prisma } from './index';
import { ensureBucket } from '../../infrastructure/src/storage';
if (
  process.env.SEED_TEST_ACCOUNTS !== '1' ||
  !new URL(process.env.DATABASE_URL!).pathname.endsWith('_test')
)
  throw new Error(
    'Demo accounts are restricted to an explicitly selected test database. Use identity:bootstrap for installation.',
  );
const password = process.env.SEED_PASSWORD;
if (!password || password.length < 12) throw new Error('Set SEED_PASSWORD, at least 12 characters');
await prisma.school.upsert({
  where: { id: 'school-demo' },
  create: { id: 'school-demo', code: 'TEST-DEMO', name: '图衡自动化测试学校' },
  update: {},
});
for (const [id, role, name] of [
  ['student', 'STUDENT', '林同学'],
  ['student2', 'STUDENT', '陈同学'],
  ['teacher', 'TEACHER', '王老师'],
  ['admin', 'ADMIN', '平台管理员'],
] as const) {
  await prisma.user.upsert({
    where: { id },
    create: {
      id,
      email: `${id}@tuheng.local`,
      name,
      passwordHash: await hash(password, 12),
      roles: [role],
      kind: role === 'ADMIN' ? 'SITE_ADMIN' : role,
      realm: role === 'STUDENT' ? 'STUDENT' : 'STAFF',
      loginId: role === 'ADMIN' ? 'admin' : role === 'TEACHER' ? 'T000001' : null,
      schoolId: role === 'ADMIN' ? null : 'school-demo',
      studentNumber: role === 'STUDENT' ? (id === 'student' ? '001' : '002') : null,
      emailNormalized: `${id}@tuheng.local`,
      emailVerifiedAt: new Date(),
      mustChangePassword: false,
      installationComplete: role === 'ADMIN',
    },
    update: {
      schoolId: role === 'ADMIN' ? null : 'school-demo',
      studentNumber: role === 'STUDENT' ? (id === 'student' ? '001' : '002') : null,
    },
  });
}
await prisma.course.upsert({
  where: { id: 'course-demo' },
  create: {
    id: 'course-demo',
    schoolId: 'school-demo',
    title: '画法几何及机械制图（演示课程）',
    code: 'DEMO-GE101',
  },
  update: { schoolId: 'school-demo' },
});
await prisma.courseOffering.upsert({
  where: { id: 'offering-demo' },
  create: { id: 'offering-demo', courseId: 'course-demo', term: '2026 秋季' },
  update: {},
});
await prisma.teachingClass.upsert({
  where: { id: 'class-demo' },
  create: {
    id: 'class-demo',
    schoolId: 'school-demo',
    offeringId: 'offering-demo',
    name: '机械工程 2601 · 演示班',
  },
  update: { schoolId: 'school-demo' },
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
await ensureBucket();
console.log(
  'Seed ready: explicitly marked demo course, accounts and knowledge points. No grades fabricated.',
);
await prisma.$disconnect();
