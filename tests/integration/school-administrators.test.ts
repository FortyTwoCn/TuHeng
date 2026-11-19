import { beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '@tuheng/database';
import type { Actor } from '@tuheng/domain';
import { loadIdentity } from '../../packages/infrastructure/src/identity-auth';
import { reauthenticate } from '../../packages/infrastructure/src/identity-security';
import {
  createSchoolWithAdmin,
  createSchoolAdministrator,
  setSchoolActive,
  updateAccount,
} from '../../packages/infrastructure/src/organization';
import { searchSchools } from '../../packages/infrastructure/src/organization-queries';

let root: Actor, proof: string;
beforeAll(async () => {
  const seed = await prisma.user.findUniqueOrThrow({ where: { id: 'admin' } });
  root = await loadIdentity(seed.id, 'STAFF', seed.tokenVersion, false);
  proof = (await reauthenticate(root, process.env.SEED_PASSWORD!)).proof;
});
const newSchool = () =>
  createSchoolWithAdmin(
    root,
    { name: '多管理员-' + randomUUID(), administratorName: '首位管理员' },
    proof,
  );

describe('school administrator minimum and independent credentials', () => {
  it('creates a school with an enabled administrator and atomic initial credential delivery', async () => {
    const created = await newSchool();
    const admins = await prisma.user.findMany({ where: { schoolId: created.school.id } });
    expect(admins).toHaveLength(1);
    expect(admins[0]).toMatchObject({
      id: created.accountId,
      kind: 'SCHOOL_ADMIN',
      active: true,
      mustChangePassword: true,
      emailVerifiedAt: null,
      loginId: created.loginId,
    });
    expect(
      await prisma.credentialDeliveryItem.count({
        where: { batchId: created.credentialBatchId, accountId: created.accountId },
      }),
    ).toBe(1);
    const [view] = (await searchSchools(root, { q: created.school.code })).items;
    expect(view.administrators[0]).toMatchObject({ canDeactivate: false });
  });

  it('rejects disabling the last enabled school administrator without mutating tokens, roster or audit', async () => {
    const created = await newSchool();
    const before = await prisma.user.findUniqueOrThrow({ where: { id: created.accountId } });
    const auditBefore = await prisma.auditLog.count({ where: { resourceId: created.accountId } });
    await expect(
      updateAccount(root, before.id, { active: false }, proof, created.school.id),
    ).rejects.toMatchObject({ message: 'LAST_ACTIVE_SCHOOL_ADMIN', status: 409 });
    expect(await prisma.user.findUnique({ where: { id: before.id } })).toEqual(before);
    expect(await prisma.school.findUnique({ where: { id: created.school.id } })).toEqual(
      created.school,
    );
    expect(await prisma.auditLog.count({ where: { resourceId: before.id } })).toBe(auditBefore);
    // Renaming and retaining active status are still allowed for the last administrator.
    await updateAccount(
      root,
      before.id,
      { name: '已更名管理员', active: true },
      proof,
      created.school.id,
    );
  });

  it('serializes concurrent deactivation and ignores disabled or foreign-school administrators', async () => {
    const created = await newSchool();
    const second = await createSchoolAdministrator(
      root,
      { schoolId: created.school.id, name: '第二管理员' },
      proof,
    );
    const foreign = await newSchool();
    await expect(
      updateAccount(root, second.id, { active: false }, proof, foreign.school.id),
    ).rejects.toMatchObject({ status: 403 });
    const calls = await Promise.allSettled(
      [created.accountId, second.id].map((id) =>
        updateAccount(root, id, { active: false }, proof, created.school.id),
      ),
    );
    expect(calls.filter((c) => c.status === 'fulfilled')).toHaveLength(1);
    expect(calls.filter((c) => c.status === 'rejected')).toMatchObject([
      { reason: { message: 'LAST_ACTIVE_SCHOOL_ADMIN', status: 409 } },
    ]);
    const admins = await prisma.user.findMany({
      where: { schoolId: created.school.id, kind: 'SCHOOL_ADMIN' },
    });
    expect(admins.filter((a) => a.active)).toHaveLength(1);
    const enabled = admins.find((a) => a.active)!,
      disabled = admins.find((a) => !a.active)!;
    await expect(
      updateAccount(root, enabled.id, { active: false }, proof, created.school.id),
    ).rejects.toMatchObject({ status: 409 });
    await updateAccount(root, disabled.id, { active: true }, proof, created.school.id);
    await updateAccount(root, enabled.id, { active: false }, proof, created.school.id);
    expect(
      await prisma.user.count({
        where: { schoolId: created.school.id, kind: 'SCHOOL_ADMIN', active: true },
      }),
    ).toBe(1);
  });

  it('repairs an old disabled school before re-enabling it, without permitting a school with no enabled administrator', async () => {
    const school = await prisma.school.create({
      data: { code: 'empty-' + randomUUID(), name: '旧停用学校', active: false },
    });
    await expect(setSchoolActive(root, school.id, true, proof)).rejects.toMatchObject({
      message: 'SCHOOL_ADMIN_REQUIRED',
      status: 409,
    });
    const admin = await createSchoolAdministrator(
      root,
      { schoolId: school.id, name: '补建管理员' },
      proof,
    );
    expect((await prisma.school.findUniqueOrThrow({ where: { id: school.id } })).active).toBe(
      false,
    );
    await setSchoolActive(root, school.id, true, proof);
    await setSchoolActive(root, school.id, false, proof);
    await expect(
      updateAccount(root, admin.id, { active: false }, proof, school.id),
    ).rejects.toMatchObject({ message: 'LAST_ACTIVE_SCHOOL_ADMIN', status: 409 });
    await setSchoolActive(root, school.id, true, proof);
  });
});
