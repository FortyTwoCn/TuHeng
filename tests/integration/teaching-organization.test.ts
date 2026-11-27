import { beforeAll, describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { addDrawing, createDocument } from '@tuheng/geometry-core';
import { prisma, database } from '@tuheng/database';
import { loadIdentity } from '../../packages/infrastructure/src/identity-auth';
import { reauthenticate } from '../../packages/infrastructure/src/identity-security';
import {
  createCourse,
  createOffering,
  updateCourse,
  updateOffering,
} from '../../packages/infrastructure/src/teaching-catalog';
import {
  createSchoolAdministrator,
  createClass,
  updateClass,
  changeClassMembership,
  upsertStudentMembership,
  updateAccount,
} from '../../packages/infrastructure/src/organization';
import {
  classDetail,
  classList,
  courseList,
  offeringDetail,
  offeringList,
  studentClassDetail,
} from '../../packages/infrastructure/src/organization-queries';
import {
  ImportMapping,
  previewRosterImport,
  commitRosterImport,
  executeRosterImport,
  rosterImportStatus,
} from '../../packages/infrastructure/src/roster-import';
import { rosterTemplate } from '../../packages/infrastructure/src/roster-xlsx';
import { activeTermRange, requestFixture } from '../fixtures';
import {
  createQuestion,
  saveDraft,
  submitAnswer,
  reviewGrade,
  publishGrade,
  accountRoles,
  createAssignment,
  publishAssignment,
  requireAssignmentReviewer,
  requireAssignmentRecipient,
  assignmentDetails,
  listAssignments,
  type Actor,
} from '@tuheng/domain';

const tag = randomUUID();
let root: Actor,
  admin: Actor,
  foreign: Actor,
  t: Actor,
  peer: Actor,
  next: Actor,
  rootProof: string,
  schoolProof: string,
  schoolId: string,
  courseId: string,
  o1: string,
  o2: string,
  c1: string,
  c2: string,
  otherCourseClass: string,
  studentId: string,
  assignmentId: string;
async function account(school: string, kind: 'TEACHER' | 'SCHOOL_ADMIN', name: string) {
  const seed = await prisma.user.findUniqueOrThrow({ where: { id: 'admin' } });
  const email = randomUUID() + '@test.invalid';
  const u = await prisma.user.create({
    data: {
      schoolId: school,
      kind,
      name,
      email,
      emailNormalized: email,
      loginId: randomUUID(),
      realm: 'STAFF',
      roles: accountRoles(kind),
      passwordHash: seed.passwordHash,
      mustChangePassword: false,
      emailVerifiedAt: new Date(),
    },
  });
  return loadIdentity(u.id, 'STAFF', u.tokenVersion, false);
}
beforeAll(async () => {
  const seed = await prisma.user.findUniqueOrThrow({ where: { id: 'admin' } });
  root = await loadIdentity(seed.id, 'STAFF', seed.tokenVersion, false);
  rootProof = (await reauthenticate(root, process.env.SEED_PASSWORD!)).proof;
  const school = async (code: string) =>
    (await prisma.school.create({ data: { code: tag + code, name: '测试学校' + code } })).id;
  schoolId = await school('A');
  admin = await account(schoolId, 'SCHOOL_ADMIN', '校管A');
  foreign = await account(await school('B'), 'SCHOOL_ADMIN', '校管B');
  [t, peer, next] = await Promise.all(
    ['张', '王', '李'].map((n) => account(schoolId, 'TEACHER', n)),
  );
  schoolProof = (await reauthenticate(admin, process.env.SEED_PASSWORD!)).proof;
});
describe.sequential('scoped teaching organization and historical assignments', () => {
  it('creates independent courses, multiple terms, and self-granted classes; conflicts are scoped', async () => {
    const dates = activeTermRange();
    courseId = (await createCourse(admin, { schoolId, title: '工程制图', code: 'G01' })).id;
    const another = await createCourse(admin, { schoolId, title: '机械设计', code: 'M01' });
    [o1, o2] = await Promise.all(
      ['2026秋', '2027春'].map(
        async (term) => (await createOffering(admin, { schoolId, courseId, term, ...dates })).id,
      ),
    );
    const sameTerm = await createOffering(admin, {
      schoolId,
      courseId: another.id,
      term: '2026秋',
      ...dates,
    });
    otherCourseClass = (
      await createClass(peer, {
        schoolId,
        offeringId: sameTerm.id,
        teacherId: peer.id,
        name: '设计班',
      })
    ).id;
    await expect(
      createOffering(admin, { schoolId, courseId, term: '2026秋', ...dates }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      createOffering(t, { schoolId, courseId, term: '无权', ...dates }),
    ).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      createOffering(foreign, { schoolId: foreign.schoolId!, courseId, term: '外校', ...dates }),
    ).rejects.toMatchObject({ status: 404 });
    c1 = (await createClass(t, { schoolId, offeringId: o1, teacherId: t.id, name: '一班' })).id;
    c2 = (await createClass(admin, { schoolId, offeringId: o2, teacherId: peer.id, name: '一班' }))
      .id;
    await expect(
      createClass(t, { schoolId, offeringId: o1, teacherId: peer.id, name: '越权' }),
    ).rejects.toMatchObject({ status: 403 });
    expect((await classList(t, schoolId, {})).items.map((c) => c.id)).toEqual([c1]);
    await expect(classDetail(t, schoolId, c2)).rejects.toMatchObject({ status: 403 });
    expect((await courseList(admin, schoolId, {})).items.map((c) => c.code).sort()).toEqual([
      'G01',
      'M01',
    ]);
    await prisma.courseOffering.createMany({
      data: Array.from({ length: 205 }, (_, i) => ({
        courseId: another.id,
        term: '分页' + String(i).padStart(3, '0'),
        ...dates,
      })),
    });
    expect(
      (await offeringList(t, schoolId, { courseId: another.id, q: '分页', page: '10' })).items,
    ).toHaveLength(5);
  });
  it('adds an existing student across terms without changing identity or credentials', async () => {
    const data = { schoolId, name: '林同学', studentNumber: '00037' };
    studentId = (await upsertStudentMembership(t, { ...data, classIds: [c1] })).id;
    const before = await prisma.user.findUniqueOrThrow({ where: { id: studentId } });
    expect(
      await upsertStudentMembership(admin, { ...data, classIds: [c2, otherCourseClass] }),
    ).toMatchObject({
      id: studentId,
      reused: true,
    });
    await expect(
      upsertStudentMembership(t, { ...data, name: '另一个姓名', classIds: [c1] }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      updateAccount(t, studentId, { name: '错名', active: false }, ''),
    ).rejects.toMatchObject({ status: 403 });
    expect(await prisma.user.findUnique({ where: { id: studentId } })).toEqual(before);
    expect(await prisma.enrollment.count({ where: { userId: studentId } })).toBe(3);
  });
  it('validates changes and derives the same status for the term and its scoped classes', async () => {
    const dates = activeTermRange();
    const term = { schoolId, courseId, term: '时间状态验证', ...dates };
    await expect(createOffering(admin, { ...term, endsAt: dates.startsAt })).rejects.toMatchObject({
      code: 'INVALID_TERM_RANGE',
      status: 400,
    });
    const offering = await createOffering(admin, term);
    const cls = await createClass(t, {
      schoolId,
      offeringId: offering.id,
      teacherId: t.id,
      name: term.term,
    });
    expect(cls).toMatchObject({ ...dates, lifecycleStatus: 'ACTIVE' });
    const update = { schoolId, offeringId: offering.id };
    await expect(
      updateOffering(admin, { ...update, startsAt: dates.endsAt, endsAt: dates.startsAt }),
    ).rejects.toMatchObject({ code: 'INVALID_TERM_RANGE', status: 400 });
    expect(await offeringDetail(admin, schoolId, offering.id)).toMatchObject(dates);

    const startsAt = new Date('2032-09-01T00:00:00Z');
    const endsAt = new Date('2032-12-31T12:00:00Z');
    const window = { startsAt, endsAt };
    const student: Actor = {
      id: studentId,
      name: '林同学',
      roles: ['STUDENT'],
      kind: 'STUDENT',
      schoolId,
    };
    await expect(studentClassDetail(student, schoolId, cls.id)).rejects.toMatchObject({
      status: 404,
    });
    await changeClassMembership(admin, cls.id, student.id, true);
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(startsAt.getTime() - 1);
      expect(await updateOffering(admin, { ...update, ...window })).toMatchObject({
        ...window,
        lifecycleStatus: 'UPCOMING',
      });
      for (const [instant, lifecycleStatus] of [
        [startsAt.getTime() - 1, 'UPCOMING'],
        [startsAt.getTime(), 'ACTIVE'],
        [endsAt.getTime(), 'ACTIVE'],
        [endsAt.getTime() + 1, 'ENDED'],
      ] as const) {
        vi.setSystemTime(instant);
        const expected = { ...window, lifecycleStatus };
        const [terms, classes, detail, studentClass] = await Promise.all([
          offeringList(admin, schoolId, { q: term.term, lifecycleStatus }),
          classList(t, schoolId, { offeringId: offering.id, lifecycleStatus }),
          classDetail(t, schoolId, cls.id),
          studentClassDetail(student, schoolId, cls.id),
        ]);
        expect(terms).toMatchObject({ total: 1, items: [{ id: offering.id, ...expected }] });
        expect(classes).toMatchObject({
          total: 1,
          items: [{ id: cls.id, ...expected, offering: expected }],
        });
        expect(detail).toMatchObject(expected);
        expect(studentClass).toMatchObject(expected);
      }
      expect(
        await classList(student, schoolId, { offeringId: offering.id, lifecycleStatus: 'ACTIVE' }),
      ).toMatchObject({ total: 0, items: [] });
    } finally {
      vi.useRealTimers();
      await changeClassMembership(admin, cls.id, student.id, false);
    }
  });
  it('preserves snapshot recipients and co-teachers across removal, handover and ancestor archive; legacy grants stay live', async () => {
    const f = requestFixture();
    const stem = createDocument('VHW_PROJECTION');
    const v = await createQuestion(database, t, {
      title: '制图题',
      geometryDocument: stem,
      content: f.question.content,
      type: f.question.type,
      chapter: '第一章',
      knowledgeIds: [],
      assetIds: [],
      reference: f.reference,
      rubric: { ...f.rubric, items: f.rubric.items.map((i) => ({ ...i, knowledgeIds: [] })) },
      confirmed: true,
    });
    const input = {
      title: '快照作业',
      classId: c1,
      questionVersionIds: [v.id],
      startsAt: new Date(0),
      dueAt: new Date(Date.now() + 86400000),
      allowLate: false,
      maxAttempts: 2,
      releaseAnswers: false,
    };
    const ass = await createAssignment(database, t, input);
    const draft = await createAssignment(database, t, { ...input, title: '归档后禁止新发布' });
    assignmentId = ass.id;
    await publishAssignment(database, t, ass.id);
    const student: Actor = {
      id: studentId,
      name: '林同学',
      kind: 'STUDENT',
      roles: ['STUDENT'],
      schoolId,
    };
    const item = (await database.list('assignmentItem', { assignmentId: ass.id }))[0];
    const answer = addDrawing(
      stem,
      'segment',
      'view-0',
      [
        { x: 2, y: 3 },
        { x: 5, y: 8 },
      ],
      'student',
    );
    await saveDraft(database, student, item.id, [], answer);
    const submit = () =>
      submitAnswer(database, student, {
        itemId: item.id,
        assetIds: [],
        geometry: answer,
        idempotencyKey: randomUUID(),
      });
    const originalAttempt = await submit();
    const review = (attemptId: string) =>
      reviewGrade(database, t, {
        attemptId,
        items: f.rubric.items.map((i) => ({
          criterionId: i.id,
          points: i.maxPoints,
          evidence: '教师逐项确认',
        })),
        feedback: '已复核工程图',
        annotations: [],
        aiIncorrect: false,
      });
    const firstDecision = await review(originalAttempt.id);
    await publishGrade(database, t, firstDecision.id);
    const historicalAttempt = await database.get('submissionAttempt', originalAttempt.id);
    const historicalGrade = await database.get('gradeDecision', firstDecision.id);
    const before = await prisma.assignmentRecipient.findMany({ where: { assignmentId: ass.id } });
    expect(await assignmentDetails(database, admin, ass.id)).toMatchObject({
      manager: true,
      teacher: false,
    });
    expect((await listAssignments(database, admin)).map((a) => a.id)).toContain(ass.id);
    const snapshot = await prisma.assignment.findUniqueOrThrow({ where: { id: ass.id } });
    const legacy = await database.create('assignment', {
      ...ass,
      id: randomUUID(),
      audience: undefined,
      audienceRevision: 0,
      status: 'PUBLISHED',
    });
    await updateClass(admin, c1, { teacherId: peer.id }, schoolProof);
    await changeClassMembership(t, c1, studentId, false);
    expect(await prisma.enrollment.count({ where: { userId: studentId } })).toBe(2);
    await updateClass(admin, c1, { fromTeacherId: t.id, teacherId: next.id }, schoolProof);
    expect((await classDetail(admin, schoolId, c1)).grants.map((g) => g.userId).sort()).toEqual(
      [peer.id, next.id].sort(),
    );
    expect(await prisma.assignmentRecipient.findMany({ where: { assignmentId: ass.id } })).toEqual(
      before,
    );
    const published = await database.get('assignment', ass.id);
    await requireAssignmentReviewer(database, t, published!, studentId);
    await expect(
      requireAssignmentReviewer(database, next, published!, studentId),
    ).rejects.toMatchObject({ status: 403 });
    await expect(requireAssignmentReviewer(database, t, legacy)).rejects.toMatchObject({
      status: 403,
    });
    await requireAssignmentReviewer(database, next, legacy);
    await updateClass(admin, c2, { archived: true }, schoolProof);
    await updateCourse(admin, { schoolId, courseId, archived: true });
    await expect(publishAssignment(database, admin, draft.id)).rejects.toBeInstanceOf(Error);
    expect((await database.get('assignment', draft.id))?.status).toBe('DRAFT');
    await expect(
      createClass(next, { schoolId, offeringId: o1, teacherId: next.id, name: '受阻' }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(changeClassMembership(next, c1, studentId, true)).rejects.toMatchObject({
      status: 409,
    });
    await requireAssignmentRecipient(
      database,
      { id: studentId, name: '林同学', kind: 'STUDENT', roles: ['STUDENT'], schoolId },
      published!,
    );
    await requireAssignmentReviewer(database, t, published!, studentId);
    const laterAttempt = await submit();
    expect(laterAttempt.version).toBe(2);
    const newGrade = await review(laterAttempt.id);
    await publishGrade(database, t, newGrade.id);
    expect(await database.get('submissionAttempt', originalAttempt.id)).toEqual(historicalAttempt);
    expect(await database.get('gradeDecision', firstDecision.id)).toEqual(historicalGrade);
    expect(await prisma.assignment.findUniqueOrThrow({ where: { id: ass.id } })).toEqual(snapshot);
    await updateCourse(admin, { schoolId, courseId, archived: false });
    expect((await classDetail(admin, schoolId, c2)).archived).toBe(true);
  });
  it('scopes identical import bytes, reuses credentials, and rechecks archived terms in the worker', async () => {
    const sheet = await rosterTemplate('TEACHER');
    const preview = async (offeringId: string) => {
      const b = await previewRosterImport(peer, {
        schoolId,
        offeringId,
        kind: 'TEACHER',
        filename: '名单.xlsx',
        bytes: sheet,
      });
      if (!('id' in b) || !b.id) throw Error('fixture preview');
      return rosterImportStatus(peer, b.id);
    };
    const commit = async (b: Awaited<ReturnType<typeof preview>>) =>
      commitRosterImport(peer, {
        importBatchId: b.id,
        mappingVersion: ImportMapping.parse(b.mapping).version,
        fingerprint: b.fingerprint,
        rosterVersion: b.rosterVersion,
      });
    const b1 = await preview(o1);
    await commit(b1);
    await executeRosterImport(b1.id);
    const original = await prisma.user.findUniqueOrThrow({
      where: { schoolId_studentNumber: { schoolId, studentNumber: '00123456' } },
    });
    const b2 = await preview(o2);
    expect(b2.id).not.toBe(b1.id);
    expect((await preview(o2)).id).toBe(b2.id);
    await updateOffering(admin, { schoolId, offeringId: o2, archived: true });
    expect(await rosterImportStatus(peer, b2.id)).toMatchObject({
      status: 'PREVIEW',
      errorCode: 'CATALOG_ARCHIVED',
    });
    await expect(commit(b2)).rejects.toThrow('CATALOG_ARCHIVED');
    await updateOffering(admin, { schoolId, offeringId: o2, archived: false });
    const activePreview = await preview(o2);
    await expect(commit(b2)).rejects.toThrow('IMPORT_PREVIEW_STALE');
    await commit(activePreview);
    await updateOffering(admin, { schoolId, offeringId: o2, archived: true });
    await expect(executeRosterImport(b2.id)).rejects.toThrow('CATALOG_ARCHIVED');
    expect(await prisma.enrollment.count({ where: { userId: original.id } })).toBe(1);
    await updateOffering(admin, { schoolId, offeringId: o2, archived: false });
    await executeRosterImport(b2.id);
    await commit(b2);
    expect(await prisma.enrollment.count({ where: { userId: original.id } })).toBe(2);
    expect(await prisma.user.findUnique({ where: { id: original.id } })).toEqual(original);
    expect(await prisma.assignmentRecipient.count({ where: { assignmentId } })).toBe(1);
  });
  it('creates distinct school administrators under concurrency, each with initial delivery and no role conversion', async () => {
    const empty = await prisma.school.create({ data: { code: 'vacant-' + tag, name: '历史学校' } });
    await expect(
      createSchoolAdministrator(admin, { schoolId: empty.id, name: '校管' }, schoolProof),
    ).rejects.toMatchObject({ status: 403 });
    const calls = await Promise.allSettled(
      [1, 2].map((n) =>
        createSchoolAdministrator(root, { schoolId: empty.id, name: '校管' + n }, rootProof),
      ),
    );
    expect(calls.filter((c) => c.status === 'fulfilled')).toHaveLength(2);
    const users = await prisma.user.findMany({ where: { schoolId: empty.id } });
    expect(new Set(users.map((u) => u.loginId)).size).toBe(2);
    for (const user of users) {
      expect(user).toMatchObject({
        kind: 'SCHOOL_ADMIN',
        roles: ['SCHOOL_ADMIN'],
        active: true,
        mustChangePassword: true,
        emailVerifiedAt: null,
      });
      expect(await prisma.credentialDeliveryItem.count({ where: { accountId: user.id } })).toBe(1);
      expect(
        await prisma.auditLog.count({
          where: { resourceId: user.id, action: 'SCHOOL_ADMIN_CREATED' },
        }),
      ).toBe(1);
    }
  });
});
