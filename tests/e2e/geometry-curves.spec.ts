import { prepareLogin } from './identity-login';
import { test, expect, type Page } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { GeometryDocument, type Vec2 } from '@tuheng/contracts';
import { createDocument, addDrawing, point } from '@tuheng/geometry-core';
import { choose, closePanels } from './editor-controls';
import { handDrawnCurve } from '../hand-drawn-curve-fixtures';

function fixture() {
  let d = createDocument('VHW_PROJECTION');
  for (const p of [
    { x: 50, y: 40 },
    { x: 10, y: 10 },
  ])
    d = addDrawing(d, 'point', 'view-0', [p], 'teacher');
  for (const [a, b] of [
    [
      { x: 35, y: 5 },
      { x: 35, y: 50 },
    ],
    [
      { x: 5, y: 30 },
      { x: 50, y: 30 },
    ],
    [
      { x: 20, y: -10 },
      { x: 20, y: 40 },
    ],
  ])
    d = addDrawing(d, 'line', 'view-0', [a, b], 'student');
  return d;
}
async function screen(page: Page, p: Vec2) {
  const svg = page.locator('.geo-active svg');
  await svg.scrollIntoViewIfNeeded();
  return svg.evaluate((el, p) => {
    const m = (el as SVGSVGElement).getScreenCTM()!,
      q = new DOMPoint(p.x, -p.y).matrixTransform(m);
    return { x: q.x, y: q.y, scale: Math.hypot(m.a, m.b) };
  }, p);
}
async function click(page: Page, p: Vec2) {
  const q = await screen(page, p);
  await page.mouse.click(q.x, q.y);
}
async function json(page: Page) {
  const download = page.waitForEvent('download');
  await choose(page, '导出 JSON');
  await closePanels(page);
  return GeometryDocument.parse(JSON.parse(readFileSync((await (await download).path())!, 'utf8')));
}
async function load(page: Page, doc: GeometryDocument) {
  await page.getByLabel('加载几何 JSON').setInputFiles({
    name: 'curve.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(doc)),
  });
  await expect(page.locator('[data-entity-id]')).toHaveCount(doc.entities.length);
}
test.beforeEach(async ({ page }) => {
  await prepareLogin(page, 'student', '/geometry');
  await page.getByLabel('已绑定邮箱', { exact: true }).fill('student@tuheng.local');
  await page.getByLabel('密码', { exact: true }).fill(process.env.SEED_PASSWORD!);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.locator('.geometry-editor')).toBeVisible();
  mkdirSync('test-results/curves', { recursive: true });
});
for (const width of [1366, 390])
  test(`ordered curve endpoints, intersection snaps, confirmation and history at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const base = fixture();
    await load(page, base);
    await page
      .getByRole('button', { name: width === 390 ? '绘图' : '线工具', exact: true })
      .click();
    await page.getByRole('button', { name: '曲线', exact: true }).click();
    await click(page, { x: -50, y: 40 });
    await click(page, { x: -10, y: 10 });
    const q = await screen(page, { x: -35, y: 30 });
    await click(page, { x: -35 + 2 / q.scale, y: 30 + 2 / q.scale });
    await click(page, { x: -20 + 2 / q.scale, y: 2 / q.scale });
    await expect(page.locator('[data-kind=curve]')).toHaveCount(0);
    await expect(page.locator('[data-transient=curve-preview]')).toHaveAttribute('d', /C/);
    await expect(page.getByRole('button', { name: '确认曲线', exact: true })).toBeDisabled();
    await page.screenshot({ path: `test-results/curves/preview-${width}.png`, fullPage: true });
    await click(page, { x: -10, y: 10 });
    await page.getByRole('button', { name: '确认曲线', exact: true }).click();
    const doc = await json(page),
      c = doc.entities.at(-1)!;
    expect(c.kind).toBe('curve');
    if (c.kind !== 'curve') throw Error();
    expect(c.pointIds.map((id) => point(doc, id))).toEqual([
      { x: 50, y: 40 },
      { x: 35, y: 30 },
      { x: 20, y: 0 },
      { x: 10, y: 10 },
    ]);
    expect(c.pointIds[0]).toBe(base.entities[0].id);
    expect(c.pointIds.at(-1)).toBe(base.entities[1].id);
    expect(doc.entities.slice(0, base.entities.length)).toEqual(base.entities);
    await choose(page, '撤销');
    expect(await json(page)).toEqual(base);
    await choose(page, '恢复');
    expect(await json(page)).toEqual(doc);
    await load(page, doc);
    await expect(page.locator('[data-kind=curve] path')).toHaveAttribute('d', /C/);
    await expect(page.locator('[data-kind=curve] path')).toHaveAttribute(
      'vector-effect',
      'non-scaling-stroke',
    );
    expect(doc.referenceRelations?.filter((r) => r.targetId === c.pointIds[2])).toHaveLength(2);
    await page.screenshot({ path: `test-results/curves/curve-${width}.png`, fullPage: true });
    writeFileSync(`test-results/curves/curve-${width}.json`, JSON.stringify(doc, null, 2));
    await choose(page, '选择');
    const initialPath = await page.locator('[data-kind=curve] > path').getAttribute('d');
    const from = await screen(page, { x: -35, y: 30 }),
      to = await screen(page, { x: -41, y: 34 });
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await expect(page.locator('[data-kind=curve] > path')).not.toHaveAttribute('d', initialPath!);
    await page.mouse.up();
    const moved = await json(page);
    expect(point(moved, c.pointIds[1])).not.toEqual(point(doc, c.pointIds[1]));
    expect(moved.entities.slice(0, 2)).toEqual(base.entities.slice(0, 2));
    await choose(page, '撤销');
    expect(await json(page)).toEqual(doc);
  });

test('real mouse freehand S curve snaps an interior intersection and restores the original stroke', async ({
  page,
}) => {
  let base = createDocument('VHW_PROJECTION');
  base = addDrawing(
    base,
    'line',
    'view-0',
    [
      { x: 34, y: 5 },
      { x: 34, y: 45 },
    ],
    'student',
  );
  base = addDrawing(
    base,
    'line',
    'view-0',
    [
      { x: 10, y: 26 },
      { x: 50, y: 26 },
    ],
    'student',
  );
  await load(page, base);
  await choose(page, '电子笔');
  const samples = Array.from({ length: 121 }, (_, i) => ({
    x: -(10 + i * 0.4),
    y: 25 + 9 * Math.sin((i * Math.PI * 2) / 120),
  }));
  const start = await screen(page, samples[0]);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (const p of samples.slice(1)) {
    const q = await screen(page, p);
    await page.mouse.move(q.x, q.y);
  }
  await expect(page.locator('[data-transient=preview]')).toBeAttached();
  await page.mouse.up();
  const doc = await json(page),
    c = doc.entities.at(-1)!;
  expect(c.kind).toBe('curve');
  if (c.kind !== 'curve') throw Error();
  expect(c.pointIds.map((id) => point(doc, id))).toContainEqual({ x: 34, y: 26 });
  writeFileSync('test-results/curves/pen.json', JSON.stringify(doc, null, 2));
  await page.screenshot({ path: 'test-results/curves/pen.png', fullPage: true });
  await choose(page, '取消本次吸附');
  const unsnapped = await json(page);
  expect(unsnapped).not.toEqual(doc);
  await choose(page, '恢复原始笔迹');
  const raw = await json(page);
  expect(raw.entities.at(-1)?.kind).toBe('polyline');
  await choose(page, '撤销');
  expect(await json(page)).toEqual(base);
  await choose(page, '恢复');
  expect(await json(page)).toEqual(raw);
});

test.describe('touch curve creation', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test('tap endpoints and through points, cancel a draft, then confirm at the first endpoint', async ({
    page,
  }) => {
    const base = fixture();
    await load(page, base);
    await page.getByRole('button', { name: '绘图', exact: true }).tap();
    await page.getByRole('button', { name: '曲线', exact: true }).tap();
    const tap = async (p: Vec2) => {
      const q = await screen(page, p);
      await page.touchscreen.tap(q.x, q.y);
    };
    await tap({ x: -50, y: 40 });
    await tap({ x: -10, y: 10 });
    await page.getByRole('button', { name: '取消曲线', exact: true }).tap();
    expect(await json(page)).toEqual(base);
    await expect(page.locator('[data-transient=curve-preview]')).toHaveCount(0);
    await tap({ x: -50, y: 40 });
    await tap({ x: -10, y: 10 });
    await tap({ x: -35, y: 30 });
    await tap({ x: -50, y: 40 });
    await page.getByRole('button', { name: '确认曲线', exact: true }).tap();
    const doc = await json(page),
      c = doc.entities.at(-1)!;
    if (c.kind !== 'curve') throw Error();
    expect(c.pointIds.map((id) => point(doc, id))).toEqual([
      { x: 10, y: 10 },
      { x: 35, y: 30 },
      { x: 50, y: 40 },
    ]);
    expect(doc.entities.slice(0, base.entities.length)).toEqual(base.entities);
  });
});

for (const width of [1366, 390])
  test(`hand-drawn U and waves auto-fit at ${width}px, with real mouse input and raw recovery`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    for (const [index, shape] of (['bowl', 'peaked', 'wave'] as const).entries()) {
      const base = createDocument('VHW_PROJECTION');
      await load(page, base);
      await choose(page, '电子笔');
      const svg = page.locator('.geo-active svg');
      await svg.scrollIntoViewIfNeeded();
      const rect = (await svg.boundingBox())!;
      await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
      if (index) await page.mouse.wheel(0, index === 1 ? -320 : 320);
      await page.waitForTimeout(100);
      const samples = handDrawnCurve(shape).map((p) => ({
        x: p.x * (width === 390 ? 0.6 : 1),
        y: p.y * (width === 390 ? 0.6 : 1),
      }));
      const at = (p: Vec2) => ({
        x: rect.x + rect.width / 2 + p.x,
        y: rect.y + rect.height * 0.3 - p.y,
      });
      const start = at(samples[0]);
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      for (const p of samples.slice(1)) {
        const q = at(p);
        await page.mouse.move(q.x, q.y);
      }
      await expect(page.locator('[data-transient=preview]')).toBeAttached();
      await page.mouse.up();
      await expect(page.getByText(/已自动拟合为曲线/)).toBeVisible();
      const doc = await json(page),
        curve = doc.entities.at(-1)!;
      expect(curve.kind).toBe('curve');
      if (curve.kind !== 'curve') throw Error('expected curve on pointerup');
      expect(curve.samples!.length).toBeGreaterThan(70);
      expect(curve.pointIds.length).toBeLessThan(curve.samples!.length);
      expect(doc.entities.filter((e) => e.kind === 'polyline')).toHaveLength(0);
      writeFileSync(
        `test-results/curves/hand-${shape}-${width}.json`,
        JSON.stringify(doc, null, 2),
      );
      await page.screenshot({
        path: `test-results/curves/hand-${shape}-${width}.png`,
        fullPage: true,
      });
      await choose(page, '恢复原始笔迹');
      const raw = await json(page);
      expect(raw.entities.at(-1)).toMatchObject({ kind: 'polyline', samples: curve.samples });
      await choose(page, '撤销');
      expect(await json(page)).toEqual(base);
      await choose(page, '恢复');
      expect(await json(page)).toEqual(raw);
    }
  });
