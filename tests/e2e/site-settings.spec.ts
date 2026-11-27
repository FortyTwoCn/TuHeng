import { test, expect, type Page } from '@playwright/test';
import { prepareLogin } from './identity-login';

async function login(page: Page, who = 'admin') {
  const identifier = await prepareLogin(page, who);
  await identifier.fill(`${who}@tuheng.local`);
  await page.getByLabel('密码', { exact: true }).fill(process.env.SEED_PASSWORD!);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(`/${who}/dashboard`);
}
const footer = (page: Page) => page.getByRole('contentinfo', { name: '网站信息' });
async function restore(page: Page, filingNumber: string) {
  const { data } = await (await page.request.get('/api/settings/site')).json();
  const response = await page.request.post('/api/settings/site', {
    headers: { origin: process.env.TEST_APP_ORIGIN ?? 'http://localhost:3000' },
    data: { filingNumber, expectedVersion: data.version },
  });
  expect(response.status()).toBe(200);
}

test('site settings persist across login and workspaces while geometry uses its standalone layout', async ({
  page,
  browser,
}) => {
  test.setTimeout(180000);
  await login(page);
  await expect(page.getByText('有据可循的学习反馈')).toHaveCount(0);
  const original = (await (await page.request.get('/api/settings/site')).json()).data;
  const visitor = await browser.newPage();
  const filingNumber = '测试备案号 20261118-1';
  try {
    await page.goto('/admin/settings');
    await expect(page).toHaveURL('/admin/settings/site');
    await page.getByLabel('备案号', { exact: true }).fill(filingNumber);
    await page.getByRole('button', { name: '保存网站信息', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('网站信息已保存');
    await expect(footer(page)).toContainText(filingNumber);
    await page.reload();
    await expect(page.getByLabel('备案号', { exact: true })).toHaveValue(filingNumber);
    for (const [width, height] of [
      [1366, 768],
      [768, 1024],
      [390, 844],
      [360, 800],
    ]) {
      await page.setViewportSize({ width, height });
      await footer(page).scrollIntoViewIfNeeded();
      await expect(footer(page)).toHaveCount(1);
      await expect(footer(page)).toContainText(filingNumber);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      if (width <= 760) {
        const text = await footer(page).locator('.site-filing-number').boundingBox();
        const nav = await page
          .getByRole('navigation', { name: '移动端主导航', exact: true })
          .boundingBox();
        expect(text!.y + text!.height).toBeLessThanOrEqual(nav!.y);
      }
      await page.screenshot({
        path: `.runtime/site-footer/evidence/settings-${width}.png`,
        fullPage: true,
      });
    }
    for (const url of ['/admin/users', '/admin/settings/mail']) {
      await page.goto(url);
      await expect(footer(page)).toContainText(filingNumber);
      await expect(footer(page)).toHaveCount(1);
    }
    await page.goto('/geometry?realm=STAFF');
    await expect(page.getByRole('main', { name: '独立几何作图' })).toBeVisible();
    await expect(footer(page)).toHaveCount(0);
    for (const [width, height] of [
      [1366, 768],
      [390, 844],
    ]) {
      await visitor.setViewportSize({ width, height });
      await visitor.goto('/login');
      await expect(footer(visitor)).toContainText(filingNumber);
      expect(
        await visitor.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      await visitor.screenshot({
        path: `.runtime/site-footer/evidence/login-${width}.png`,
        fullPage: true,
      });
    }
    for (const who of ['teacher', 'student']) {
      await login(visitor, who);
      await expect(footer(visitor)).toContainText(filingNumber);
    }
    await page.goto('/admin/settings/site');
    await page.getByLabel('备案号', { exact: true }).fill('');
    await page.getByRole('button', { name: '保存网站信息', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('网站信息已保存');
    await expect(footer(page).locator('.site-filing-number')).toHaveCount(0);
    await visitor.goto('/login');
    await expect(footer(visitor).locator('.site-filing-number')).toHaveCount(0);
  } finally {
    await restore(page, original.filingNumber);
    await visitor.close();
  }
});

test('only the site admin can change public filing information; origin and input validation remain enforced', async ({
  page,
  browser,
}) => {
  const anonymous = await page.request.get('/api/settings/site');
  expect(anonymous.status()).toBe(200);
  const { data } = await anonymous.json();
  expect(Object.keys(data).sort()).toEqual(['filingNumber', 'version']);
  const body = { filingNumber: '无权更改', expectedVersion: data.version };
  const headers = { origin: process.env.TEST_APP_ORIGIN ?? 'http://localhost:3000' };
  expect((await page.request.post('/api/settings/site', { headers, data: body })).status()).toBe(
    401,
  );
  await login(page, 'teacher');
  expect((await page.request.post('/api/settings/site', { headers, data: body })).status()).toBe(
    403,
  );
  const student = await browser.newPage();
  try {
    await login(student, 'student');
    expect(
      (await student.request.post('/api/settings/site', { headers, data: body })).status(),
    ).toBe(401);
  } finally {
    await student.close();
  }
  await login(page);
  expect(
    (
      await page.request.post('/api/settings/site', {
        headers: { origin: 'https://untrusted.invalid' },
        data: body,
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.post('/api/settings/site', {
        headers,
        data: { ...body, filingNumber: 'x'.repeat(121) },
      })
    ).status(),
  ).toBe(400);
  expect((await (await page.request.get('/api/settings/site')).json()).data).toEqual(data);
});

test('stale settings preserve the input draft and explicit reload; filing text is never HTML', async ({
  page,
}) => {
  await login(page);
  const original = (await (await page.request.get('/api/settings/site')).json()).data;
  try {
    await page.goto('/admin/settings/site');
    const input = page.getByLabel('备案号', { exact: true });
    await expect(input).toBeEnabled();
    await input.fill('尚未保存的备案号');
    await page.getByRole('link', { name: '邮件服务', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '未保存的配置' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: '继续编辑', exact: true }).click();
    const literal = '<img src=x onerror=alert(1)> 测试备案号';
    await restore(page, literal);
    await page.getByRole('button', { name: '保存网站信息', exact: true }).click();
    await expect(
      page.getByRole('region', { name: '网站信息', exact: true }).getByRole('alert'),
    ).toContainText('此配置已被其他操作更新');
    await expect(input).toHaveValue('尚未保存的备案号');
    await page.getByRole('button', { name: '重新读取', exact: true }).click();
    await dialog.getByRole('button', { name: '丢弃修改并切换', exact: true }).click();
    await expect(input).toHaveValue(literal);
    await page.reload();
    await expect(footer(page)).toContainText(literal);
    await expect(footer(page).locator('img, script')).toHaveCount(0);
  } finally {
    await restore(page, original.filingNumber);
  }
});
