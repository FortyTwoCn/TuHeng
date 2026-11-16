import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@tuheng/database';
import { RosterRow, AccountKind } from '@tuheng/contracts';
import { accountRoles, ensure, requireSchoolScope, type Actor } from '@tuheng/domain';
import { parseRosterXlsx } from './roster-xlsx';
import {
  createAccountInTransaction,
  createDeliveryBatch,
  requireActiveSchool,
} from './organization';
import { queueFor } from './queue';
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export const ImportMapping = z.object({
  version: z.number().int().min(1),
  teachers: z.record(
    z.string(),
    z.object({
      teacherId: z.string().optional(),
      createName: z.string().min(1).max(100).optional(),
      confirmed: z.boolean(),
    }),
  ),
  rowGroups: z.record(z.string(), z.string()).default({}),
  classes: z.record(z.string(), z.string()).default({}),
});
const Scope = z.object({ offeringId: z.string(), kind: z.enum(['SCHOOL', 'TEACHER']) });
type Mapping = z.infer<typeof ImportMapping>;
export type ImportIssue = { row: number; column: string; reason: string };
async function scopeCheck(actor: Actor, schoolId: string, scope: z.infer<typeof Scope>) {
  await requireActiveSchool(actor, schoolId);
  ensure(['SITE_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'].includes(actor.kind ?? ''), 'FORBIDDEN', 403);
  ensure((actor.kind === 'TEACHER') === (scope.kind === 'TEACHER'), 'IMPORT_TEMPLATE_SCOPE');
  const offering = await prisma.courseOffering.findUnique({
    where: { id: scope.offeringId },
    include: { course: true },
  });
  ensure(offering?.course.schoolId === schoolId, 'COURSE_SCOPE_MISMATCH', 403);
}
export async function analyzeRoster(
  actor: Actor,
  schoolId: string,
  scope: z.infer<typeof Scope>,
  rows: RosterRow[],
  mapping: Mapping,
) {
  await scopeCheck(actor, schoolId, scope);
  const [students, teachers, classes] = await Promise.all([
    prisma.user.findMany({
      where: { schoolId, kind: 'STUDENT', studentNumber: { in: rows.map((r) => r.studentNumber) } },
      select: { id: true, name: true, studentNumber: true, active: true },
    }),
    prisma.user.findMany({
      where: {
        schoolId,
        kind: 'TEACHER',
        active: true,
        ...(actor.kind === 'TEACHER' ? { id: actor.id } : {}),
      },
      select: { id: true, name: true, loginId: true },
    }),
    prisma.teachingClass.findMany({
      where: { schoolId, offeringId: scope.offeringId, archived: false },
      include: { grants: true },
    }),
  ]);
  const errors: ImportIssue[] = [],
    seen = new Set<string>(),
    names = new Map<string, string>(),
    newStudents = new Set<string>(),
    newTeachers = new Set<string>(),
    newClasses = new Set<string>();
  const plan: {
    row: RosterRow;
    group: string;
    teacherId?: string;
    classKey: string;
    classId?: string;
    existingStudentId?: string;
    skip: boolean;
  }[] = [];
  for (const row of rows) {
    const group =
      scope.kind === 'TEACHER' ? actor.id : (mapping.rowGroups[String(row.row)] ?? row.teacher!);
    const choice = mapping.teachers[group];
    const teacherId = scope.kind === 'TEACHER' ? actor.id : choice?.teacherId;
    if (
      scope.kind === 'SCHOOL' &&
      (!choice?.confirmed || (!choice.teacherId && !choice.createName))
    )
      errors.push({
        row: row.row,
        column: '教师名',
        reason: '请确认此教师分组属于同一人，并明确选择已有教师或新建教师；重名可按行拆分组。',
      });
    if (teacherId && !teachers.some((t) => t.id === teacherId))
      errors.push({
        row: row.row,
        column: '教师名',
        reason: '所选教师不在当前学校授权范围或已停用。',
      });
    if (!teacherId && choice?.createName) newTeachers.add(group);
    const classKey = JSON.stringify([group, row.className]),
      selected = mapping.classes[classKey];
    const candidates = classes.filter(
      (c) => c.name === row.className && c.grants.some((g) => g.userId === teacherId),
    );
    let classId =
      selected && selected !== 'NEW'
        ? selected
        : selected === 'NEW'
          ? undefined
          : candidates.length === 1
            ? candidates[0].id
            : undefined;
    if (
      classId &&
      !classes.some((c) => c.id === classId && c.grants.some((g) => g.userId === teacherId))
    ) {
      errors.push({ row: row.row, column: '班级', reason: '不能复用其他教师的班级。' });
      classId = undefined;
    }
    if (
      !selected &&
      (candidates.length > 1 ||
        (!candidates.length && classes.some((c) => c.name === row.className)))
    )
      errors.push({
        row: row.row,
        column: '班级',
        reason: '存在同名班级，请明确选择授权班级或新建。',
      });
    if (!classId) newClasses.add(classKey);
    const old = students.find((s) => s.studentNumber === row.studentNumber),
      prior = names.get(row.studentNumber);
    if ((old && (old.name !== row.name || !old.active)) || (prior && prior !== row.name))
      errors.push({
        row: row.row,
        column: '学号',
        reason: '同校学号对应姓名冲突或账号已停用。请先由授权人员修正后重新预检。',
      });
    names.set(row.studentNumber, row.name);
    if (!old) newStudents.add(row.studentNumber);
    const signature = JSON.stringify([group, row.className, row.studentNumber, row.name]),
      skip = seen.has(signature);
    seen.add(signature);
    plan.push({ row, group, teacherId, classKey, classId, existingStudentId: old?.id, skip });
  }
  return {
    errors,
    plan,
    teachers,
    classes: classes.map((c) => ({
      id: c.id,
      name: c.name,
      teacherIds: c.grants.map((g) => g.userId),
    })),
    counts: {
      newTeachers: newTeachers.size,
      newClasses: newClasses.size,
      newStudents: newStudents.size,
      reusedStudents: students.length,
      skipped: plan.filter((p) => p.skip).length,
      total: rows.length,
    },
  };
}
export async function previewRosterImport(
  actor: Actor,
  input: {
    schoolId: string;
    offeringId: string;
    kind: 'SCHOOL' | 'TEACHER';
    filename: string;
    bytes: Buffer;
  },
) {
  const scope = Scope.parse(input);
  await scopeCheck(actor, input.schoolId, scope);
  const parsed = await parseRosterXlsx(input.bytes, input.filename, input.kind);
  if (parsed.errors.length) return { errors: parsed.errors };
  const fingerprint = createHash('sha256').update(input.bytes).digest('hex');
  const prior = await prisma.rosterImportBatch.findUnique({
    where: {
      creatorId_schoolId_fingerprint: {
        creatorId: actor.id,
        schoolId: input.schoolId,
        fingerprint,
      },
    },
  });
  if (prior) {
    ensure(
      Scope.parse(prior.scope).offeringId === scope.offeringId &&
        Scope.parse(prior.scope).kind === scope.kind,
      'IMPORT_SCOPE_CHANGED',
      409,
    );
    return rosterImportStatus(actor, prior.id);
  }
  const school = await prisma.school.findUniqueOrThrow({ where: { id: input.schoolId } });
  const mapping = ImportMapping.parse({ version: 1, teachers: {}, rowGroups: {}, classes: {} });
  const batch = await prisma.rosterImportBatch.create({
    data: {
      creatorId: actor.id,
      schoolId: input.schoolId,
      fingerprint,
      scope,
      rows: json(parsed.rows),
      mapping: json(mapping),
      rosterVersion: school.rosterVersion,
    },
  });
  return rosterImportStatus(actor, batch.id);
}
async function ownBatch(actor: Actor, id: string) {
  const batch = await prisma.rosterImportBatch.findUniqueOrThrow({ where: { id } });
  ensure(batch.creatorId === actor.id, 'IMPORT_FORBIDDEN', 403);
  await scopeCheck(actor, batch.schoolId, Scope.parse(batch.scope));
  return batch;
}
export async function rosterImportStatus(actor: Actor, id: string) {
  const batch = await ownBatch(actor, id);
  const analysis =
    batch.status === 'PREVIEW'
      ? await analyzeRoster(
          actor,
          batch.schoolId,
          Scope.parse(batch.scope),
          z.array(RosterRow).parse(batch.rows),
          ImportMapping.parse(batch.mapping),
        )
      : undefined;
  return {
    id: batch.id,
    fingerprint: batch.fingerprint,
    status: batch.status,
    mapping: batch.mapping,
    rosterVersion: batch.rosterVersion,
    result: batch.result,
    errorCode: batch.errorCode,
    analysis,
  };
}
export async function mapRosterImport(actor: Actor, id: string, input: unknown) {
  const batch = await ownBatch(actor, id);
  ensure(batch.status === 'PREVIEW', 'IMPORT_ALREADY_STARTED');
  const mapping = ImportMapping.parse(input);
  ensure(
    mapping.version === ImportMapping.parse(batch.mapping).version + 1,
    'IMPORT_MAPPING_CONFLICT',
    409,
  );
  const school = await prisma.school.findUniqueOrThrow({ where: { id: batch.schoolId } });
  await prisma.rosterImportBatch.update({
    where: { id },
    data: { mapping: json(mapping), rosterVersion: school.rosterVersion },
  });
  return rosterImportStatus(actor, id);
}
export async function commitRosterImport(
  actor: Actor,
  input: {
    importBatchId: string;
    fingerprint: string;
    mappingVersion: number;
    rosterVersion: number;
  },
) {
  const batch = await ownBatch(actor, input.importBatchId);
  ensure(batch.fingerprint === input.fingerprint, 'IMPORT_FINGERPRINT_MISMATCH');
  if (batch.status === 'SUCCEEDED' || batch.status === 'QUEUED' || batch.status === 'RUNNING')
    return rosterImportStatus(actor, batch.id);
  const mapping = ImportMapping.parse(batch.mapping);
  ensure(
    mapping.version === input.mappingVersion && batch.rosterVersion === input.rosterVersion,
    'IMPORT_PREVIEW_STALE',
    409,
  );
  const analysis = await analyzeRoster(
    actor,
    batch.schoolId,
    Scope.parse(batch.scope),
    z.array(RosterRow).parse(batch.rows),
    mapping,
  );
  ensure(!analysis.errors.length, 'IMPORT_HAS_UNRESOLVED_ERRORS', 409);
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "RosterImportBatch" WHERE id=${batch.id} FOR UPDATE`;
    const current = await tx.rosterImportBatch.findUniqueOrThrow({ where: { id: batch.id } });
    if (['QUEUED', 'RUNNING', 'SUCCEEDED'].includes(current.status)) return;
    ensure(
      current.status === 'PREVIEW' &&
        ImportMapping.parse(current.mapping).version === mapping.version,
      'IMPORT_PREVIEW_STALE',
      409,
    );
    await tx.$queryRaw`SELECT id FROM "School" WHERE id=${batch.schoolId} FOR UPDATE`;
    const school = await tx.school.findUniqueOrThrow({ where: { id: batch.schoolId } });
    ensure(school.rosterVersion === batch.rosterVersion, 'IMPORT_PREVIEW_STALE', 409);
    await tx.rosterImportBatch.update({
      where: { id: batch.id },
      data: {
        status: 'QUEUED',
        result: json({
          completed: 0,
          total: analysis.plan.length,
          plan: analysis.plan,
          teachers: {},
          classes: {},
          credentialBatchId: null,
        }),
      },
    });
  });
  await dispatchRosterImports();
  return rosterImportStatus(actor, batch.id);
}
export async function dispatchRosterImports() {
  const batches = await prisma.rosterImportBatch.findMany({
    where: { status: { in: ['QUEUED', 'RUNNING'] } },
    take: 50,
  });
  const queue = queueFor('roster');
  try {
    for (const batch of batches)
      await queue.add(
        'roster',
        { batchId: batch.id },
        {
          jobId: batch.id,
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: 200,
          removeOnFail: 200,
        },
      );
  } finally {
    await queue.close();
  }
}
const Progress = z.object({
  completed: z.number(),
  total: z.number(),
  credentialBatchId: z.string().nullable(),
  teachers: z.record(z.string(), z.string()),
  classes: z.record(z.string(), z.string()),
  plan: z.array(
    z.object({
      row: RosterRow,
      group: z.string(),
      teacherId: z.string().optional(),
      classKey: z.string(),
      classId: z.string().optional(),
      existingStudentId: z.string().optional(),
      skip: z.boolean(),
    }),
  ),
});
export async function executeRosterImport(batchId: string) {
  try {
    // Each row + its progress + credentials commits atomically. A Worker retry resumes, never resets a password.
    while (true) {
      const done = await prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "RosterImportBatch" WHERE id=${batchId} FOR UPDATE`;
          const batch = await tx.rosterImportBatch.findUniqueOrThrow({ where: { id: batchId } });
          if (batch.status === 'SUCCEEDED') return true;
          ensure(['QUEUED', 'RUNNING'].includes(batch.status), 'IMPORT_NOT_RUNNABLE');
          const owner = await tx.user.findUniqueOrThrow({ where: { id: batch.creatorId } });
          ensure(
            owner.active &&
              !owner.mustChangePassword &&
              (owner.realm === 'STUDENT' || owner.emailVerifiedAt),
            'IMPORT_OWNER_UNAVAILABLE',
          );
          const actor: Actor = {
            id: owner.id,
            name: owner.name,
            kind: AccountKind.parse(owner.kind),
            roles: accountRoles(AccountKind.parse(owner.kind)),
            schoolId: owner.schoolId,
          };
          requireSchoolScope(actor, batch.schoolId);
          ensure(
            ['SITE_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'].includes(owner.kind) &&
              (owner.kind === 'TEACHER') === (Scope.parse(batch.scope).kind === 'TEACHER'),
            'IMPORT_SCOPE_CHANGED',
          );
          const school = await tx.school.findUniqueOrThrow({ where: { id: batch.schoolId } });
          ensure(school.active, 'SCHOOL_DISABLED');
          const progress = Progress.parse(batch.result),
            scope = Scope.parse(batch.scope),
            mapping = ImportMapping.parse(batch.mapping);
          if (progress.completed >= progress.total) {
            await tx.rosterImportBatch.update({
              where: { id: batchId },
              data: { status: 'SUCCEEDED', errorCode: null },
            });
            await tx.auditLog.create({
              data: {
                actorId: actor.id,
                action: 'ROSTER_IMPORT_COMPLETED',
                resourceId: batchId,
                details: { rows: progress.total, schoolId: batch.schoolId },
              },
            });
            return true;
          }
          if (!progress.credentialBatchId)
            progress.credentialBatchId = (await createDeliveryBatch(tx, actor, batch.schoolId)).id;
          const step = progress.plan[progress.completed];
          if (!step.skip) {
            let teacherId = step.teacherId ?? progress.teachers[step.group];
            if (!teacherId) {
              const teacher = await createAccountInTransaction(
                tx,
                {
                  schoolId: batch.schoolId,
                  kind: 'TEACHER',
                  name: mapping.teachers[step.group].createName!,
                },
                progress.credentialBatchId,
              );
              teacherId = teacher.id;
              progress.teachers[step.group] = teacherId;
            }
            const teacher = await tx.user.findUniqueOrThrow({ where: { id: teacherId } });
            ensure(
              teacher.active && teacher.schoolId === batch.schoolId && teacher.kind === 'TEACHER',
              'IMPORT_TEACHER_CHANGED',
            );
            let classId = step.classId ?? progress.classes[step.classKey];
            if (!classId) {
              classId = (
                await tx.teachingClass.create({
                  data: {
                    schoolId: batch.schoolId,
                    offeringId: scope.offeringId,
                    name: step.row.className,
                    grants: { create: { userId: teacherId } },
                  },
                })
              ).id;
              progress.classes[step.classKey] = classId;
            }
            const cls = await tx.teachingClass.findUniqueOrThrow({
              where: { id: classId },
              include: { grants: true },
            });
            ensure(
              !cls.archived &&
                cls.schoolId === batch.schoolId &&
                cls.grants.some((g) => g.userId === teacherId) &&
                (owner.kind !== 'TEACHER' || teacherId === owner.id),
              'IMPORT_CLASS_CHANGED',
            );
            let student = await tx.user.findUnique({
              where: {
                schoolId_studentNumber: {
                  schoolId: batch.schoolId,
                  studentNumber: step.row.studentNumber,
                },
              },
            });
            ensure(
              !student ||
                (student.name === step.row.name && student.active && student.kind === 'STUDENT'),
              'IMPORT_STUDENT_CHANGED',
            );
            if (!student)
              student = await createAccountInTransaction(
                tx,
                {
                  schoolId: batch.schoolId,
                  kind: 'STUDENT',
                  studentNumber: step.row.studentNumber,
                  name: step.row.name,
                },
                progress.credentialBatchId,
              );
            await tx.enrollment.upsert({
              where: { userId_classId: { userId: student.id, classId } },
              create: { userId: student.id, classId },
              update: {},
            });
            await tx.school.update({
              where: { id: batch.schoolId },
              data: { rosterVersion: { increment: 1 } },
            });
          }
          progress.completed++;
          await tx.rosterImportBatch.update({
            where: { id: batchId },
            data: { status: 'RUNNING', result: json(progress) },
          });
          return false;
        },
        { timeout: 30000 },
      );
      if (done) break;
    }
  } catch (error) {
    await prisma.rosterImportBatch.update({
      where: { id: batchId },
      data: {
        errorCode:
          error instanceof Error && /^[A-Z_]+$/.test(error.message)
            ? error.message
            : 'IMPORT_RETRY_REQUIRED',
      },
    });
    throw error;
  }
}

export async function retryRosterImport(actor: Actor, id: string) {
  const batch = await ownBatch(actor, id);
  ensure(['RUNNING', 'QUEUED'].includes(batch.status) && batch.errorCode, 'IMPORT_NOT_RETRYABLE');
  const queue = queueFor('roster');
  try {
    const job = await queue.getJob(id);
    if (job && ['failed', 'completed'].includes(await job.getState())) await job.remove();
  } finally {
    await queue.close();
  }
  await prisma.rosterImportBatch.update({ where: { id }, data: { errorCode: null } });
  await dispatchRosterImports();
  return rosterImportStatus(actor, id);
}
