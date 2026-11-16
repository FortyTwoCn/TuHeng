import { hash } from 'bcryptjs';
import type { Prisma } from '@prisma/client';
import { prisma } from '@tuheng/database';
import { AccountKind } from '@tuheng/contracts';
import {
  accountRoles,
  ensure,
  requireIdentityManager,
  requireSchoolScope,
  type Actor,
} from '@tuheng/domain';
import { encryptSecret } from './secret-store';
import {
  invalidateCredentials,
  requireRecentAuthentication,
  temporaryPassword,
} from './identity-security';

export async function nextLoginId(tx: Prisma.TransactionClient, prefix: 'S' | 'T') {
  const pattern = '^' + prefix + '[0-9]+$';
  const maxima = await tx.$queryRaw<
    { value: number }[]
  >`SELECT COALESCE(MAX(substring("loginId" from 2)::integer),0)::integer AS value FROM "User" WHERE "loginId" ~ ${pattern}`;
  const baseline = maxima[0].value;
  const rows = await tx.$queryRaw<
    { value: number }[]
  >`INSERT INTO "IdentitySequence" (id,value) VALUES (${prefix},${baseline + 1}) ON CONFLICT (id) DO UPDATE SET value=GREATEST("IdentitySequence".value,${baseline})+1 RETURNING value`;
  return prefix + String(rows[0].value).padStart(6, '0');
}
export async function requireActiveSchool(actor: Actor, schoolId: string) {
  requireSchoolScope(actor, schoolId);
  ensure(
    (await prisma.school.findUnique({ where: { id: schoolId } }))?.active,
    'SCHOOL_DISABLED',
    403,
  );
}
export async function requireManagedClass(
  actor: Actor,
  classId: string,
  tx: Prisma.TransactionClient = prisma,
  allowArchived = false,
) {
  const cls = await tx.teachingClass.findUnique({ where: { id: classId } });
  ensure(cls?.schoolId && (allowArchived || !cls.archived), 'CLASS_UNAVAILABLE', 403);
  requireSchoolScope(actor, cls.schoolId);
  ensure(['SITE_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'].includes(actor.kind ?? ''), 'FORBIDDEN', 403);
  if (actor.kind === 'TEACHER')
    ensure(
      await tx.teachingGrant.findUnique({
        where: { userId_classId: { userId: actor.id, classId } },
      }),
      'CLASS_FORBIDDEN',
      403,
    );
  return cls;
}
export async function createDeliveryBatch(
  tx: Prisma.TransactionClient,
  actor: Actor,
  schoolId: string,
) {
  return tx.credentialDeliveryBatch.create({
    data: { creatorId: actor.id, schoolId, expiresAt: new Date(Date.now() + 86400000) },
  });
}
export async function createAccountInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    name: string;
    kind: 'SCHOOL_ADMIN' | 'TEACHER' | 'STUDENT';
    schoolId: string;
    studentNumber?: string;
    loginId?: string;
  },
  batchId: string,
) {
  const password = temporaryPassword();
  const secret = encryptSecret(password, 'TEMPORARY_PASSWORD');
  const user = await tx.user.create({
    data: {
      name: input.name,
      kind: input.kind,
      realm: input.kind === 'STUDENT' ? 'STUDENT' : 'STAFF',
      schoolId: input.schoolId,
      studentNumber: input.studentNumber,
      loginId: input.loginId ?? (input.kind === 'TEACHER' ? await nextLoginId(tx, 'T') : null),
      email: '',
      roles: accountRoles(input.kind),
      passwordHash: await hash(password, 12),
      mustChangePassword: true,
      credentialVersion: 1,
      passwordExpiresAt: new Date(Date.now() + 7 * 86400000),
    },
  });
  const expiresAt = new Date(Date.now() + 86400000);
  await tx.secretRecord.create({ data: { ...secret, expiresAt } });
  await tx.credentialDeliveryItem.create({
    data: { batchId, accountId: user.id, credentialVersion: 1, secretId: secret.id, expiresAt },
  });
  return user;
}
export async function createSchoolWithAdmin(
  actor: Actor,
  input: { name: string; administratorName: string },
  proof: string,
) {
  ensure(actor.kind === 'SITE_ADMIN' && !actor.onboarding, 'FORBIDDEN', 403);
  await requireRecentAuthentication(actor, proof);
  return prisma.$transaction(async (tx) => {
    const code = await nextLoginId(tx, 'S');
    const school = await tx.school.create({ data: { code, name: input.name } });
    const batch = await createDeliveryBatch(tx, actor, school.id);
    const account = await createAccountInTransaction(
      tx,
      { name: input.administratorName, kind: 'SCHOOL_ADMIN', schoolId: school.id, loginId: code },
      batch.id,
    );
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        action: 'SCHOOL_CREATED',
        resourceId: school.id,
        details: { accountId: account.id },
      },
    });
    return { school, accountId: account.id, loginId: account.loginId, credentialBatchId: batch.id };
  });
}
export async function createTeacher(actor: Actor, input: { schoolId: string; name: string }) {
  requireIdentityManager(actor, input.schoolId, 'TEACHER');
  await requireActiveSchool(actor, input.schoolId);
  return prisma.$transaction(async (tx) => {
    const batch = await createDeliveryBatch(tx, actor, input.schoolId);
    const user = await createAccountInTransaction(tx, { ...input, kind: 'TEACHER' }, batch.id);
    await tx.school.update({
      where: { id: input.schoolId },
      data: { rosterVersion: { increment: 1 } },
    });
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        action: 'TEACHER_CREATED',
        resourceId: user.id,
        details: { schoolId: input.schoolId },
      },
    });
    return { id: user.id, loginId: user.loginId, credentialBatchId: batch.id };
  });
}
export async function createCourseOffering(
  actor: Actor,
  input: { schoolId: string; title: string; code: string; term: string },
) {
  await requireActiveSchool(actor, input.schoolId);
  ensure(actor.kind !== 'STUDENT', 'FORBIDDEN', 403);
  return prisma.$transaction(async (tx) => {
    const course = await tx.course.create({
      data: {
        schoolId: input.schoolId,
        title: input.title,
        code: input.schoolId + ':' + input.code,
      },
    });
    const offering = await tx.courseOffering.create({
      data: { courseId: course.id, term: input.term },
    });
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        action: 'COURSE_CREATED',
        resourceId: course.id,
        details: { schoolId: input.schoolId },
      },
    });
    return offering;
  });
}
export async function createClass(
  actor: Actor,
  input: { schoolId: string; offeringId: string; name: string; teacherId: string },
) {
  await requireActiveSchool(actor, input.schoolId);
  ensure(
    actor.kind !== 'STUDENT' && (actor.kind !== 'TEACHER' || input.teacherId === actor.id),
    'FORBIDDEN',
    403,
  );
  return prisma.$transaction(async (tx) => {
    const teacher = await tx.user.findUnique({ where: { id: input.teacherId } });
    const offering = await tx.courseOffering.findUnique({
      where: { id: input.offeringId },
      include: { course: true },
    });
    ensure(
      teacher?.kind === 'TEACHER' &&
        teacher.schoolId === input.schoolId &&
        teacher.active &&
        offering?.course.schoolId === input.schoolId,
      'SCOPE_MISMATCH',
      403,
    );
    const cls = await tx.teachingClass.create({
      data: {
        schoolId: input.schoolId,
        offeringId: input.offeringId,
        name: input.name,
        grants: { create: { userId: input.teacherId } },
      },
    });
    await tx.school.update({
      where: { id: input.schoolId },
      data: { rosterVersion: { increment: 1 } },
    });
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        action: 'CLASS_CREATED',
        resourceId: cls.id,
        details: { schoolId: input.schoolId },
      },
    });
    return cls;
  });
}
export async function upsertStudentMembership(
  actor: Actor,
  input: { schoolId: string; name: string; studentNumber: string; classIds: string[] },
) {
  requireIdentityManager(actor, input.schoolId, 'STUDENT');
  await requireActiveSchool(actor, input.schoolId);
  ensure(actor.kind !== 'TEACHER' || input.classIds.length, 'CLASS_REQUIRED');
  return prisma.$transaction(async (tx) => {
    for (const id of input.classIds)
      ensure(
        (await requireManagedClass(actor, id, tx)).schoolId === input.schoolId,
        'SCOPE_MISMATCH',
      );
    let user = await tx.user.findUnique({
      where: {
        schoolId_studentNumber: { schoolId: input.schoolId, studentNumber: input.studentNumber },
      },
    });
    ensure(
      !user || (user.kind === 'STUDENT' && user.name === input.name && user.active),
      'STUDENT_IDENTITY_CONFLICT',
      409,
    );
    let batchId: string | undefined;
    if (!user) {
      const batch = await createDeliveryBatch(tx, actor, input.schoolId);
      batchId = batch.id;
      user = await createAccountInTransaction(tx, { ...input, kind: 'STUDENT' }, batchId);
    }
    for (const classId of [...new Set(input.classIds)])
      await tx.enrollment.upsert({
        where: { userId_classId: { userId: user.id, classId } },
        create: { userId: user.id, classId },
        update: {},
      });
    await tx.school.update({
      where: { id: input.schoolId },
      data: { rosterVersion: { increment: 1 } },
    });
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        action: 'STUDENT_MEMBERSHIP_UPSERTED',
        resourceId: user.id,
        details: { classIds: input.classIds, created: !!batchId },
      },
    });
    return { id: user.id, credentialBatchId: batchId, reused: !batchId };
  });
}
export async function requireManagedAccount(actor: Actor, id: string) {
  const target = await prisma.user.findUniqueOrThrow({ where: { id } });
  ensure(target.schoolId && target.id !== actor.id, 'ACCOUNT_FORBIDDEN', 403);
  requireIdentityManager(actor, target.schoolId, AccountKind.parse(target.kind));
  if (actor.kind === 'TEACHER')
    ensure(
      await prisma.enrollment.findFirst({
        where: {
          userId: id,
          teachingClass: {
            schoolId: actor.schoolId,
            grants: { some: { userId: actor.id } },
            archived: false,
          },
        },
      }),
      'ACCOUNT_FORBIDDEN',
      403,
    );
  return target;
}
export async function resetAccountPassword(actor: Actor, id: string, proof: string) {
  const target = await requireManagedAccount(actor, id);
  await requireRecentAuthentication(actor, proof);
  const password = temporaryPassword(),
    expiresAt = new Date(Date.now() + 86400000);
  return prisma.$transaction(async (tx) => {
    await invalidateCredentials(tx, id);
    const user = await tx.user.update({
      where: { id },
      data: {
        passwordHash: await hash(password, 12),
        credentialVersion: { increment: 1 },
        tokenVersion: { increment: 1 },
        mustChangePassword: true,
        passwordExpiresAt: new Date(Date.now() + 7 * 86400000),
      },
    });
    const batch = await createDeliveryBatch(tx, actor, target.schoolId!);
    const secret = await tx.secretRecord.create({
      data: { ...encryptSecret(password, 'TEMPORARY_PASSWORD'), expiresAt },
    });
    await tx.credentialDeliveryItem.create({
      data: {
        batchId: batch.id,
        accountId: id,
        credentialVersion: user.credentialVersion,
        secretId: secret.id,
        expiresAt,
      },
    });
    await tx.auditLog.create({
      data: { actorId: actor.id, action: 'ACCOUNT_PASSWORD_RESET', resourceId: id, details: {} },
    });
    return { credentialBatchId: batch.id };
  });
}
export async function updateAccount(
  actor: Actor,
  id: string,
  input: { name?: string; studentNumber?: string; active?: boolean },
  proof: string,
) {
  const target = await requireManagedAccount(actor, id);
  await requireRecentAuthentication(actor, proof);
  ensure(
    input.studentNumber === undefined || target.kind === 'STUDENT',
    'STUDENT_NUMBER_NOT_APPLICABLE',
  );
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { ...input, tokenVersion: { increment: 1 } } });
    await tx.school.update({
      where: { id: target.schoolId! },
      data: { rosterVersion: { increment: 1 } },
    });
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        action: 'ACCOUNT_UPDATED',
        resourceId: id,
        details: { fields: Object.keys(input) },
      },
    });
  });
  return { id };
}
export async function setSchoolActive(actor: Actor, id: string, active: boolean, proof: string) {
  ensure(actor.kind === 'SITE_ADMIN', 'FORBIDDEN', 403);
  await requireRecentAuthentication(actor, proof);
  const affected = await prisma.user.count({ where: { schoolId: id } });
  await prisma.$transaction(async (tx) => {
    await tx.school.update({ where: { id }, data: { active, rosterVersion: { increment: 1 } } });
    await tx.user.updateMany({ where: { schoolId: id }, data: { tokenVersion: { increment: 1 } } });
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        action: active ? 'SCHOOL_ENABLED' : 'SCHOOL_DISABLED',
        resourceId: id,
        details: { affected },
      },
    });
  });
  return { affected };
}
export async function changeClassMembership(
  actor: Actor,
  classId: string,
  studentId: string,
  joined: boolean,
) {
  const cls = await requireManagedClass(actor, classId);
  const student = await prisma.user.findUnique({ where: { id: studentId } });
  ensure(student?.kind === 'STUDENT' && student.schoolId === cls.schoolId, 'SCOPE_MISMATCH', 403);
  await prisma.$transaction(async (tx) => {
    if (joined)
      await tx.enrollment.upsert({
        where: { userId_classId: { userId: studentId, classId } },
        create: { userId: studentId, classId },
        update: {},
      });
    else await tx.enrollment.deleteMany({ where: { userId: studentId, classId } });
    await tx.school.update({
      where: { id: cls.schoolId! },
      data: { rosterVersion: { increment: 1 } },
    });
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        action: joined ? 'CLASS_MEMBER_JOINED' : 'CLASS_MEMBER_LEFT',
        resourceId: classId,
        details: { studentId },
      },
    });
  });
  return { classId, studentId };
}
export async function updateClass(
  actor: Actor,
  classId: string,
  input: { archived?: boolean; teacherId?: string },
  proof: string,
) {
  const cls = await requireManagedClass(actor, classId, prisma, true);
  await requireRecentAuthentication(actor, proof);
  ensure(actor.kind !== 'TEACHER' || !input.teacherId, 'HANDOFF_REQUIRES_SCHOOL_ADMIN', 403);
  await prisma.$transaction(async (tx) => {
    if (input.teacherId) {
      const teacher = await tx.user.findUnique({ where: { id: input.teacherId } });
      ensure(
        teacher?.kind === 'TEACHER' && teacher.active && teacher.schoolId === cls.schoolId,
        'SCOPE_MISMATCH',
        403,
      );
      await tx.teachingGrant.deleteMany({ where: { classId } });
      await tx.teachingGrant.create({ data: { userId: input.teacherId, classId } });
    }
    if (input.archived !== undefined)
      await tx.teachingClass.update({ where: { id: classId }, data: { archived: input.archived } });
    await tx.school.update({
      where: { id: cls.schoolId! },
      data: { rosterVersion: { increment: 1 } },
    });
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        action: 'CLASS_UPDATED',
        resourceId: classId,
        details: { ...input, publishedRecipientsUnchanged: true },
      },
    });
  });
  return { classId };
}

export async function renameSchool(actor: Actor, id: string, name: string, proof: string) {
  ensure(actor.kind === 'SITE_ADMIN', 'FORBIDDEN', 403);
  await requireRecentAuthentication(actor, proof);
  ensure(name.trim().length > 0 && name.trim().length <= 100, 'SCHOOL_NAME_INVALID');
  return prisma.$transaction(async (tx) => {
    const school = await tx.school.update({ where: { id }, data: { name: name.trim() } });
    await tx.auditLog.create({
      data: { actorId: actor.id, action: 'SCHOOL_RENAMED', resourceId: id, details: {} },
    });
    return school;
  });
}
