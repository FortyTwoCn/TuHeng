import { test, expect, type Page } from '@playwright/test';
import { prisma } from '@tuheng/database';
import { prepareLogin } from './identity-login';

async function loginRoot(page: Page) {
  await prepareLogin(page, 'admin');
  await page.getByLabel('已绑定邮箱', { exact: true }).fill('admin@tuheng.local');
  await page.getByLabel('密码', { exact: true }).fill(process.env.SEED_PASSWORD!);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL('/admin/dashboard');
}

test('S01: one settings navigation entry, legacy mail route and server permissions', async ({
  page,
}) => {
  await loginRoot(page);
  await page.goto('/admin/mail');
  await expect(page).toHaveURL('/admin/settings/mail');
  const nav = page.getByRole('navigation', { name: '主导航', exact: true });
  await expect(nav.getByRole('link', { name: '系统设置', exact: true })).toHaveCount(1);
  await expect(nav.getByRole('link', { name: '邮件服务', exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('navigation', { name: '系统设置分类' }).getByRole('link'),
  ).toHaveCount(1);
  await expect(page.getByRole('heading', { name: '系统设置', exact: true })).toBeVisible();
  await expect(page.locator('input[autocomplete="current-password"]')).toHaveCount(0);
  const student = await page.context().browser()!.newPage();
  try {
    await prepareLogin(student, 'student');
    await student.getByLabel('已绑定邮箱', { exact: true }).fill('student@tuheng.local');
    await student.getByLabel('密码', { exact: true }).fill(process.env.SEED_PASSWORD!);
    await student.getByRole('button', { name: '登录', exact: true }).click();
    await expect(student).toHaveURL('/student/dashboard');
    expect((await student.request.get('/api/settings/mail')).status()).toBe(401);
  } finally {
    await student.close();
  }
});

test('S04: authorization is requested on save; cancellation and server expiry retain the draft without replaying mutations', async ({
  page,
}) => {
  await loginRoot(page);
  await page.goto('/admin/models');
  const name = '[UI测试]再认证-' + Date.now();
  await page.getByLabel('显示名称', { exact: true }).fill(name);
  let posts = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/ai') posts++;
  });
  const save = page.getByRole('button', { name: '保存供应商版本', exact: true });
  const dialog = page.getByRole('dialog', { name: '验证身份', exact: true });
  await save.click();
  await expect(dialog).toBeVisible();
  expect(posts).toBe(0);
  await dialog.getByLabel('当前密码', { exact: true }).fill('a canceled input');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByLabel('显示名称', { exact: true })).toHaveValue(name);
  await save.click();
  await expect(dialog.getByLabel('当前密码', { exact: true })).toHaveValue('');
  await dialog.getByLabel('当前密码', { exact: true }).fill(process.env.SEED_PASSWORD!);
  await dialog.getByRole('button', { name: '验证并继续', exact: true }).click();
  await expect(page.getByText('已保存，新版本立即生效。已有调用保留原快照。')).toBeVisible();
  expect(posts).toBe(1);
  await page.getByLabel('显示名称', { exact: true }).fill(name + '-保留草稿');
  await prisma.reauthentication.updateMany({
    where: { accountId: 'admin' },
    data: { expiresAt: new Date(0) },
  });
  await save.click();
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel('显示名称', { exact: true })).toHaveValue(name + '-保留草稿');
  expect(posts).toBe(2);
  await dialog.getByLabel('当前密码', { exact: true }).fill(process.env.SEED_PASSWORD!);
  await dialog.getByRole('button', { name: '验证并继续', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(posts).toBe(2);
  await save.click();
  await expect(page.getByText('已保存，新版本立即生效。已有调用保留原快照。')).toBeVisible();
  expect(posts).toBe(3);
  const provider = await prisma.aIProvider.findFirstOrThrow({
    where: { name: name + '-保留草稿' },
  });
  expect(provider.currentVersion).toBe(2);
});
