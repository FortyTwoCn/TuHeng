import 'dotenv/config';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@tuheng/database';
import { nextLoginId } from '../packages/infrastructure/src/organization';
const apply = process.argv.includes('--apply');
const Schema = z.object({
  version: z.literal(1),
  schools: z.array(z.object({ code: z.string().min(1), name: z.string().min(1) })),
  users: z.record(
    z.string(),
    z.object({ schoolCode: z.string(), studentNumber: z.string().optional() }),
  ),
  classes: z.record(z.string(), z.string()),
});
const arg = (key: string) => process.argv[process.argv.indexOf(key) + 1];
const users = await prisma.user.findMany(),
  classes = await prisma.teachingClass.findMany();
if (process.argv.includes('--development-template')) {
  if (process.env.NODE_ENV === 'production') throw new Error('DEVELOPMENT_ONLY');
  const target = arg('--output');
  if (!target || !target.replaceAll('\\', '/').startsWith('.runtime/'))
    throw new Error('OUTPUT_MUST_BE_RUNTIME');
  const mapping = {
    version: 1,
    schools: [{ code: 'DEV-MIGRATION', name: '开发数据迁移学校（非真实名册）' }],
    users: Object.fromEntries(
      users
        .filter((u) => u.kind !== 'SITE_ADMIN' && !u.schoolId)
        .map((u, i) => [
          u.id,
          {
            schoolCode: 'DEV-MIGRATION',
            ...(u.kind === 'STUDENT'
              ? { studentNumber: `DEV${String(i + 1).padStart(5, '0')}` }
              : {}),
          },
        ]),
    ),
    classes: Object.fromEntries(
      classes.filter((c) => !c.schoolId).map((c) => [c.id, 'DEV-MIGRATION']),
    ),
  };
  await mkdir('.runtime', { recursive: true });
  await writeFile(target, JSON.stringify(mapping, null, 2), { flag: 'wx' });
  console.log(
    'Development mapping template written. Review and pass --mapping; no database changes.',
  );
  await prisma.$disconnect();
  process.exit(0);
}
if (!process.argv.includes('--mapping')) throw new Error('EXPLICIT_MAPPING_REQUIRED');
const mapping = Schema.parse(JSON.parse(await readFile(arg('--mapping'), 'utf8')));
const missingUsers = users
    .filter((u) => u.kind !== 'SITE_ADMIN' && !u.schoolId && !mapping.users[u.id])
    .map((u) => u.id),
  missingClasses = classes.filter((c) => !c.schoolId && !mapping.classes[c.id]).map((c) => c.id);
