import { prepareLogin } from './identity-login';
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { GeometryDocument } from '@tuheng/contracts';
import { choose, closePanels } from './editor-controls';

for (const viewport of [
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
]) {
  test.describe(`network login ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport, hasTouch: true });
    test('login, pen curve, session reload and logout keep the current application origin', async ({
      page,
      baseURL,
    }, testInfo) => {
      const origin = new URL(baseURL!).origin;
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await prepareLogin(page, 'student', '/geometry');
      await expect(page.locator('form')).toHaveAttribute('method', 'post');
      await page.getByLabel('已绑定邮箱', { exact: true }).fill('student@tuheng.local');
      await page.getByLabel('密码', { exact: true }).fill(process.env.SEED_PASSWORD!);
      await page.getByRole('button', { name: '登录', exact: true }).tap();
      await expect(page).toHaveURL(origin + '/geometry');
      await expect(page.locator('.geometry-editor')).toBeVisible();
      const capabilities = await page.evaluate(() => ({
        secure: window.isSecureContext,
        randomUUID: typeof crypto.randomUUID,
      }));
      // TEST_APP_ORIGIN can point to an actual non-loopback HTTP address. No API mocking.
      if (
        new URL(origin).protocol === 'http:' &&
        !['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)
      ) {
        expect(capabilities).toEqual({ secure: false, randomUUID: 'undefined' });
      }
      await testInfo.attach('browser-capabilities', {
        body: JSON.stringify(capabilities),
        contentType: 'application/json',
      });
      await choose(page, '电子笔');
      const svg = page.locator('.geo-active svg');
      await svg.scrollIntoViewIfNeeded();
      const points = await svg.evaluate((el) =>
        Array.from({ length: 121 }, (_, i) => {
          const q = new DOMPoint(
            -(10 + i * 0.4),
            -(25 + 9 * Math.sin((i * Math.PI * 2) / 120)),
          ).matrixTransform((el as SVGSVGElement).getScreenCTM()!);
          return { x: q.x, y: q.y };
        }),
      );
      await page.mouse.move(points[0].x, points[0].y);
      await page.mouse.down();
      for (const point of points.slice(1)) await page.mouse.move(point.x, point.y);
      await page.mouse.up();
      await expect(page.locator('[data-kind=curve]')).toHaveCount(1);
      const downloading = page.waitForEvent('download');
      await choose(page, '导出 JSON');
      await closePanels(page);
      const doc = GeometryDocument.parse(
        JSON.parse(readFileSync((await (await downloading).path())!, 'utf8')),
      );
      expect(doc.entities.at(-1)?.kind).toBe('curve');
      await testInfo.attach('curve.json', {
        body: JSON.stringify(doc, null, 2),
        contentType: 'application/json',
      });
      await page.screenshot({ path: testInfo.outputPath('lan-curve.png'), fullPage: true });
      await page.goto('/student/dashboard');
      await page.reload();
      await expect(page).toHaveURL(origin + '/student/dashboard');
      const denied = await page.request.post(origin + '/api/actions/folder', {
        headers: { Origin: 'https://evil.invalid' },
        data: { title: 'must not be created' },
      });
      expect(denied.status()).toBe(403);
      expect((await denied.json()).error).toBe('INVALID_ORIGIN');
      await page.getByRole('button', { name: '退出登录', exact: true }).tap();
      await expect(page).toHaveURL(origin + '/login');
      await page.goto('/geometry');
      await expect(page).toHaveURL(origin + '/login?callbackUrl=%2Fgeometry');
      expect(errors).toEqual([]);
    });
  });
}
