import { test, expect } from '@playwright/test';
import { prepareLogin } from './identity-login';
import { prisma } from '@tuheng/database';
import { randomUUID } from 'node:crypto';

test.beforeEach(async ({ page }) => {
  const id = await prepareLogin(page, 'admin');
  await id.fill('admin');
  await page.getByLabel('密码', { exact: true }).fill(process.env.SEED_PASSWORD!);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL('/admin/dashboard');
});

test('organization search controls align and a course row opens its actual terms', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/admin/organization?schoolId=school-demo');
  const input = page.getByRole('searchbox', { name: '搜索课程、编号或学期', exact: true });
  const query = page.getByRole('button', { name: '查询', exact: true });
  const a = await input.boundingBox(),
    b = await query.boundingBox();
  expect(a).not.toBeNull();
  expect(b).not.toBeNull();
  expect(Math.abs(a!.height - b!.height)).toBeLessThan(2);
  expect(Math.abs(a!.y - b!.y)).toBeLessThan(2);
  expect(b!.height).toBeGreaterThanOrEqual(44);
  await input.fill('DEMO-GE101');
  await query.click();
  const course = page.getByRole('link', { name: /画法几何及机械制图.*DEMO-GE101/ });
  await expect(course).toBeVisible();
  expect((await course.boundingBox())!.height).toBeGreaterThanOrEqual(64);
  await course.click();
  await expect(page).toHaveURL(/\/admin\/organization\/course-demo\?schoolId=school-demo/);
  await expect(page.getByRole('button', { name: '新增开课学期', exact: true })).toBeVisible();
  await page
    .getByRole('link', { name: /2026 秋季/ })
    .last()
    .click();
  await expect(page.getByRole('heading', { name: /2026 秋季/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /机械工程 2601/ })).toBeVisible();
});

test('search, reset, personnel tabs and mobile drawers preserve their scope', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin/organization?schoolId=school-demo');
  await page
    .getByRole('searchbox', { name: '搜索课程、编号或学期', exact: true })
    .fill('no-such-course-7921');
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(page.getByText('暂无匹配课程。', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: '清除筛选', exact: true }).click();
  await expect(page).toHaveURL(
    (url) => url.searchParams.get('schoolId') === 'school-demo' && !url.searchParams.has('q'),
  );
  await page.getByRole('button', { name: '新增课程', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新增课程', exact: true });
  await expect(dialog.getByLabel('课程名称', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.goto('/admin/users?schoolId=school-demo');
  await page
    .getByRole('navigation', { name: '人员类型' })
    .getByRole('link', { name: '学生', exact: true })
    .click();
  await expect(page.getByRole('searchbox', { name: '搜索学生', exact: true })).toBeVisible();
  await page.reload();
  expect(new URL(page.url()).searchParams.get('schoolId')).toBe('school-demo');
  expect(new URL(page.url()).searchParams.get('kind')).toBe('STUDENT');
});

test.describe('touch controls', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test('school chooser exposes clear entries, disabled status and correct destination', async ({
    page,
  }) => {
    const school = await prisma.school.findUniqueOrThrow({ where: { id: 'school-demo' } });
    const disabled = await prisma.school.create({
      data: { name: '选择学校验证 · 停用', code: 'PICK-' + randomUUID(), active: false },
    });
    try {
      for (const [width, height] of [
        [1440, 900],
        [768, 1024],
        [390, 844],
        [360, 800],
      ]) {
        await page.setViewportSize({ width, height });
        await page.goto('/admin/users?choose=1&q=' + encodeURIComponent(school.code));
        const entry = page.getByRole('link', { name: new RegExp(school.code + '.*进入用户管理') });
        await expect(entry).toContainText('教师账号');
        await expect(entry).toContainText('学生账号');
        expect((await entry.boundingBox())!.height).toBeGreaterThanOrEqual(140);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        ).toBe(true);
        await entry.tap();
        await expect(page).toHaveURL('/admin/users?schoolId=' + school.id);
        await expect(page.getByRole('navigation', { name: '当前管理范围' })).toContainText(
          school.name,
        );
      }
      await page.goto('/admin/classes?choose=1&q=' + encodeURIComponent(school.code));
      await page.getByRole('link', { name: /进入教学班及成员/ }).tap();
      await expect(page).toHaveURL('/admin/classes?schoolId=' + school.id);
      await page.goto('/admin/users?choose=1&q=' + encodeURIComponent(disabled.code));
      const card = page.getByRole('article', { name: disabled.name });
      await expect(card).toContainText('已停用');
      await expect(card.getByRole('link')).toHaveCount(0);
      await expect(page.getByRole('link', { name: /进入用户管理/ })).toHaveCount(0);
      await page
        .getByRole('searchbox', { name: '学校名称或编号', exact: true })
        .fill('no-school-' + randomUUID());
      await page.getByRole('button', { name: '查询', exact: true }).tap();
      await expect(page.getByText('没有找到匹配的学校。', { exact: true })).toBeVisible();
      await page.getByRole('link', { name: '清除筛选', exact: true }).tap();
      await expect(page).toHaveURL('/admin/users?choose=1');
      await expect(page.getByRole('link', { name: /进入用户管理/ }).first()).toBeVisible();
    } finally {
      await prisma.school.delete({ where: { id: disabled.id } });
    }
  });
  test('phone and tablet taps open real rows and safely cancel an edited form', async ({
    page,
  }) => {
    for (const [width, height] of [
      [390, 844],
      [768, 1024],
    ]) {
      await page.setViewportSize({ width, height });
      await page.goto('/admin/organization?schoolId=school-demo');
      await page.getByRole('link', { name: /画法几何及机械制图.*DEMO-GE101/ }).tap();
      const create = page.getByRole('button', { name: '新增开课学期', exact: true });
      expect((await create.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await create.tap();
      const dialog = page.getByRole('dialog', { name: '新增开课学期', exact: true });
      await dialog.getByLabel('学期', { exact: true }).fill('不应保存的学期');
      const cancel = dialog.getByRole('button', { name: '取消', exact: true });
      expect((await cancel.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await cancel.tap();
      await expect(dialog).not.toBeVisible();
      await page.reload();
      await expect(page.getByRole('link', { name: /不应保存的学期/ })).toHaveCount(0);
      await page.getByRole('link', { name: /2026 秋季.*查看教学班/ }).tap();
      await page.getByRole('link', { name: /机械工程 2601.*查看班级/ }).tap();
      await expect(page.getByRole('heading', { name: '班级成员', exact: true })).toBeVisible();
    }
  });
});

test('teaching pages fit desktop, tablet and phone; import scope and template stay usable', async ({
  page,
}) => {
  for (const [width, height] of [
    [360, 800],
    [390, 844],
    [768, 1024],
    [1024, 768],
    [1366, 768],
    [1440, 900],
  ]) {
    await page.setViewportSize({ width, height });
    for (const path of [
      'organization',
      'organization/course-demo',
      'classes',
      'classes/class-demo',
      'users',
      'imports',
      'delivery',
    ]) {
      await page.goto('/admin/' + path + '?schoolId=school-demo');
      await expect(page.locator('h1')).toBeVisible();
      await expect(page.getByRole('heading', { name: '暂时无法加载' })).toHaveCount(0);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin/imports?schoolId=school-demo');
  const upload = page.getByLabel('上传 XLSX（最多 5 MB、5000 行）', { exact: true });
  await expect(upload).toBeDisabled();
  await page
    .getByRole('combobox', { name: '课程 / 学期', exact: true })
    .selectOption('offering-demo');
  await expect(upload).toBeEnabled();
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: '下载 Excel 模板', exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.xlsx$/);
});
