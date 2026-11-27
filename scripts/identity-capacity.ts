import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { spawn, spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import ExcelJS from 'exceljs';
const url = new URL(process.env.DATABASE_URL!);
if (!process.argv.includes('--confirm-isolated') || !url.pathname.endsWith('_test'))
  throw new Error('Use an isolated *_test database and --confirm-isolated.');
const schema = 'identity_capacity_' + Date.now(),
  namespace = 'capacity-' + randomUUID();
url.searchParams.delete('schema');
url.searchParams.delete('options');
const sql = new Client({ connectionString: url.href });
await sql.connect();
await sql.query('CREATE SCHEMA "' + schema + '"');
await sql.end();
url.searchParams.set('schema', schema);
url.searchParams.set('options', '-c search_path=' + schema);
Object.assign(process.env, {
  DATABASE_URL: url.href,
  NODE_ENV: 'test',
  QUEUE_NAMESPACE: namespace,
});
const migration = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/migrate.ts'], {
  env: process.env,
  windowsHide: true,
  encoding: 'utf8',
});
if (migration.status !== 0) throw new Error('CAPACITY_MIGRATION_FAILED');
const { prisma, database } = await import('@tuheng/database');
const { resolveAudience } = await import('@tuheng/domain');
const { previewRosterImport, commitRosterImport, executeRosterImport } =
  await import('../packages/infrastructure/src/roster-import');
const tag = randomUUID(),
  school = await prisma.school.create({ data: { code: tag, name: '隔离容量测试学校' } });
const teacher = await prisma.user.create({
  data: {
    name: '容量测试教师',
    email: 'capacity@test.invalid',
    emailNormalized: 'capacity@test.invalid',
    emailVerifiedAt: new Date(),
    passwordHash: 'test-fixture-not-for-login',
    kind: 'TEACHER',
    realm: 'STAFF',
    roles: ['TEACHER'],
    schoolId: school.id,
    mustChangePassword: false,
    loginId: 'T-CAPACITY',
  },
});
const actor = {
  id: teacher.id,
  name: teacher.name,
  kind: 'TEACHER' as const,
  realm: 'STAFF' as const,
  roles: ['TEACHER'] as ['TEACHER'],
  schoolId: school.id,
};
const course = await prisma.course.create({
  data: { code: tag, title: '容量课程', schoolId: school.id },
});
const offering = await prisma.courseOffering.create({
  data: {
    courseId: course.id,
    term: '2026-test',
    startsAt: new Date('2026-09-01T00:00:00+08:00'),
    endsAt: new Date('2027-01-31T23:59:59+08:00'),
  },
});
const classes: { id: string; name: string }[] = [];
for (let i = 0; i < 5; i++)
  classes.push(
    await prisma.teachingClass.create({
      data: {
        schoolId: school.id,
        offeringId: offering.id,
        name: '容量班' + i,
        grants: { create: { userId: teacher.id } },
      },
    }),
  );
const people = Array.from({ length: 2000 }, (_, i) => ({
  id: randomUUID(),
  name: '容量学生' + i,
  email: '',
  passwordHash: 'test-fixture-not-for-login',
  roles: ['STUDENT'],
  kind: 'STUDENT',
  realm: 'STUDENT',
  schoolId: school.id,
  studentNumber: String(i + 1).padStart(8, '0'),
}));
await prisma.user.createMany({ data: people });
await prisma.enrollment.createMany({
  data: people.map((p, i) => ({ userId: p.id, classId: classes[i % 5].id })),
});
const pageStart = performance.now();
for (const page of [0, 49, 99]) {
  const rows = await prisma.user.findMany({
    where: { schoolId: school.id, kind: 'STUDENT' },
    orderBy: { studentNumber: 'asc' },
    skip: page * 20,
    take: 20,
  });
  if (rows.length !== 20) throw new Error('PAGINATION_COUNT');
}
const pageMs = performance.now() - pageStart,
  searchStart = performance.now();
