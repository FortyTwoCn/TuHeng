import { expect, type Locator, type Page } from '@playwright/test';
import { resetIdentityFixtureThrottle } from '../identity-fixture';
export async function prepareLogin(page: Page, who = 'student', callback?: string) {
  if (
    process.env.SEED_TEST_ACCOUNTS !== '1' ||
    !new URL(process.env.DATABASE_URL!).pathname.endsWith('_test') ||
    !['student', 'student2', 'teacher', 'admin'].includes(who)
  )
    throw new Error('E2E_LOGIN_REQUIRES_ISOLATED_TEST_DATABASE');
  const realm = who.startsWith('student') ? 'STUDENT' : 'STAFF';
  await resetIdentityFixtureThrottle(who);
  await page.goto(
    `/login/${realm.toLowerCase()}${callback ? '?callbackUrl=' + encodeURIComponent(callback) : ''}`,
  );
  await page.getByRole('button', { name: '邮箱密码', exact: true }).click();
}
export async function verifyIdentity(scope: Page | Locator, password: string) {
  await scope.getByRole('button', { name: '验证身份', exact: true }).first().click();
  const dialog = scope.getByRole('dialog', { name: '验证身份', exact: true });
  await dialog.getByLabel('当前密码', { exact: true }).fill(password);
  await dialog.getByRole('button', { name: '验证并继续', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(scope.getByText(/敏感操作已验证至/).first()).toBeVisible();
}
