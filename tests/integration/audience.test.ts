import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma, database as db } from '@tuheng/database';
import {
  resolveAudience,
  createAssignment,
  publishAssignment,
  createQuestion,
  listAssignments,
  assignmentDetails,
  saveDraft,
  requireAssignmentReviewer,
  reviseAssignmentAudience,
  type Actor,
} from '@tuheng/domain';
import type { AudienceSelection } from '@tuheng/contracts';
import { requestFixture } from '../fixtures';
const tag = randomUUID();
let teacher: Actor,
  other: Actor,
  student: Actor,
  excluded: Actor,
  late: Actor,
  schoolId: string,
  cls: string,
  cls2: string,
  selection: AudienceSelection,
  assignmentId: string,
  itemId: string,
  questionId: string;
beforeAll(async () => {
  schoolId = (await prisma.school.create({ data: { code: 'AUD-' + tag, name: '名单测试学校' } }))
    .id;
  const make = async (name: string, kind: 'TEACHER' | 'STUDENT'): Promise<Actor> => {
    const u = await prisma.user.create({
      data: {
        name,
        email: '',
        kind,
        realm: kind === 'STUDENT' ? 'STUDENT' : 'STAFF',
        schoolId,
        roles: [kind],
        passwordHash: 'test-only-not-a-login-hash',
        mustChangePassword: false,
        studentNumber: kind === 'STUDENT' ? name : null,
      },
    });
    return { id: u.id, name, kind, schoolId, roles: [kind] };
  };
  teacher = await make('教师', 'TEACHER');
  other = await make('未授权复核教师', 'TEACHER');
  student = await make('001', 'STUDENT');
  excluded = await make('002', 'STUDENT');
  late = await make('003', 'STUDENT');
  const course = await prisma.course.create({ data: { title: '几何', code: tag, schoolId } }),
    offering = await prisma.courseOffering.create({ data: { courseId: course.id, term: '2026' } });
  const create = async (name: string) =>
    (
      await prisma.teachingClass.create({
        data: {
          name,
          schoolId,
          offeringId: offering.id,
          grants: { create: { userId: teacher.id } },
        },
      })
    ).id;
  cls = await create('一班');
  cls2 = await create('二班');
  await prisma.enrollment.createMany({
    data: [
      { userId: student.id, classId: cls },
      { userId: student.id, classId: cls2 },
      { userId: excluded.id, classId: cls },
    ],
  });
  selection = {
    version: 1,
    schoolId,
    include: { allEligibleInScope: true, classIds: [], studentIds: [] },
    exclude: { studentIds: [excluded.id] },
  };
  const f = requestFixture(),
    q = await createQuestion(db, teacher, {
      title: '名单测试',
      content: f.question.content,
      type: f.question.type,
      chapter: '第一章',
      knowledgeIds: [],
      assetIds: [],
      reference: f.reference,
      rubric: { ...f.rubric, items: f.rubric.items.map((i) => ({ ...i, knowledgeIds: [] })) },
      confirmed: true,
    });
  questionId = q.id;
});
afterAll(async () => {
  await prisma.$disconnect();
});
describe.sequential('assignment recipients actually authorize business operations', () => {
  it('AU01/03: all eligible excludes one, shared multi-class student is deduplicated', async () => {
    const r = await resolveAudience(db, teacher, selection);
    expect(r.count).toBe(1);
    expect(r.recipients[0].studentId).toBe(student.id);
    expect(r.recipients[0].classIds).toHaveLength(2);
    await expect(
      resolveAudience(db, teacher, {
        ...selection,
        include: { ...selection.include, studentIds: [late.id] },
      }),
    ).rejects.toThrow('AUDIENCE_SCOPE_FORBIDDEN');
  });
  it('AU04: publishes a frozen snapshot; subsequent class membership does not grant access', async () => {
    const a = await createAssignment(db, teacher, {
      title: '校级名单测试',
      audience: selection,
      rosterVersion: 0,
      questionVersionIds: [questionId],
      startsAt: new Date(Date.now() - 60000),
      dueAt: new Date(Date.now() + 86400000),
      allowLate: false,
      maxAttempts: 2,
      releaseAnswers: false,
    });
    assignmentId = a.id;
    itemId = (await db.list('assignmentItem', { assignmentId }))[0].id;
    await publishAssignment(db, teacher, assignmentId, 0);
    await prisma.enrollment.create({ data: { userId: late.id, classId: cls } });
    await prisma.school.update({
      where: { id: schoolId },
      data: { rosterVersion: { increment: 1 } },
    });
    expect((await listAssignments(db, student)).map((a) => a.id)).toContain(assignmentId);
    expect((await listAssignments(db, excluded)).map((a) => a.id)).not.toContain(assignmentId);
    expect((await listAssignments(db, late)).map((a) => a.id)).not.toContain(assignmentId);
    await expect(assignmentDetails(db, excluded, assignmentId)).rejects.toThrow(
      'ASSIGNMENT_RECIPIENT_REQUIRED',
    );
    await expect(saveDraft(db, excluded, itemId, [])).rejects.toThrow(
      'ASSIGNMENT_RECIPIENT_REQUIRED',
    );
    await expect(saveDraft(db, student, itemId, [])).resolves.toHaveProperty('userId', student.id);
  });
  it('AU05: being in the school does not grant review permission', async () => {
    const ass = await db.get('assignment', assignmentId);
    await expect(requireAssignmentReviewer(db, other, ass!, student.id)).rejects.toThrow(
      'REVIEWER_NOT_ASSIGNED',
    );
    await expect(requireAssignmentReviewer(db, teacher, ass!, student.id)).resolves.toBeUndefined();
  });
  it('AU02/04: explicit roster revision adds an individual and rejects stale preview', async () => {
    await expect(
      reviseAssignmentAudience(db, teacher, assignmentId, selection, 1, 0, [teacher.id]),
    ).rejects.toThrow('AUDIENCE_PREVIEW_STALE');
    await reviseAssignmentAudience(db, teacher, assignmentId, selection, 1, 1, [teacher.id]);
    expect((await listAssignments(db, late)).map((a) => a.id)).toContain(assignmentId);
    expect((await listAssignments(db, excluded)).map((a) => a.id)).not.toContain(assignmentId);
  });
});
