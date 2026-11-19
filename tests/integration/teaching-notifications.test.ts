import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SMTPServer } from 'smtp-server';
import { readFile } from 'node:fs/promises';
import { database, prisma } from '@tuheng/database';
import { defaultNotificationPreferences, type AnnouncementAudience } from '@tuheng/contracts';
import {
  createQuestion,
  createAssignment,
  publishAssignment,
  reviewGrade,
  publishGrade,
  appealGrade,
  resolveAppeal,
  saveDraft,
  submitAnswer,
  scanAssignmentDeadlines,
  saveNotificationPreferences,
  previewAnnouncement,
  publishAnnouncement,
  saveAnnouncement,
  announcementPeoplePage,
  type Actor,
} from '@tuheng/domain';
import { uploadAsset } from '@tuheng/infrastructure';
import {
  notificationPage,
  markNotificationsRead,
} from '../../packages/infrastructure/src/notification-inbox';
import { dispatchNotificationMail } from '../../packages/infrastructure/src/notification-delivery';
import { requestFixture } from '../fixtures';

const tag = crypto.randomUUID();
const prefs = { ...defaultNotificationPreferences, emailEnabled: true };
let teacher: Actor,
  peer: Actor,
  student: Actor,
  partial: Actor,
  complete: Actor,
  excluded: Actor,
  otherSchool: Actor;
let cls: string,
  schoolId: string,
  assignmentId: string,
  postalId: string,
  attemptId: string,
  itemIds: string[];
let server: SMTPServer;
let smtpEnabled: string[];
let deliveryMode: 'accept' | 'defer' = 'accept';
const mail: { recipient: string; message: string }[] = [];

beforeAll(async () => {
  server = new SMTPServer({
    authOptional: true,
    disabledCommands: ['AUTH', 'STARTTLS'],
    onData(stream, session, done) {
      let message = '';
      stream.on('data', (chunk) => {
        message += String(chunk);
      });
      stream.on('end', () => {
        if (deliveryMode === 'defer')
          return done(
            Object.assign(new Error('test SMTP temporary rejection'), { responseCode: 451 }),
          );
        mail.push({ recipient: session.envelope.rcptTo[0].address, message });
        done();
      });
    },
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.server.address() as { port: number }).port;
  process.env.TUHENG_OUTBOUND_ALLOWLIST = '127.0.0.1:' + port;
  smtpEnabled = (await prisma.sMTPConfigurationVersion.findMany({ where: { enabled: true } })).map(
    (item) => item.id,
  );
  await prisma.sMTPConfigurationVersion.updateMany({ data: { enabled: false } });
  const lastSmtp = await prisma.sMTPConfigurationVersion.findFirst({
    orderBy: { version: 'desc' },
  });
  postalId = (
    await prisma.sMTPConfigurationVersion.create({
      data: {
        version: (lastSmtp?.version ?? 0) + 1,
        enabled: true,
        config: {
          name: '教学邮件测试',
          host: '127.0.0.1',
          port,
          tls: 'LOCAL_TEST',
          username: '',
          fromName: '图衡',
          fromEmail: 'tuheng@test.invalid',
          timeoutMs: 3000,
          perMinute: 60,
        },
      },
    })
  ).id;
  schoolId = (await prisma.school.create({ data: { code: 'NOTE-' + tag, name: '通知测试学校' } }))
    .id;
  const elsewhere = await prisma.school.create({
    data: { code: 'OTHER-' + tag, name: '另一所学校' },
  });
  async function user(name: string, kind: 'TEACHER' | 'STUDENT', scope = schoolId): Promise<Actor> {
    const u = await prisma.user.create({
      data: {
        name,
        email: '',
        passwordHash: 'test-only',
        roles: [kind],
        kind,
        schoolId: scope,
        mustChangePassword: false,
        realm: kind === 'STUDENT' ? 'STUDENT' : 'STAFF',
        ...(name === '草稿学生' || name === '部分学生'
          ? {
              emailNormalized: `${name === '草稿学生' ? 'draft' : 'partial'}-${tag}@test.invalid`,
              emailVerifiedAt: new Date(),
            }
          : {}),
      },
    });
    return { id: u.id, name, kind, schoolId: scope, roles: [kind] };
  }
  [teacher, peer, student, partial, complete, excluded, otherSchool] = await Promise.all([
    user('发布教师', 'TEACHER'),
    user('协作教师', 'TEACHER'),
    user('草稿学生', 'STUDENT'),
    user('部分学生', 'STUDENT'),
    user('完成学生', 'STUDENT'),
    user('排除学生', 'STUDENT'),
    user('外校学生', 'STUDENT', elsewhere.id),
  ]);
  const course = await prisma.course.create({
    data: { code: 'NOTE-' + tag, title: '工程制图', schoolId },
  });
  const term = await prisma.courseOffering.create({ data: { term: '秋季', courseId: course.id } });
  cls = (
    await prisma.teachingClass.create({
      data: {
        schoolId,
        offeringId: term.id,
        name: '通知一班',
        grants: { create: [teacher, peer].map((u) => ({ userId: u.id })) },
        enrollments: {
          create: [student, partial, complete, excluded].map((u) => ({ userId: u.id })),
        },
      },
    })
  ).id;
});
afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (postalId)
    await prisma.sMTPConfigurationVersion.update({
      where: { id: postalId },
      data: { enabled: false },
    });
  if (smtpEnabled?.length)
    await prisma.sMTPConfigurationVersion.updateMany({
      where: { id: { in: smtpEnabled } },
      data: { enabled: true },
    });
  await prisma.$disconnect();
});