if (missingUsers.length || missingClasses.length) throw new Error('MAPPING_INCOMPLETE');
const protectedTables = [
  'SubmissionAttempt',
  'GradeDecision',
  'GradingSuggestion',
  'StoredAsset',
  'QuestionVersion',
  'SelfTestSet',
  'ErrorBookEntry',
] as const;
async function digests(client: Prisma.TransactionClient) {
  const result: Record<string, { count: number; sha256: string }> = {};
  for (const table of protectedTables) {
    const rows = await client.$queryRawUnsafe<unknown[]>(
      `SELECT to_jsonb(t) AS row FROM "${table}" t ORDER BY id`,
    );
    result[table] = {
      count: rows.length,
      sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
    };
  }
  return result;
}
const before = await digests(prisma);
const oldAssignments = await prisma.assignment.findMany({
  where: { audienceRevision: 0, audience: { equals: Prisma.DbNull } },
  include: {
    items: { include: { submissions: { include: { attempts: { select: { ownerId: true } } } } } },
  },
});
const plan = {
  mode: apply ? 'APPLY' : 'READ_ONLY',
  schools: mapping.schools,
  accountsToMap: Object.keys(mapping.users).length,
  classesToMap: Object.keys(mapping.classes).length,
  assignments: oldAssignments.map((a) => ({
    id: a.id,
    classId: a.classId,
    submittedOwners: [
      ...new Set(
        a.items.flatMap((i) => i.submissions.flatMap((s) => s.attempts.map((t) => t.ownerId))),
      ),
    ],
    note: 'Current members plus actual submitters; historical release-day membership cannot be recovered.',
  })),
  protectedData: before,
};
if (apply)
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(72651329)`;
      const schoolIds = new Map<string, string>();
      for (const school of mapping.schools) {
        const row = await tx.school.upsert({
          where: { code: school.code },
          create: school,
          update: {},
        });
        schoolIds.set(school.code, row.id);
      }
      for (const u of users) {
        const entry = mapping.users[u.id];
        if (!entry) continue;
        const schoolId = schoolIds.get(entry.schoolCode);
        if (!schoolId) throw new Error('SCHOOL_MAPPING_MISSING');
        if (u.schoolId && u.schoolId !== schoolId)
          throw new Error('REFUSE_EXISTING_SCHOOL_REASSIGNMENT');
        if (u.kind === 'STUDENT' && !entry.studentNumber)
          throw new Error('STUDENT_NUMBER_MAPPING_REQUIRED');
        const loginId =
          u.kind === 'TEACHER'
            ? (u.loginId ?? (await nextLoginId(tx, 'T')))
            : u.kind === 'SCHOOL_ADMIN'
              ? (u.loginId ?? (await nextLoginId(tx, 'S')))
              : u.loginId;
        if (
          u.schoolId !== schoolId ||
          u.loginId !== loginId ||
          (u.kind === 'STUDENT' && u.studentNumber !== entry.studentNumber)
        )
          await tx.user.update({
            where: { id: u.id },
            data: {
              schoolId,
              loginId,
              ...(u.kind === 'STUDENT' ? { studentNumber: entry.studentNumber } : {}),
              tokenVersion: { increment: 1 },
            },
          });
      }
      for (const c of classes) {
        const code = mapping.classes[c.id];
        if (!code) continue;
        const schoolId = schoolIds.get(code);
        if (!schoolId) throw new Error('CLASS_SCHOOL_MAPPING_MISSING');
        if (c.schoolId && c.schoolId !== schoolId)
          throw new Error('REFUSE_EXISTING_CLASS_REASSIGNMENT');
        await tx.teachingClass.update({ where: { id: c.id }, data: { schoolId } });
      }
      for (const c of await tx.teachingClass.findMany({
        include: {
          offering: { include: { course: true } },
          grants: { include: { user: true } },
          enrollments: { include: { user: true } },
        },
      })) {
        if (!c.schoolId) throw new Error('CLASS_SCHOOL_MISSING');
        if (
          c.grants.some((g) => g.user.kind !== 'TEACHER' || g.user.schoolId !== c.schoolId) ||
          c.enrollments.some((e) => e.user.kind !== 'STUDENT' || e.user.schoolId !== c.schoolId)
        )
          throw new Error('CROSS_SCHOOL_MEMBERSHIP_MAPPING');
        if (c.offering.course.schoolId && c.offering.course.schoolId !== c.schoolId)
          throw new Error('COURSE_SPANS_SCHOOLS');
        await tx.course.update({
          where: { id: c.offering.courseId },
          data: { schoolId: c.schoolId },
        });
      }
      for (const ass of oldAssignments) {
        if (!ass.classId) throw new Error('LEGACY_ASSIGNMENT_CLASS_REQUIRED');
        const cls = await tx.teachingClass.findUniqueOrThrow({
          where: { id: ass.classId },
          include: { enrollments: true, grants: true },
        });
        const actual = ass.items.flatMap((i) =>
            i.submissions.flatMap((s) => s.attempts.map((t) => t.ownerId)),
          ),
          ids = [...new Set([...cls.enrollments.map((e) => e.userId), ...actual])];
        const reviewerIds = cls.grants.map((g) => g.userId);
        if (!reviewerIds.length) throw new Error('LEGACY_ASSIGNMENT_REVIEWER_MAPPING_REQUIRED');
        for (const studentId of ids) {
          const student = await tx.user.findUniqueOrThrow({ where: { id: studentId } });
          if (student.kind !== 'STUDENT' || student.schoolId !== cls.schoolId)
            throw new Error('SUBMITTER_SCHOOL_CONFLICT');
          if (ass.status === 'PUBLISHED')
            await tx.assignmentRecipient.create({
              data: {
                assignmentId: ass.id,
                studentId,
                schoolId: cls.schoolId!,
                classIds: [cls.id],
                reviewerIds,
                revision: 1,
                inferred: true,
              },
            });
        }
        await tx.assignment.update({
          where: { id: ass.id },
          data: {
            schoolId: cls.schoolId,
            audienceRevision: ass.status === 'PUBLISHED' ? 1 : 0,
            audience: {
              version: 1,
              schoolId: cls.schoolId,
              include: { allEligibleInScope: false, classIds: [], studentIds: ids },
              exclude: { studentIds: [] },
              reviewerIds,
              rosterVersion: 0,
            },
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: ass.creatorId,
            action: 'LEGACY_AUDIENCE_INFERRED',
            resourceId: ass.id,
            details: {
              recipientCount: ids.length,
              actualSubmitters: [...new Set(actual)],
              basis: 'cutover members plus actual submitters',
            },
          },
        });
      }
      const legacy = await tx.gradingRun.findMany({
        where: { status: { in: ['QUEUED', 'RETRYING', 'RUNNING'] } },
        select: { id: true },
      });
      for (const run of legacy) {
        if (await tx.aIInvocation.findUnique({ where: { runId: run.id } })) continue;
        await tx.gradingRun.update({
          where: { id: run.id },
          data: {
            status: 'BLOCKED_CONFIG',
            leaseToken: null,
            leaseUntil: null,
            errorCode: 'AI_LEGACY_CONFIGURATION_REQUIRED',
          },
        });
        await tx.backgroundJob.updateMany({
          where: { runId: run.id },
          data: { status: 'BLOCKED_CONFIG', errorCode: 'AI_LEGACY_CONFIGURATION_REQUIRED' },
        });
      }
      const after = await digests(tx);
      if (JSON.stringify(before) !== JSON.stringify(after))
        throw new Error('PROTECTED_HISTORY_CHANGED');
    },
    { timeout: 60000, isolationLevel: 'Serializable' },
  );
const after = await digests(prisma);
await mkdir('.runtime', { recursive: true });
const report = `.runtime/identity-migration-${Date.now()}.json`;
await writeFile(
  report,
  JSON.stringify(
    { ...plan, after, protectedUnchanged: JSON.stringify(before) === JSON.stringify(after) },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    report,
    mode: plan.mode,
    accounts: plan.accountsToMap,
    assignments: plan.assignments.length,
    protectedUnchanged: JSON.stringify(before) === JSON.stringify(after),
  }),
);
await prisma.$disconnect();
