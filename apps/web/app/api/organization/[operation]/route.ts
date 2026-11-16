import { z } from 'zod';
import { prisma } from '@tuheng/database';
import { ensure } from '@tuheng/domain';
import { actor } from '../../../../lib/auth';
import { checkOrigin, errorResponse, limitedBody } from '../../../../lib/http';
import * as org from '../../../../../../packages/infrastructure/src/organization';
const text = z.string().trim().min(1).max(100),
  id = z.string().min(1).max(100);
const Commands = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('create-school'),
    name: text,
    administratorName: text,
    proof: z.string(),
  }),
  z.object({ operation: z.literal('rename-school'), id, name: text, proof: z.string() }),
  z.object({ operation: z.literal('create-teacher'), schoolId: id, name: text }),
  z.object({
    operation: z.literal('create-course'),
    schoolId: id,
    title: text,
    code: text,
    term: text,
  }),
  z.object({
    operation: z.literal('create-class'),
    schoolId: id,
    offeringId: id,
    name: text,
    teacherId: id,
  }),
  z.object({
    operation: z.literal('upsert-student'),
    schoolId: id,
    name: text,
    studentNumber: text,
    classIds: z.array(id).max(50),
  }),
  z.object({ operation: z.literal('reset-password'), id, proof: z.string() }),
  z.object({
    operation: z.literal('update-account'),
    id,
    proof: z.string(),
    name: text.optional(),
    studentNumber: text.optional(),
    active: z.boolean().optional(),
  }),
  z.object({
    operation: z.literal('set-school-active'),
    id,
    active: z.boolean(),
    proof: z.string(),
  }),
  z.object({ operation: z.literal('membership'), classId: id, studentId: id, joined: z.boolean() }),
  z.object({
    operation: z.literal('update-class'),
    classId: id,
    teacherId: id.optional(),
    archived: z.boolean().optional(),
    proof: z.string(),
  }),
]);
export async function POST(request: Request, context: { params: Promise<{ operation: string }> }) {
  try {
    checkOrigin(request);
    const a = await actor('STAFF'),
      { operation } = await context.params;
    const input = Commands.parse({
      ...JSON.parse((await limitedBody(request, 20000)).toString()),
      operation,
    });
    let data: unknown;
    switch (input.operation) {
      case 'create-school':
        data = await org.createSchoolWithAdmin(a, input, input.proof);
        break;
      case 'rename-school':
        data = await org.renameSchool(a, input.id, input.name, input.proof);
        break;
      case 'create-teacher':
        data = await org.createTeacher(a, input);
        break;
      case 'create-course':
        data = await org.createCourseOffering(a, input);
        break;
      case 'create-class':
        data = await org.createClass(a, input);
        break;
      case 'upsert-student':
        data = await org.upsertStudentMembership(a, input);
        break;
      case 'reset-password':
        data = await org.resetAccountPassword(a, input.id, input.proof);
        break;
      case 'update-account':
        data = await org.updateAccount(
          a,
          input.id,
          { name: input.name, studentNumber: input.studentNumber, active: input.active },
          input.proof,
        );
        break;
      case 'set-school-active':
        data = await org.setSchoolActive(a, input.id, input.active, input.proof);
        break;
      case 'membership':
        data = await org.changeClassMembership(a, input.classId, input.studentId, input.joined);
        break;
      case 'update-class':
        data = await org.updateClass(
          a,
          input.classId,
          { teacherId: input.teacherId, archived: input.archived },
          input.proof,
        );
        break;
    }
    return Response.json({ data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return errorResponse(e);
  }
}
export async function GET(request: Request, context: { params: Promise<{ operation: string }> }) {
  try {
    const a = await actor('STAFF'),
      { operation } = await context.params,
      url = new URL(request.url);
    const q = (url.searchParams.get('q') ?? '').trim().slice(0, 100),
      page = Math.max(0, Math.min(10000, Number(url.searchParams.get('page')) || 0));
    if (operation === 'schools') {
      ensure(a.kind === 'SITE_ADMIN', 'FORBIDDEN', 403);
      const where = {
        OR: [
          { name: { contains: q, mode: 'insensitive' as const } },
          { code: { contains: q, mode: 'insensitive' as const } },
        ],
      };
      const [items, total] = await Promise.all([
        prisma.school.findMany({
          where,
          skip: page * 20,
          take: 20,
          orderBy: { code: 'asc' },
          include: { _count: { select: { users: true } } },
        }),
        prisma.school.count({ where }),
      ]);
      return Response.json({ data: { items, total, page } });
    }
    const schoolId =
      a.kind === 'SITE_ADMIN' ? id.parse(url.searchParams.get('schoolId')) : a.schoolId!;
    await org.requireActiveSchool(a, schoolId);
    if (operation === 'classes') {
      const where = {
        schoolId,
        ...(a.kind === 'TEACHER' ? { grants: { some: { userId: a.id } } } : {}),
        name: { contains: q, mode: 'insensitive' as const },
      };
      const [items, total] = await Promise.all([
        prisma.teachingClass.findMany({
          where,
          skip: page * 20,
          take: 20,
          orderBy: { name: 'asc' },
          include: {
            offering: { include: { course: true } },
            grants: { include: { user: { select: { id: true, name: true, loginId: true } } } },
            _count: { select: { enrollments: true } },
          },
        }),
        prisma.teachingClass.count({ where }),
      ]);
      return Response.json({ data: { items, total, page } });
    }
    if (operation === 'offerings')
      return Response.json({
        data: await prisma.courseOffering.findMany({
          where: { course: { schoolId } },
          include: { course: true },
          take: 200,
          orderBy: { term: 'desc' },
        }),
      });
    if (operation === 'accounts') {
      const kind = z
        .enum(['TEACHER', 'STUDENT', 'SCHOOL_ADMIN'])
        .parse(url.searchParams.get('kind') ?? 'STUDENT');
      const classId = url.searchParams.get('classId');
      if (classId) await org.requireManagedClass(a, classId);
      const access =
        a.kind === 'TEACHER'
          ? kind === 'STUDENT'
            ? {
                enrollments: {
                  some: { teachingClass: { archived: false, grants: { some: { userId: a.id } } } },
                },
              }
            : { id: a.id }
          : {};
      const where = {
        schoolId,
        kind,
        ...access,
        ...(classId ? { enrollments: { some: { classId } } } : {}),
        OR: [
          { name: { contains: q, mode: 'insensitive' as const } },
          { studentNumber: { contains: q } },
          { loginId: { contains: q, mode: 'insensitive' as const } },
        ],
      };
      const [items, total] = await Promise.all([
        prisma.user.findMany({
          where,
          skip: page * 20,
          take: 20,
          orderBy: { name: 'asc' },
          select: {
            id: true,
            name: true,
            kind: true,
            loginId: true,
            studentNumber: true,
            active: true,
            mustChangePassword: true,
            emailVerifiedAt: true,
            lastLoginAt: true,
            schoolId: true,
            enrollments: { select: { classId: true, teachingClass: { select: { name: true } } } },
          },
        }),
        prisma.user.count({ where }),
      ]);
      return Response.json(
        { data: { items, total, page } },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }
    if (operation === 'deliveries')
      return Response.json({
        data: await prisma.credentialDeliveryBatch.findMany({
          where: { schoolId, ...(a.kind === 'TEACHER' ? { creatorId: a.id } : {}) },
          select: {
            id: true,
            expiresAt: true,
            createdAt: true,
            _count: { select: { items: true } },
          },
          take: 50,
          orderBy: { createdAt: 'desc' },
        }),
      });
    return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
  } catch (e) {
    return errorResponse(e);
  }
}
