import type { Page } from '@playwright/test';
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