const found = await prisma.user.findMany({
  where: { schoolId: school.id, studentNumber: { contains: '000019' } },
  take: 20,
});
const searchMs = performance.now() - searchStart;
if (!found.length) throw new Error('SEARCH_EMPTY');
const selection = {
  version: 1,
  schoolId: school.id,
  include: {
    allEligibleInScope: true,
    classIds: classes.map((c) => c.id),
    studentIds: [people[0].id],
  },
  exclude: { studentIds: [people[1].id] },
} as const;
const resolveStart = performance.now(),
  resolved = await resolveAudience(database, actor, selection),
  resolveMs = performance.now() - resolveStart;
if (resolved.count !== 1999 || resolved.recipients.some((p) => p.studentId === people[1].id))
  throw new Error('AUDIENCE_COUNT');
const wb = new ExcelJS.Workbook(),
  sheet = wb.addWorksheet('名单');
sheet.addRow(['班级', '学号', '学生姓名']);
people.forEach((p, i) => sheet.addRow([classes[i % 5].name, p.studentNumber, p.name]));
sheet.addRow([classes[0].name, '90000001', '新增学生1']);
sheet.addRow([classes[0].name, '90000002', '新增学生2']);
const previewStart = performance.now(),
  preview = await previewRosterImport(actor, {
    schoolId: school.id,
    offeringId: offering.id,
    kind: 'TEACHER',
    filename: 'capacity.xlsx',
    bytes: Buffer.from(await wb.xlsx.writeBuffer()),
  }),
  previewMs = performance.now() - previewStart;
if (!('id' in preview) || preview.analysis?.errors.length)
  throw new Error('CAPACITY_PREVIEW_FAILED');
await commitRosterImport(actor, {
  importBatchId: preview.id,
  fingerprint: preview.fingerprint,
  mappingVersion: 1,
  rosterVersion: preview.rosterVersion,
});
const executeStart = performance.now();
const child = spawn(
  process.execPath,
  [
    '--import',
    'tsx',
    '-e',
    'import {executeRosterImport} from "./packages/infrastructure/src/roster-import.ts"; import {prisma} from "@tuheng/database"; await executeRosterImport(process.argv[1]); await prisma.$disconnect();',
    preview.id,
  ],
  { env: process.env, windowsHide: true, stdio: 'ignore' },
);
const exited = new Promise<void>((resolve) => child.on('exit', () => resolve()));
let interruptedAt = 0;
for (let i = 0; i < 2400; i++) {
  const row = await prisma.rosterImportBatch.findUniqueOrThrow({ where: { id: preview.id } });
  interruptedAt = (row.result as { completed: number }).completed;
  if (interruptedAt >= 100 || row.status === 'FAILED') break;
  await new Promise((resolve) => setTimeout(resolve, 50));
}
if (interruptedAt < 100 || interruptedAt >= 2002) {
  child.kill();
  throw new Error('INTERRUPTION_NOT_OBSERVED');
}
child.kill();
await exited;
const stopped = await prisma.rosterImportBatch.findUniqueOrThrow({ where: { id: preview.id } });
await executeRosterImport(preview.id);
const done = await prisma.rosterImportBatch.findUniqueOrThrow({ where: { id: preview.id } });
const count = await prisma.user.count({ where: { schoolId: school.id, kind: 'STUDENT' } });
if (done.status !== 'SUCCEEDED' || count !== 2002) throw new Error('RESUME_COUNTS_WRONG');
const progress = done.result as { completed: number; credentialBatchId: string };
const delivered = await prisma.credentialDeliveryItem.count({
  where: { batchId: progress.credentialBatchId },
});
if (delivered !== 2 || progress.completed !== 2002) throw new Error('RESUME_DUPLICATE_CREDENTIALS');
await executeRosterImport(preview.id);
const report = {
  schema,
  environment: { node: process.version, platform: process.platform, cpu: cpus()[0].model },
  studentsBefore: 2000,
  studentsAfter: count,
  classes: 5,
  pageSize: 20,
  threePagesMs: pageMs,
  searchMs,
  resolveAudienceMs: resolveMs,
  selected: resolved.count,
  previewRows: 2002,
  previewMs,
  interruptedAt: (stopped.result as { completed: number }).completed,
  resumedStatus: done.status,
  executeIncludingInterruptionMs: performance.now() - executeStart,
  newCredentialItems: delivered,
  idempotentRerun: true,
};
await writeFile('.runtime/identity-capacity-report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
await prisma.$disconnect();
