import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { database, prisma } from '@tuheng/database';
import {
  createQuestion,
  createAssignment,
  publishAssignment,
  saveDraft,
  submitAnswer,
  createSelfTest,
  collectError,
  type Actor,
} from '@tuheng/domain';
import {
  uploadAsset,
  ensureBucket,
  downloadAsset,
  readAsset,
  transformAsset,
  cancelStagedAsset,
  getObject,
} from '@tuheng/infrastructure';
import {
  archivePendingAssets,
  cleanExpiredAssets,
} from '../../packages/infrastructure/src/asset-maintenance';
import {
  replaceAvatar,
  removeAvatar,
  avatarImage,
} from '../../packages/infrastructure/src/avatars';
import { activeTermRange, requestFixture } from '../fixtures';

const tag = crypto.randomUUID();
let schoolId: string, classId: string, teacher: Actor, student: Actor, root: Actor;
let bytes: Buffer, assignmentId: string, itemId: string, questionVersionId: string;
const file = () => ({ name: 'verified-image.dat', bytes });
function question(assetIds: string[], referenceIds: string[] = []) {
  const f = requestFixture();
  return {
    title: '资源归档测试-' + tag,
    content: f.question.content,
    type: f.question.type,
    chapter: '测试',
    knowledgeIds: [],
    assetIds,
    reference: { ...f.reference, assetIds: referenceIds },
    rubric: { ...f.rubric, items: f.rubric.items.map((item) => ({ ...item, knowledgeIds: [] })) },
    confirmed: true,
  };
}
beforeAll(async () => {
  await ensureBucket();
  bytes = await sharp({ create: { width: 600, height: 400, channels: 3, background: '#21777b' } })
    .png()
    .toBuffer();
  schoolId = (await prisma.school.create({ data: { code: 'RES-' + tag, name: '资源验证学校' } }))
    .id;
  async function account(kind: 'TEACHER' | 'STUDENT'): Promise<Actor> {
    const u = await prisma.user.create({
      data: {
        name: kind,
        email: '',
        passwordHash: 'test-only',
        roles: [kind],
        kind,
        realm: kind === 'TEACHER' ? 'STAFF' : 'STUDENT',
        schoolId,
        mustChangePassword: false,
      },
    });
    return { id: u.id, name: u.name, roles: [kind], kind, schoolId };
  }
  teacher = await account('TEACHER');
  student = await account('STUDENT');
  const admin = await prisma.user.findUniqueOrThrow({ where: { id: 'admin' } });
  root = { id: admin.id, name: admin.name, roles: ['ADMIN'], kind: 'SITE_ADMIN', schoolId: null };
  const course = await prisma.course.create({
    data: { title: '制图', code: 'RES-' + tag, schoolId },
  });
  const offering = await prisma.courseOffering.create({
    data: { courseId: course.id, term: '秋季', ...activeTermRange() },
  });
  classId = (
    await prisma.teachingClass.create({
      data: {
        schoolId,
        offeringId: offering.id,
        name: '一班',
        grants: { create: { userId: teacher.id } },
        enrollments: { create: { userId: student.id } },
      },
    })
  ).id;
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe.sequential('private object lifecycle with PostgreSQL and S3', () => {
  it('stages before a question exists and archives a scoped admin upload exactly once', async () => {
    const uploaded = await uploadAsset(root, {
      file: file(),
      target: { kind: 'QUESTION', schoolId },
    });
    const initial = await prisma.storedAsset.findUniqueOrThrow({ where: { id: uploaded.id } });
    expect(initial.objectKey).toMatch(/^private\/platform\/users\/admin\/staging\/.*\.png$/);
    await expect(createQuestion(database, root, question([uploaded.id]), false)).rejects.toThrow(
      'ASSET_CONTEXT_MISMATCH',
    );
    const outcomes = await Promise.allSettled(
      [0, 1].map(() =>
        createQuestion(
          database,
          root,
          question([uploaded.id], [uploaded.id]),
          false,
          undefined,
          schoolId,
        ),
      ),
    );
    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(['fulfilled', 'rejected']);
    const winning = outcomes.find((outcome) => outcome.status === 'fulfilled')!;
    const version = winning.value;
    const task = await prisma.assetArchiveTask.findUniqueOrThrow({
      where: { assetId: uploaded.id },
    });
    expect(task.sourceKey).toBe(initial.objectKey);
    const afterBind = await prisma.storedAsset.findUniqueOrThrow({ where: { id: uploaded.id } });
    expect(afterBind.state).toBe('ARCHIVING');

    await prisma.$transaction([
      prisma.storedAsset.update({
        where: { id: uploaded.id },
        data: { checksum: 'test-mismatched-digest' },
      }),
      prisma.assetArchiveTask.update({
        where: { id: task.id },
        data: { sourceChecksum: 'test-mismatched-digest' },
      }),
    ]);
    await archivePendingAssets(1, uploaded.id);
    expect(
      await prisma.assetArchiveTask.findUniqueOrThrow({ where: { id: task.id } }),
    ).toMatchObject({
      state: 'PENDING',
      attempts: 1,
      errorCode: 'ARCHIVE_TARGET_INVALID',
    });
    expect((await downloadAsset(root, uploaded.id)).buffer).toEqual(bytes);
    await prisma.$transaction([
      prisma.storedAsset.update({
        where: { id: uploaded.id },
        data: { checksum: initial.checksum },
      }),
      prisma.assetArchiveTask.update({
        where: { id: task.id },
        data: { sourceChecksum: initial.checksum, nextAttemptAt: new Date(0) },
      }),
    ]);
    await Promise.all([archivePendingAssets(1, uploaded.id), archivePendingAssets(1, uploaded.id)]);
    const final = await prisma.storedAsset.findUniqueOrThrow({ where: { id: uploaded.id } });
    expect(final).toMatchObject({
      state: 'ARCHIVED',
      ownerId: root.id,
      storageSchoolId: schoolId,
      storageSubjectUserId: null,
      objectKey: `private/schools/${schoolId}/question-bank/questions/${version.questionId}/assets/originals/${uploaded.id}.png`,
    });
    expect(await getObject(final.objectKey)).toEqual(bytes);
    expect(await getObject(initial.objectKey)).toEqual(bytes);
    const updated = await createQuestion(
      database,
      root,
      question([uploaded.id], [uploaded.id]),
      false,
      version.questionId,
    );
    expect(updated.assetIds).toEqual(version.assetIds);
    await createQuestion(
      database,
      root,
      question([uploaded.id]),
      false,
      undefined,
      schoolId,
      updated.id,
    );
    expect(await prisma.assetArchiveTask.count({ where: { assetId: uploaded.id } })).toBe(1);
  });

  it('reuses answer originals across a draft and two attempts and preserves manual lineage', async () => {
    const q = await createQuestion(database, teacher, question([]));
    questionVersionId = q.id;
    const assignment = await createAssignment(database, teacher, {
      title: '两次提交',
      classId,
      questionVersionIds: [q.id],
      startsAt: new Date(Date.now() - 60_000),
      dueAt: new Date(Date.now() + 3600_000),
      allowLate: false,
      maxAttempts: 2,
      releaseAnswers: false,
    });
    assignmentId = assignment.id;
    await publishAssignment(database, teacher, assignmentId);
    itemId = (await prisma.assignmentItem.findFirstOrThrow({ where: { assignmentId } })).id;
    const target = { kind: 'ASSIGNMENT_ANSWER', itemId } as const;
    const original = await uploadAsset(student, { file: file(), target });
    const transformed = await transformAsset(student, {
      id: original.id,
      target,
      options: {
        maxDimension: 2400,
        rotate: 90,
        crop: null,
      },
    });
    await saveDraft(database, student, itemId, [transformed.id]);
    await archivePendingAssets(1, original.id);
    await archivePendingAssets(1, transformed.id);
    const base = `private/schools/${schoolId}/users/${student.id}/assignments/${assignmentId}/items/${itemId}/assets/`;
    expect(
      await prisma.storedAsset.findUniqueOrThrow({ where: { id: original.id } }),
    ).toMatchObject({
      objectKey: base + `originals/${original.id}.png`,
    });
    expect(
      await prisma.storedAsset.findUniqueOrThrow({ where: { id: transformed.id } }),
    ).toMatchObject({
      objectKey: base + `edits/${original.id}/${transformed.id}.png`,
      parentId: original.id,
      width: 400,
      height: 600,
    });
    const a = await submitAnswer(database, student, {
      itemId,
      assetIds: [transformed.id],
      idempotencyKey: crypto.randomUUID(),
    });
    const b = await submitAnswer(database, student, {
      itemId,
      assetIds: [transformed.id],
      idempotencyKey: crypto.randomUUID(),
    });
    expect(a.id).not.toBe(b.id);
    expect(await prisma.submissionAsset.count({ where: { assetId: transformed.id } })).toBe(2);
    expect(await prisma.assetArchiveTask.count({ where: { assetId: transformed.id } })).toBe(1);
    vi.stubEnv('S3_PUBLIC_ACCESS', 'true');
    vi.stubEnv('S3_PUBLIC_READ_BASE_URL', 'https://assets.example.test/tuheng/');
    try {
      await expect(readAsset(teacher, transformed.id, false)).resolves.toMatchObject({
        location:
          'https://assets.example.test/tuheng/' +
          base +
          `edits/${original.id}/${transformed.id}.png`,
      });
      const proxy = await readAsset(teacher, transformed.id, true);
      expect(proxy.location).toBeUndefined();
      const editBytes = Buffer.from(await new Response(proxy.stream).arrayBuffer());
      expect(editBytes.length).toBeGreaterThan(0);
      expect(editBytes).toEqual((await downloadAsset(teacher, transformed.id)).buffer);
      const privateOriginal = await readAsset(student, original.id, false);
      expect(privateOriginal.location).toBeUndefined();
      expect(Buffer.from(await new Response(privateOriginal.stream).arrayBuffer())).toEqual(bytes);
    } finally {
      vi.unstubAllEnvs();
    }
    expect((await collectError(database, student, a.id)).questionVersionId).toBe(q.id);
  });
  it('archives private self-test and review work and does not reap active or bound uploads', async () => {
    const combined = await uploadAsset(student, {
      file: file(),
      target: { kind: 'QUESTION', selfTest: true },
    });
    const set = await createSelfTest(database, student, {
      title: '自测归档',
      folderId: null,
      mode: 'COMBINED',
      question: question([combined.id], [combined.id]),
    });
    const selfItem = await prisma.selfTestItem.findFirstOrThrow({ where: { setId: set.id } });
    const self = await uploadAsset(student, {
      file: file(),
      target: { kind: 'SELFTEST_ANSWER', itemId: selfItem.id },
    });
    await submitAnswer(database, student, {
      selfTestItemId: selfItem.id,
      assetIds: [self.id],
      idempotencyKey: crypto.randomUUID(),
    });
    await archivePendingAssets(1, self.id);
    expect(
      (await prisma.storedAsset.findUniqueOrThrow({ where: { id: self.id } })).objectKey,
    ).toContain(`/self-tests/${set.id}/items/${selfItem.id}/assets/originals/`);
    const entry = await prisma.errorBookEntry.findFirstOrThrow({
      where: { ownerId: student.id, questionVersionId },
    });
    const review = await uploadAsset(student, {
      file: file(),
      target: { kind: 'REVIEW_ANSWER', entryId: entry.id },
    });
    await submitAnswer(database, student, {
      reviewEntryId: entry.id,
      assetIds: [review.id],
      idempotencyKey: crypto.randomUUID(),
    });
    await archivePendingAssets(1, review.id);
    expect(
      (await prisma.storedAsset.findUniqueOrThrow({ where: { id: review.id } })).objectKey,
    ).toContain(`/error-book/${entry.id}/assets/originals/`);
    const staged = await uploadAsset(student, {
      file: file(),
      target: { kind: 'ASSIGNMENT_ANSWER', itemId },
    });
    await prisma.storedAsset.update({
      where: { id: staged.id },
      data: { discardAfter: new Date(0) },
    });
    await cleanExpiredAssets();
    expect(await prisma.storedAsset.findUnique({ where: { id: staged.id } })).toBeTruthy();
    const cancelled = await prisma.storedAsset.findUniqueOrThrow({ where: { id: staged.id } });
    await cancelStagedAsset(student, staged.id);
    await cleanExpiredAssets();
    expect(await prisma.storedAsset.findUnique({ where: { id: staged.id } })).toBeNull();
    await expect(getObject(cancelled.objectKey)).rejects.toThrow();
    await expect(downloadAsset(teacher, combined.id)).rejects.toMatchObject({ status: 403 });
    expect((await downloadAsset(student, combined.id)).buffer).toEqual(bytes);
  });
  it('validates avatar bytes, isolates access and rejects stale concurrent replacement', async () => {
    const crop = { x: 0.4, y: 0.7, zoom: 2 };
    const first = await replaceAvatar(student, 0, bytes, crop);
    const avatar = await avatarImage(student, first.avatarAssetId, 'small');
    expect(await sharp(avatar).metadata()).toMatchObject({
      width: 128,
      height: 128,
      format: 'webp',
    });
    await expect(avatarImage(teacher, first.avatarAssetId, 'small')).rejects.toMatchObject({
      status: 404,
    });
    await expect(downloadAsset(student, first.avatarAssetId)).rejects.toMatchObject({
      status: 403,
    });
    await expect(replaceAvatar(student, 1, Buffer.from('forged'), crop)).rejects.toThrow(
      'INVALID_AVATAR_IMAGE',
    );
    const outcomes = await Promise.allSettled(
      [0, 1].map(() => replaceAvatar(student, 1, bytes, crop)),
    );
    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(['fulfilled', 'rejected']);
    const winner = outcomes.find((outcome) => outcome.status === 'fulfilled')!.value;
    const large = await avatarImage(student, winner.avatarAssetId, 'large');
    expect(await sharp(large).metadata()).toMatchObject({
      width: 512,
      height: 512,
      format: 'webp',
    });
    await expect(removeAvatar(student, 1)).rejects.toThrow('AVATAR_CHANGED');
    await removeAvatar(student, 2);
    await expect(avatarImage(student, winner.avatarAssetId, 'large')).rejects.toMatchObject({
      status: 404,
    });
  });
});
