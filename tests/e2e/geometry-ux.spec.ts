import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { GeometryDocument, type Vec2 } from '@tuheng/contracts';
import { connectionSheet, standardSheet } from '../repair-fixtures';

test.use({ viewport: { width: 1366, height: 768 } });
async function load(page: Page, document = connectionSheet()) {
  await page.goto('/login?callbackUrl=%2Fgeometry');
  await page.getByLabel('账号邮箱').fill('student@tuheng.local');
  await page.getByLabel('密码', { exact: true }).fill(process.env.SEED_PASSWORD!);
  await page.getByRole('button', { name: '进入图衡' }).click();
  await expect(page.locator('.geometry-editor')).toBeVisible();
  await page.getByLabel('加载几何 JSON').setInputFiles({ name: 'ux.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)) });
}
async function screen(page: Page, p: Vec2) {
  const svg = page.locator('.geo-view svg').first();
  await svg.scrollIntoViewIfNeeded();
  return svg.evaluate((el, p) => { const q = new DOMPoint(p.x, -p.y).matrixTransform((el as SVGSVGElement).getScreenCTM()!); return { x: q.x, y: q.y }; }, p);
}
async function press(page: Page, p: Vec2) { const a = await screen(page, p); await page.mouse.move(a.x, a.y); await page.mouse.down(); }
async function move(page: Page, p: Vec2) { const b = await screen(page, p); await page.mouse.move(b.x, b.y, { steps: 6 }); }
async function json(page: Page) {
  const button = page.getByRole('button', { name: '导出 JSON', exact: true });
  if (!(await button.isVisible())) await page.getByRole('button', { name: '文件', exact: true }).click();
  const pending = page.waitForEvent('download'); await button.click();
  return GeometryDocument.parse(JSON.parse(readFileSync((await (await pending).path())!, 'utf8')));
}
test('UX01: live length HUD exists before pointerup', async ({ page }) => {
  await load(page); await press(page, { x: -30, y: 35 }); await move(page, { x: -20, y: 40 });
  await expect(page.locator('[data-measurement-hud]')).toContainText('mm', { timeout: 1500 });
  await page.mouse.up();
});
test('UX05: a standalone point snaps to the actual Z axis', async ({ page }) => {
  await load(page, standardSheet()); await press(page, { x: -30, y: 40 }); await move(page, { x: -0.5, y: 25 }); await page.mouse.up();
  expect((await json(page)).entities.find(e => e.id === 'A_V')).toMatchObject({ position: { x: 0, y: 25 } });
});
test('UX10: base axis can be selected as a read-only reference', async ({ page }) => {
  await load(page); await press(page, { x: 0, y: 25 }); await page.mouse.up();
  await expect(page.getByRole('dialog', { name: '对象属性', exact: true })).toContainText('Z', { timeout: 1500 });
});
test('UX12: blank drag in selection mode previews a real rectangle', async ({ page }) => {
  await load(page); await press(page, { x: -65, y: 50 }); await move(page, { x: -20, y: 25 });
  await expect(page.locator('[data-selection-mode="window"]')).toBeVisible({ timeout: 1500 }); await page.mouse.up();
});
test('UX15: clicking an entity opens its nearby editable inspector', async ({ page }) => {
  await load(page); await press(page, { x: -42.5, y: 35 }); await page.mouse.up();
  await expect(page.getByRole('dialog', { name: '对象属性', exact: true })).toBeVisible({ timeout: 1500 });
});
test('UX30: construction is reachable from a named primary group', async ({ page }) => {
  await load(page);
  await expect(page.getByRole('button', { name: '构造', exact: true })).toBeVisible({ timeout: 1500 });
  await page.getByRole('button', { name: '构造', exact: true }).click();
  await expect(page.getByRole('button', { name: '平行线', exact: true })).toBeVisible();
});
