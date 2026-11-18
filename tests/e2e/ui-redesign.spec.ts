import { test, expect } from '@playwright/test';

test('G01/G02: one login page switches realms and clears entered secrets', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: '学生登录', exact: true }).click();
  await page.getByRole('button', { name: '邮箱密码', exact: true }).click();
  await page.getByLabel('已绑定邮箱', { exact: true }).fill('switch-test@test.invalid');
  await page.getByLabel('密码', { exact: true }).fill('Only-a-browser-input');
  await page.getByRole('button', { name: '教师与管理', exact: true }).click();
  await expect(page).toHaveURL(/\/login\?realm=staff$/);
  await expect(page.getByLabel('登录 ID / 已绑定邮箱')).toBeVisible();
  await expect(page.getByLabel('密码', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: '学生登录', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '学校', exact: true })).toBeVisible();
  await expect(page.getByLabel('密码', { exact: true })).toHaveValue('');
});

test('G01: staff ID and email share one password entry while codes and recovery stay separate', async ({
  page,
}) => {
  await page.goto('/login?realm=staff');
  const methods = page.locator('.login-method-tabs');
  await expect(methods.getByRole('button')).toHaveCount(2);
  await expect(methods.getByRole('button', { name: '账号密码', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const identifier = page.getByLabel('登录 ID / 已绑定邮箱', { exact: true });
  await expect(identifier).toHaveAttribute('type', 'text');
  await identifier.fill('admin');
  await expect(identifier).toHaveValue('admin');
  await identifier.fill('teacher@example.invalid');
  await page.getByLabel('密码', { exact: true }).fill('local-input-only');
  await methods.getByRole('button', { name: '邮箱验证码', exact: true }).click();
  await expect(page.getByLabel('已绑定邮箱', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('六位验证码', { exact: true })).toBeVisible();
  await methods.getByRole('button', { name: '账号密码', exact: true }).click();
  await expect(identifier).toHaveValue('');
  await expect(page.getByLabel('密码', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: '忘记密码', exact: true }).click();
  await expect(page.getByRole('heading', { name: '通过已绑定邮箱找回密码' })).toBeVisible();
  await page.getByRole('button', { name: '返回登录', exact: true }).click();
  await expect(methods.getByRole('button', { name: '账号密码', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('G01: legacy entry keeps a safe return path on the unified login route', async ({ page }) => {
  await page.goto('/login/staff?callbackUrl=%2Fgeometry');
  await expect(page).toHaveURL(/\/login\?realm=staff&callbackUrl=%2Fgeometry$/);
  await expect(page.getByRole('button', { name: '教师与管理', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.goto('/login/student?callbackUrl=https%3A%2F%2Fevil.invalid');
  await expect(page).toHaveURL(/\/login\?realm=student$/);
});
test('G02: changing methods clears secrets; failed code requests do not start a countdown', async ({
  page,
}) => {
  const requests: unknown[] = [];
  await page.route('**/api/identity/request-code', async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ status: 503, json: { error: 'SMTP_SEND_FAILED' } });
  });
  await page.goto('/login?realm=staff');
  await page.getByLabel('密码', { exact: true }).fill('Temporary-input');
  await page.getByRole('button', { name: '邮箱验证码', exact: true }).click();
  await page.getByLabel('已绑定邮箱', { exact: true }).fill('test@tuheng.invalid');
  await page.getByRole('button', { name: '获取验证码', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('验证码发送失败');
  await expect(page.getByRole('button', { name: '获取验证码', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeDisabled();
  expect(requests).toEqual([{ realm: 'STAFF', purpose: 'LOGIN', email: 'test@tuheng.invalid' }]);
  await page.getByRole('button', { name: '账号密码', exact: true }).click();
  await expect(page.getByLabel('密码', { exact: true })).toHaveValue('');
});

test('G05: the school combobox searches, supports keyboard selection and reports errors', async ({
  page,
}) => {
  let failing = true;
  await page.route('**/api/schools?*', async (route) => {
    const query = new URL(route.request().url()).searchParams.get('q');
    await route.fulfill(
      failing
        ? { status: 503, json: {} }
        : {
            json: {
              schools:
                query === '不存在' ? [] : [{ id: 'test-school', name: '测试学校', code: 'S001' }],
              hasMore: false,
            },
          },
    );
  });
  await page.goto('/login');
  const school = page.getByRole('combobox', { name: '学校', exact: true });
  await school.fill('测试');
  await expect(page.getByRole('main').getByRole('alert')).toContainText('学校列表暂时不可用');
  failing = false;
  await page.getByRole('button', { name: '重试搜索' }).click();
  await expect(page.getByRole('option')).toContainText('测试学校');
  await school.focus();
  await school.press('ArrowDown');
  await school.press('Enter');
  await expect(school).toHaveValue('测试学校');
  await expect(page.getByRole('listbox')).not.toBeVisible();
  await school.fill('不存在');
  await expect(page.getByText('未找到可用学校，请检查名称或联系学校管理员。')).toBeVisible();
});

test('C02: login layout remains usable at the six required viewport sizes', async ({ page }) => {
  for (const [width, height] of [
    [360, 800],
    [390, 844],
    [768, 1024],
    [1024, 768],
    [1366, 768],
    [1440, 900],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto('/login?realm=staff');
    await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    if (width === 390 || width === 1366)
      await page.screenshot({
        path: `.runtime/ui-redesign/evidence/login-${width}.png`,
        fullPage: true,
      });
  }
});
