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
test('G06/G07: scoped personnel details protect unsaved edits and stay usable on a phone', async ({
  page,
}) => {
  await loginRoot(page);
  const name = '[UI测试]人员-' + Date.now();
  const create = await page.request.post('/api/organization/create-teacher', {
    headers: { Origin: 'http://localhost:3000' },
    data: { schoolId: 'school-demo', name },
  });
  expect(create.ok()).toBe(true);
  await page.goto('/admin/users');
  await page.getByLabel('搜索学校', { exact: true }).fill('图衡自动化测试学校');
  await page
    .getByRole('combobox', { name: '当前操作学校', exact: true })
    .selectOption('school-demo');
  await page.getByLabel('搜索姓名 / 登录 ID / 学号', { exact: true }).fill(name);
  const row = page.locator('.organization-row').filter({ hasText: name });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: '查看详情', exact: true }).click();
  const detail = page.getByRole('dialog', { name: '教师详情：' + name, exact: true });
  await detail.getByLabel('姓名', { exact: true }).fill(name + '-未保存');
  await page.keyboard.press('Escape');
  const warning = page.getByRole('dialog', { name: '未保存的修改', exact: true });
  await expect(warning).toBeVisible();
  await warning.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(detail.getByLabel('姓名', { exact: true })).toHaveValue(name + '-未保存');
  await detail.getByRole('button', { name: '关闭对话框', exact: true }).click();
  await warning.getByRole('button', { name: '丢弃修改', exact: true }).click();
  await expect(detail).not.toBeVisible();
  await expect(row).not.toContainText('-未保存');
  await page.setViewportSize({ width: 390, height: 844 });
  await row.getByRole('button', { name: '查看详情', exact: true }).click();
  await expect(detail.getByLabel('姓名', { exact: true })).toHaveValue(name);
  expect(await detail.evaluate((d) => d.scrollWidth <= d.clientWidth + 1)).toBe(true);
  const bounds = await detail.boundingBox();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(845);
  await page.screenshot({
    path: '.runtime/ui-redesign/evidence/person-detail-390.png',
    fullPage: false,
  });
  await detail.getByLabel('姓名', { exact: true }).fill(name + '-已更新');
  await detail.getByRole('button', { name: '保存资料', exact: true }).click();
  const auth = page.getByRole('dialog', { name: '验证身份', exact: true });
  await auth.getByLabel('当前密码', { exact: true }).fill(process.env.SEED_PASSWORD!);
  await auth.getByRole('button', { name: '验证并继续', exact: true }).click();
  await expect(detail).not.toBeVisible();
  await expect(row).toContainText('-已更新');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
});
test('G06: switching schools clears incompatible filters and ignores the previous request', async ({
  page,
}) => {
  await loginRoot(page);
  const listResponse = await page.request.get('/api/organization/schools?q=图衡自动化测试学校');
  const school = (await listResponse.json()).data.items.find(
    (s: { id: string }) => s.id === 'school-demo',
  );
  expect(typeof school.counts.teachers).toBe('number');
  expect(typeof school.counts.students).toBe('number');
  const { data: proofResult } = await (
    await page.request.post('/api/identity/reauthenticate', {
      headers: { Origin: 'http://localhost:3000' },
      data: { realm: 'STAFF', password: process.env.SEED_PASSWORD },
    })
  ).json();
  const created = await page.request.post('/api/organization/create-school', {
    headers: { Origin: 'http://localhost:3000' },
    data: {
      name: '[UI测试]范围-' + Date.now(),
      administratorName: '范围测试管理员',
      proof: proofResult.proof,
    },
  });
  expect(created.ok()).toBe(true);
  const other = (await created.json()).data.school;
  await page.goto('/admin/users');
  const scope = page.getByRole('combobox', { name: '当前操作学校', exact: true });
  await page.getByLabel('搜索学校', { exact: true }).fill('图衡自动化测试学校');
  await scope.selectOption('school-demo');
  const search = page.getByLabel('搜索姓名 / 登录 ID / 学号', { exact: true });
  await search.fill('不存在的人员');
  await page.getByLabel('搜索学校', { exact: true }).fill(other.name);
  await scope.selectOption(other.id);
  await expect(search).toHaveValue('');
  await expect(page.locator('.management-toolbar')).toContainText(other.name);
  await expect(page.locator('.organization-row')).toHaveCount(0);
  const students = await page.context().browser()!.newPage();
  try {
    await prepareLogin(students, 'teacher');
    await students.getByLabel('已绑定邮箱', { exact: true }).fill('teacher@tuheng.local');
    await students.getByLabel('密码', { exact: true }).fill(process.env.SEED_PASSWORD!);
    await students.getByRole('button', { name: '登录', exact: true }).click();
    await expect(students).toHaveURL('/teacher/dashboard');
    const forbidden = await students.request.post('/api/organization/create-teacher', {
      headers: { Origin: 'http://localhost:3000' },
      data: { schoolId: other.id, name: 'must-not-create' },
    });
    expect(forbidden.status()).toBe(403);
  } finally {
    await students.close();
  }
});
