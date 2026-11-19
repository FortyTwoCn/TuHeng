import { prisma } from '@tuheng/database';
import { ensure, requireSchoolScope, schoolAdministratorPolicy, type Actor } from '@tuheng/domain';
import { requireActiveSchool, requireManagedClass } from './organization';
import { courseNumber } from './teaching-catalog';

export const pageSize = 20;
export type Search = {
  q?: string;
  page?: string;
  courseId?: string;
  offeringId?: string;
  classId?: string;
  kind?: string;
  open?: string;
};
function paging(search: Search) {
  const page = Math.min(100000, Math.max(0, Math.trunc(Number(search.page) || 0)));
  return {
    page,
    args: { skip: page * pageSize, take: pageSize },
    contains: { contains: (search.q ?? '').trim().slice(0, 100), mode: 'insensitive' as const },
  };
}
export function selectedSchool(actor: Actor, schoolId?: string) {
  const school = actor.kind === 'SITE_ADMIN' ? schoolId : actor.schoolId;
  ensure(school, 'SELECT_SCHOOL_REQUIRED');
  if (schoolId) requireSchoolScope(actor, schoolId);
  return school;
}
export async function searchSchools(actor: Actor, search: Search) {
  ensure(actor.kind === 'SITE_ADMIN', 'FORBIDDEN', 403);
  const { page, args, contains } = paging(search),
    where = { OR: [{ name: contains }, { code: contains }] };
  const [items, total] = await Promise.all([
    prisma.school.findMany({
      where,
      ...args,
      orderBy: { code: 'asc' },
      include: {
        _count: { select: { users: true } },
        users: {
          where: { kind: 'SCHOOL_ADMIN' },
          select: {
            id: true,
            name: true,
            loginId: true,
            active: true,
            mustChangePassword: true,
            emailVerifiedAt: true,
          },
        },
      },
    }),
    prisma.school.count({ where }),
  ]);
  const counts = await prisma.user.groupBy({
    by: ['schoolId', 'kind'],
    where: { schoolId: { in: items.map((s) => s.id) }, kind: { in: ['TEACHER', 'STUDENT'] } },
    _count: true,
  });
  return {
    items: items.map(({ users, ...s }) => {
      const policy = schoolAdministratorPolicy(users.filter((u) => u.active).length);
      return {
        ...s,
        canActivate: policy.canEnableSchool,
        administrators: users.map((u) => ({
          ...u,
          canDeactivate: !u.active || policy.canDisable,
          emailVerifiedAt: u.emailVerifiedAt?.toISOString() ?? null,
        })),
        counts: {
          teachers: counts.find((c) => c.schoolId === s.id && c.kind === 'TEACHER')?._count ?? 0,
          students: counts.find((c) => c.schoolId === s.id && c.kind === 'STUDENT')?._count ?? 0,
        },
      };
    }),
    total,
    page,
  };
}
export async function organizationSchool(actor: Actor, schoolId: string) {
  await requireActiveSchool(actor, schoolId);
  ensure(['SITE_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'].includes(actor.kind ?? ''), 'FORBIDDEN', 403);
  return prisma.school.findUniqueOrThrow({
    where: { id: schoolId },
    select: { id: true, name: true, code: true, active: true },
  });
}
export async function schoolOverview(actor: Actor, schoolId: string) {
  const school = await organizationSchool(actor, schoolId);
  ensure(actor.kind !== 'TEACHER', 'FORBIDDEN', 403);
  const [teachers, students, courses, offerings, classes] = await Promise.all([
    prisma.user.count({ where: { schoolId, kind: 'TEACHER', active: true } }),
    prisma.user.count({ where: { schoolId, kind: 'STUDENT', active: true } }),
    prisma.course.count({ where: { schoolId, archived: false } }),
    prisma.courseOffering.count({
      where: { archived: false, course: { schoolId, archived: false } },
    }),
    prisma.teachingClass.count({
      where: {
        schoolId,
        archived: false,
        offering: { archived: false, course: { schoolId, archived: false } },
      },
    }),
  ]);
  return { school, teachers, students, courses, offerings, classes };
}
export async function people(actor: Actor, schoolId: string, search: Search) {
  await organizationSchool(actor, schoolId);
  const { page, args, contains } = paging(search),
    kind = search.kind ?? 'STUDENT';
  ensure(['STUDENT', 'TEACHER', 'SCHOOL_ADMIN'].includes(kind), 'INVALID_ACCOUNT_KIND');
  if (kind === 'SCHOOL_ADMIN') ensure(actor.kind === 'SITE_ADMIN', 'FORBIDDEN', 403);
  if (search.classId)
    ensure(
      (await requireManagedClass(actor, search.classId, prisma, true)).schoolId === schoolId,
      'SCOPE_MISMATCH',
      403,
    );
  const scopedClass = {
    schoolId,
    ...(actor.kind === 'TEACHER' ? { grants: { some: { userId: actor.id } } } : {}),
  };
  const where = {
    schoolId,
    kind,
    ...(search.open === '1' ? { active: true } : {}),
    ...(actor.kind === 'TEACHER' && kind === 'TEACHER' ? { id: actor.id } : {}),
    ...((actor.kind === 'TEACHER' && kind === 'STUDENT') || search.classId
      ? { enrollments: { some: { classId: search.classId, teachingClass: scopedClass } } }
      : {}),
    ...(search.open === '1' ? { active: true } : {}),
    OR: [
      { name: contains },
      { studentNumber: contains },
      { emailNormalized: contains },
      { loginId: contains },
    ],
  };
  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where,
      ...args,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
        kind: true,
        loginId: true,
        schoolId: true,
        studentNumber: true,
        active: true,
        mustChangePassword: true,
        emailVerifiedAt: true,
        lastLoginAt: true,
        enrollments: {
          where: { teachingClass: scopedClass },
          select: { classId: true, teachingClass: { select: { name: true } } },
        },
        grants: {
          where: { teachingClass: scopedClass },
          select: { classId: true, teachingClass: { select: { name: true } } },
        },
      },
    }),
    prisma.user.count({ where }),
  ]);
  return {
    items: items.map((u) => ({
      ...u,
      studentNumber: u.studentNumber ?? undefined,
      loginId: u.loginId ?? undefined,
      lastLoginAt: u.lastLoginAt?.toISOString(),
      emailVerifiedAt: u.emailVerifiedAt?.toISOString(),
    })),
    total,
    page,
  };
}
export async function courseList(actor: Actor, schoolId: string, search: Search) {
  await organizationSchool(actor, schoolId);
  const { page, args, contains } = paging(search),
    where = {
      schoolId,
      ...(actor.kind === 'TEACHER' ? { archived: false } : {}),
      OR: [{ title: contains }, { code: contains }, { offerings: { some: { term: contains } } }],
    };
  const [items, total] = await Promise.all([
    prisma.course.findMany({
      where,
      ...args,
      orderBy: [{ title: 'asc' }, { id: 'asc' }],
      include: { _count: { select: { offerings: true } } },
    }),
    prisma.course.count({ where }),
  ]);
  return { items: items.map((c) => ({ ...c, code: courseNumber(c.code, schoolId) })), total, page };
}
export async function courseDetail(actor: Actor, schoolId: string, id: string) {
  await organizationSchool(actor, schoolId);
  const course = await prisma.course.findFirst({
    where: { id, schoolId, ...(actor.kind === 'TEACHER' ? { archived: false } : {}) },
  });
  ensure(course, 'COURSE_NOT_FOUND', 404);
  return { ...course, code: courseNumber(course.code, schoolId) };
}
export async function offeringList(actor: Actor, schoolId: string, search: Search) {
  await organizationSchool(actor, schoolId);
  const { page, args, contains } = paging(search),
    open = search.open === '1' || actor.kind === 'TEACHER';
  const where = {
    course: { schoolId, ...(open ? { archived: false } : {}) },
    courseId: search.courseId,
    ...(open ? { archived: false } : {}),
    OR: [{ term: contains }, { course: { title: contains } }, { course: { code: contains } }],
  };
  const [items, total] = await Promise.all([
    prisma.courseOffering.findMany({
      where,
      ...args,
      orderBy: [{ term: 'desc' }, { id: 'asc' }],
      include: { course: { select: { title: true, archived: true } } },
    }),
    prisma.courseOffering.count({ where }),
  ]);
  return {
    items: items.map((o) => ({ ...o, name: o.course.title + ' · ' + o.term })),
    total,
    page,
  };
}
export async function offeringDetail(
  actor: Actor,
  schoolId: string,
  id: string,
  courseId?: string,
) {
  await organizationSchool(actor, schoolId);
  const v = await prisma.courseOffering.findFirst({
    where: { id, courseId, course: { schoolId } },
    include: { course: true },
  });
  ensure(v, 'OFFERING_NOT_FOUND', 404);
  return v;
}
export async function classList(actor: Actor, schoolId: string, search: Search) {
  await organizationSchool(actor, schoolId);
  const { page, args, contains } = paging(search),
    open = search.open === '1';
  const where = {
    schoolId,
    offeringId: search.offeringId,
    offering: {
      courseId: search.courseId,
      course: { schoolId, ...(open ? { archived: false } : {}) },
      ...(open ? { archived: false } : {}),
    },
    ...(open ? { archived: false } : {}),
    ...(actor.kind === 'TEACHER' ? { grants: { some: { userId: actor.id } } } : {}),
    OR: [
      { name: contains },
      { offering: { term: contains } },
      { offering: { course: { title: contains } } },
    ],
  };
  const [items, total] = await Promise.all([
    prisma.teachingClass.findMany({
      where,
      ...args,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      include: {
        offering: { include: { course: { select: { id: true, title: true, archived: true } } } },
        grants: { include: { user: { select: { id: true, name: true, loginId: true } } } },
        _count: { select: { enrollments: true } },
      },
    }),
    prisma.teachingClass.count({ where }),
  ]);
  return { items, total, page };
}
export async function classDetail(actor: Actor, schoolId: string, id: string) {
  const row = await requireManagedClass(actor, id, prisma, true);
  ensure(row.schoolId === schoolId, 'CLASS_NOT_FOUND', 404);
  const [grants, legacy, snapshots] = await Promise.all([
    prisma.teachingGrant.findMany({
      where: { classId: id },
      include: { user: { select: { id: true, name: true, loginId: true } } },
    }),
    prisma.assignment.count({ where: { classId: id, status: 'PUBLISHED', audienceRevision: 0 } }),
    prisma.assignmentRecipient.findMany({
      where: { active: true, classIds: { has: id } },
      select: { assignmentId: true },
      distinct: ['assignmentId'],
    }),
  ]);
  return { ...row, grants, legacy, snapshots: snapshots.length };
}