describe.sequential('transactional teaching notifications and real local SMTP', () => {
  it('freezes actual publication recipients and only queues future opted-in mail', async () => {
    await saveNotificationPreferences(database, student, prefs);
    const f = requestFixture();
    const question = await createQuestion(database, teacher, {
      title: '投影测试题',
      content: f.question.content,
      type: f.question.type,
      chapter: '',
      knowledgeIds: [],
      assetIds: [],
      reference: f.reference,
      rubric: { ...f.rubric, items: f.rubric.items.map((item) => ({ ...item, knowledgeIds: [] })) },
      confirmed: true,
    });
    const assignment = await createAssignment(database, teacher, {
      title: '投影作业 · 课程通知',
      classId: cls,
      audience: {
        version: 1,
        schoolId,
        include: { allEligibleInScope: false, classIds: [cls], studentIds: [student.id] },
        exclude: { studentIds: [excluded.id] },
      },
      questionVersionIds: [question.id, question.id],
      startsAt: new Date(Date.now() - 90_000),
      dueAt: new Date(Date.now() + 4 * 3600_000),
      allowLate: true,
      maxAttempts: 2,
      releaseAnswers: false,
    });
    assignmentId = assignment.id;
    expect(await prisma.userNotification.count({ where: { resourceId: assignment.id } })).toBe(0);
    await publishAssignment(database, teacher, assignment.id);
    itemIds = (
      await prisma.assignmentItem.findMany({
        where: { assignmentId },
        orderBy: { position: 'asc' },
      })
    ).map((row) => row.id);
    const receipts = await prisma.userNotification.findMany({
      where: { resourceId: assignment.id },
      include: { delivery: true },
    });
    expect(receipts.map((row) => row.userId).sort()).toEqual(
      [student.id, partial.id, complete.id].sort(),
    );
    expect(receipts.filter((row) => row.delivery).map((row) => row.userId)).toEqual([student.id]);
    await saveNotificationPreferences(database, partial, prefs);
    expect(
      await prisma.notificationDelivery.count({
        where: { notification: { userId: partial.id, resourceId: assignmentId } },
      }),
    ).toBe(0);
    const studentNotice = receipts.find((row) => row.userId === student.id)!;
    const changed = 'updated-' + tag + '@test.invalid';
    await prisma.user.update({
      where: { id: student.id },
      data: { emailNormalized: changed, emailVerifiedAt: new Date() },
    });
    deliveryMode = 'defer';
    await dispatchNotificationMail(1, studentNotice.id);
    expect(
      await prisma.notificationDelivery.findUniqueOrThrow({
        where: { notificationId: studentNotice.id },
      }),
    ).toMatchObject({ state: 'PENDING', attempts: 1, errorCode: 'SMTP_TEMPORARY_REJECTION' });
    expect(
      (await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId } })).status,
    ).toBe('PUBLISHED');
    deliveryMode = 'accept';
    await prisma.notificationDelivery.update({
      where: { notificationId: studentNotice.id },
      data: { nextAttemptAt: new Date(0) },
    });
    await Promise.all([
      dispatchNotificationMail(1, studentNotice.id),
      dispatchNotificationMail(1, studentNotice.id),
    ]);
    expect(mail.map((row) => row.recipient)).toEqual([changed]);
    expect(mail[0].message.replace(/=\r?\n/g, '')).toContain(
      '/student/profile#notification-settings',
    );
    expect(mail[0].message).not.toContain(otherSchool.name);
    expect(
      await prisma.notificationDelivery.findUniqueOrThrow({
        where: { notificationId: studentNotice.id },
      }),
    ).toMatchObject({ state: 'SUBMITTED_TO_SMTP', attempts: 2 });
  });

  it('counts drafts and missing items, ignores grading state and invalidates stale queued reminders', async () => {
    const now = new Date();
    const image = await readFile('tests/samples/projection.png');
    async function attach(actor: Actor, itemId: string, draft = false) {
      const { id } = await uploadAsset(actor, {
        file: { name: 'answer.png', bytes: image },
        target: { kind: 'ASSIGNMENT_ANSWER', itemId },
      });
      if (draft) {
        await saveDraft(database, actor, itemId, [id]);
        return;
      }
      return submitAnswer(database, actor, {
        itemId,
        assetIds: [id],
        idempotencyKey: crypto.randomUUID(),
      });
    }
    await attach(student, itemIds[0], true);
    attemptId = (await attach(partial, itemIds[0]))!.id;
    await attach(complete, itemIds[0]);
    await attach(complete, itemIds[1]);
    await prisma.gradingRun.updateMany({
      where: { attempt: { ownerId: complete.id } },
      data: { status: 'FAILED' },
    });
    await scanAssignmentDeadlines(database, now);
    expect(
      await prisma.userNotification.count({
        where: { resourceId: assignmentId, kind: 'ASSIGNMENT_DUE' },
      }),
    ).toBe(0);
    await prisma.assignmentRecipient.updateMany({
      where: { assignmentId },
      data: { activeSince: new Date(+now - 31 * 60_000) },
    });
    await Promise.all([
      scanAssignmentDeadlines(database, now),
      scanAssignmentDeadlines(database, now),
    ]);
    const notices = await prisma.userNotification.findMany({
      where: { resourceId: assignmentId, kind: 'ASSIGNMENT_DUE' },
    });
    expect(notices).toHaveLength(2);
    expect(notices.find((n) => n.userId === student.id)?.summary).toContain('2 题未提交');
    expect(notices.find((n) => n.userId === partial.id)?.summary).toContain('1 题未提交');
    await attach(partial, itemIds[1]);
    await dispatchNotificationMail(1, notices.find((n) => n.userId === partial.id)!.id);
    expect(
      await prisma.notificationDelivery.findUniqueOrThrow({
        where: { notificationId: notices.find((n) => n.userId === partial.id)!.id },
      }),
    ).toMatchObject({ state: 'SKIPPED' });
    const old = notices.find((n) => n.userId === student.id)!;
    await prisma.assignment.update({
      where: { id: assignmentId },
      data: { dueAt: new Date(+now + 6 * 3600_000) },
    });
    await scanAssignmentDeadlines(database, now);
    await dispatchNotificationMail(1, old.id);
    expect(
      await prisma.notificationDelivery.findUniqueOrThrow({ where: { notificationId: old.id } }),
    ).toMatchObject({ state: 'SKIPPED' });
    expect(
      await prisma.userNotification.count({
        where: { userId: student.id, resourceId: assignmentId, kind: 'ASSIGNMENT_DUE' },
      }),
    ).toBe(2);
    await prisma.assignment.update({
      where: { id: assignmentId },
      data: { dueAt: new Date(+now - 1) },
    });
    await scanAssignmentDeadlines(database, now);
    expect(
      await prisma.userNotification.count({
        where: { userId: student.id, resourceId: assignmentId, kind: 'ASSIGNMENT_DUE' },
      }),
    ).toBe(2);
  });

  it('only releases actual formal grades and separates appeal results from grade changes', async () => {
    const decisionInput = {
      attemptId,
      items: [
        { criterionId: 'geometry', points: 70, evidence: '投影关系有误' },
        { criterionId: 'drawing', points: 20, evidence: '图线清楚' },
      ],
      feedback: '检查投影对齐',
      annotations: [],
      aiIncorrect: false,
    };
    const first = await reviewGrade(database, teacher, decisionInput);
    expect(await prisma.userNotification.count({ where: { resourceId: first.id } })).toBe(0);
    await publishGrade(database, teacher, first.id);
    await publishGrade(database, teacher, first.id);
    expect(
      await prisma.userNotification.count({
        where: { resourceId: first.id, kind: 'GRADE_PUBLISHED' },
      }),
    ).toBe(1);
    const appeal = await appealGrade(database, partial, attemptId, '请求检查相关投影标注。');
    expect(
      (
        await prisma.userNotification.findMany({
          where: { resourceId: appeal.id, kind: 'APPEAL_OPENED' },
        })
      ).map((row) => row.userId),
    ).toEqual([teacher.id]);
    await expect(resolveAppeal(database, peer, appeal.id, '未经授权的回复')).rejects.toMatchObject({
      status: 403,
    });
    await resolveAppeal(database, teacher, appeal.id, '已完成核对，结论请查看说明。');
    expect(
      await prisma.submissionAttempt.findUniqueOrThrow({ where: { id: attemptId } }),
    ).toMatchObject({ publishedDecisionId: first.id });
    const revision = await reviewGrade(database, teacher, decisionInput);
    await publishGrade(database, teacher, revision.id);
    const page = await notificationPage(partial, {});
    expect(
      page.items.some((n) => n.title === '申诉已有处理结果' && n.href?.endsWith('#appeals')),
    ).toBe(true);
    expect(page.items.some((n) => n.title === '题目正式成绩已更新')).toBe(true);
  });

  it('publishes frozen announcements to people directly and protects read cursors and choices', async () => {
    const base: AnnouncementAudience = {
      scope: { kind: 'SCHOOL', schoolId },
      allStudents: false,
      allTeachers: false,
      studentClassIds: [],
      teacherClassIds: [],
      personIds: [peer.id, student.id, partial.id],
      excludeIds: [],
    };
    const input = { title: '班级通知 · 图纸讲评', body: '周五讲评本周图纸。', audience: base };
    await expect(
      previewAnnouncement(database, teacher, {
        ...input,
        audience: { ...base, personIds: [otherSchool.id] },
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      previewAnnouncement(database, teacher, {
        ...input,
        audience: { ...base, scope: { kind: 'PLATFORM' } },
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      (
        await announcementPeoplePage(database, teacher, base.scope, {
          kind: 'TEACHER',
          classId: cls,
        })
      ).items
        .map((p) => p.id)
        .sort(),
    ).toEqual([teacher.id, peer.id].sort());
    const draft = await saveAnnouncement(database, teacher, input);
    expect(await prisma.userNotification.count({ where: { resourceId: draft.id } })).toBe(0);
    const old = (await notificationPage(student, { pageSize: 1 })).readThrough;
    const preview = await previewAnnouncement(database, teacher, input);
    expect(preview).toMatchObject({ count: 3, teachers: 1 });
    const publication = {
      id: draft.id,
      revision: draft.revision,
      fingerprint: preview.fingerprint,
    };
    await Promise.all([
      publishAnnouncement(database, teacher, publication),
      publishAnnouncement(database, teacher, publication),
    ]);
    const recipients = await prisma.announcementRecipient.findMany({
      where: { announcementId: draft.id },
    });
    expect(recipients.map((p) => p.userId).sort()).toEqual(
      [student.id, partial.id, peer.id].sort(),
    );
    await prisma.enrollment.deleteMany({ where: { userId: student.id, classId: cls } });
    expect((await notificationPage(student, { category: 'ANNOUNCEMENT' })).items[0].href).toBe(
      `/student/announcements/${draft.id}`,
    );
    expect((await notificationPage(peer, { category: 'ANNOUNCEMENT' })).items[0].href).toBe(
      `/teacher/announcements/${draft.id}`,
    );
    await markNotificationsRead(student, { through: Number(old) });
    expect((await notificationPage(student, { unread: true })).items).toHaveLength(1);
    const own = (await notificationPage(student, { unread: true })).items[0];
    await markNotificationsRead(peer, { ids: [own.id] });
    expect((await notificationPage(student, { unread: true })).unreadCount).toBe(1);
    await markNotificationsRead(student, { ids: [own.id] });
    const latest = await notificationPage(student, { pageSize: 1 });
    expect(latest.unreadCount).toBe(0);
    expect(
      (await notificationPage(student, { before: Number(latest.nextCursor), pageSize: 1 })).items[0]
        .id,
    ).not.toBe(latest.items[0].id);
    await saveNotificationPreferences(database, partial, {
      ...prefs,
      categories: { ...prefs.categories, ANNOUNCEMENT: false },
    });
    await saveNotificationPreferences(database, partial, prefs);
    const afterOptOut = await prisma.userNotification.findFirstOrThrow({
      where: { resourceId: draft.id, userId: partial.id },
    });
    await dispatchNotificationMail(1, afterOptOut.id);
    expect(
      await prisma.notificationDelivery.findUniqueOrThrow({
        where: { notificationId: afterOptOut.id },
      }),
    ).toMatchObject({ state: 'SKIPPED' });
  });
});
