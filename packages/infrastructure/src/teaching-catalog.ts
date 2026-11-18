import type { Prisma } from '@prisma/client';
import { prisma } from '@tuheng/database';
import { ensure, requireSchoolScope, type Actor } from '@tuheng/domain';

type Tx = Prisma.TransactionClient;
export async function lockOrganization(tx: Tx, actor: Actor, schoolId: string) {
  requireSchoolScope(actor, schoolId);
  ensure(['SITE_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'].includes(actor.kind ?? ''), 'FORBIDDEN', 403);
  const schools = await tx.$queryRaw<
    { active: boolean }[]
  >`SELECT active FROM "School" WHERE id=${schoolId} FOR UPDATE`;
  ensure(schools[0]?.active, 'SCHOOL_DISABLED', 403);
  const owner = await tx.user.findUnique({
    where: { id: actor.id },
    select: { active: true, kind: true, schoolId: true },
  });
  ensure(
    owner?.active &&
      owner.kind === actor.kind &&
      (owner.kind === 'SITE_ADMIN' || owner.schoolId === schoolId),
    'ACCOUNT_FORBIDDEN',
    403,
  );
}
export function courseNumber(code: string, schoolId: string) {
  const prefix = schoolId + ':';
  return code.startsWith(prefix) ? code.slice(prefix.length) : code;
}
async function catalogWrite<T>(
  actor: Actor,
  schoolId: string,
  action: string,
  work: (tx: Tx) => Promise<T & { id: string }>,
) {
  requireSchoolScope(actor, schoolId);
  ensure(actor.kind === 'SITE_ADMIN' || actor.kind === 'SCHOOL_ADMIN', 'CATALOG_FORBIDDEN', 403);
  return prisma.$transaction(async (tx) => {
    await lockOrganization(tx, actor, schoolId);
    const record = await work(tx);
    await tx.school.update({ where: { id: schoolId }, data: { rosterVersion: { increment: 1 } } });
    await tx.auditLog.create({
      data: { actorId: actor.id, action, resourceId: record.id, details: { schoolId } },
    });
    return record;
  });
}
async function checkedCode(tx: Tx, schoolId: string, code: string, except?: string) {
  const stored = schoolId + ':' + code;
  ensure(!code.startsWith(schoolId + ':'), 'INVALID_COURSE_CODE');
  ensure(
    !(await tx.course.findFirst({
      where: { schoolId, code: { in: [stored, code] }, id: except ? { not: except } : undefined },
    })),
    'COURSE_CODE_CONFLICT',
    409,
  );
  return stored;
}
async function getCourse(tx: Tx, schoolId: string, id: string) {
  const course = await tx.course.findFirst({ where: { id, schoolId } });
  ensure(course, 'COURSE_NOT_FOUND', 404);
  return course;
}
export async function getOffering(tx: Tx, schoolId: string, id: string) {
  const offering = await tx.courseOffering.findFirst({
    where: { id, course: { schoolId } },
    include: { course: true },
  });
  ensure(offering, 'OFFERING_NOT_FOUND', 404);
  return offering;
}
export function requireOpenOffering(offering: {
  archived: boolean;
  course: { archived: boolean };
}) {
  ensure(!offering.archived && !offering.course.archived, 'CATALOG_ARCHIVED', 409);
}
export async function createCourse(
  actor: Actor,
  input: { schoolId: string; code: string; title: string },
) {
  const course = await catalogWrite(actor, input.schoolId, 'COURSE_CREATED', async (tx) =>
    tx.course.create({
      data: {
        schoolId: input.schoolId,
        title: input.title,
        code: await checkedCode(tx, input.schoolId, input.code),
      },
    }),
  );
  return { ...course, code: courseNumber(course.code, input.schoolId) };
}
export async function updateCourse(
  actor: Actor,
  input: { schoolId: string; courseId: string; code?: string; title?: string; archived?: boolean },
) {
  const updated = await catalogWrite(actor, input.schoolId, 'COURSE_UPDATED', async (tx) => {
    const course = await getCourse(tx, input.schoolId, input.courseId);
    ensure(
      !course.archived ||
        (input.archived === false && input.code === undefined && input.title === undefined),
      'CATALOG_ARCHIVED',
      409,
    );
    return tx.course.update({
      where: { id: course.id },
      data: {
        title: input.title,
        archived: input.archived,
        code:
          input.code === undefined
            ? undefined
            : await checkedCode(tx, input.schoolId, input.code, course.id),
      },
    });
  });
  return { ...updated, code: courseNumber(updated.code, input.schoolId) };
}
async function checkTerm(tx: Tx, courseId: string, term: string, except?: string) {
  const existing = await tx.courseOffering.findUnique({
    where: { courseId_term: { courseId, term } },
  });
  ensure(!existing || existing.id === except, 'OFFERING_TERM_CONFLICT', 409);
}
export function createOffering(
  actor: Actor,
  input: { schoolId: string; courseId: string; term: string },
) {
  return catalogWrite(actor, input.schoolId, 'OFFERING_CREATED', async (tx) => {
    const course = await getCourse(tx, input.schoolId, input.courseId);
    ensure(!course.archived, 'CATALOG_ARCHIVED', 409);
    await checkTerm(tx, course.id, input.term);
    return tx.courseOffering.create({ data: { courseId: course.id, term: input.term } });
  });
}
export function updateOffering(
  actor: Actor,
  input: { schoolId: string; offeringId: string; term?: string; archived?: boolean },
) {
  return catalogWrite(actor, input.schoolId, 'OFFERING_UPDATED', async (tx) => {
    const offering = await getOffering(tx, input.schoolId, input.offeringId);
    ensure(
      !offering.course.archived &&
        (!offering.archived || (input.archived === false && input.term === undefined)),
      'CATALOG_ARCHIVED',
      409,
    );
    if (input.term !== undefined) await checkTerm(tx, offering.courseId, input.term, offering.id);
    return tx.courseOffering.update({
      where: { id: offering.id },
      data: { term: input.term, archived: input.archived },
    });
  });
}
