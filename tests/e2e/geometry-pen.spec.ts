import { test, expect, type Page } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { GeometryDocument, type Vec2 } from '@tuheng/contracts';
import { createDocument } from '@tuheng/geometry-core';
import { penSample } from '../repair-fixtures';
import { choose, closePanels } from './editor-controls';

const evidence = 'test-results/pen-repair';
async function load(page: Page, doc = createDocument('OBLIQUE_DIMETRIC')) {
  await page.getByLabel('加载几何 JSON').setInputFiles({
    name: 'pen.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(doc)),
  });
  await expect(page.locator('[data-entity-id]')).toHaveCount(doc.entities.length);
}
async function exported(page: Page, name = '导出 JSON') {
  const download = page.waitForEvent('download');
  await choose(page, name);
  await closePanels(page);
  return readFileSync((await (await download).path())!, 'utf8');
}
async function json(page: Page) {
  return GeometryDocument.parse(JSON.parse(await exported(page)));
}
async function stroke(page: Page, points: Vec2[]) {
  const svg = page.locator('.geo-active svg');
  await svg.scrollIntoViewIfNeeded();
  // CSS pixels relative to a safe point inside the actual canvas, independent of DPR/zoom.
  const box = (await svg.boundingBox())!;
  const c = { x: box.x + box.width / 2 - 30, y: box.y + box.height / 2 - 45 };
  await page.mouse.move(c.x + points[0].x, c.y - points[0].y);
  await page.mouse.down();
  for (const p of points.slice(1)) await page.mouse.move(c.x + p.x, c.y - p.y);
  const preview = page.locator('[data-transient=preview]');
  // A horizontal SVG stroke has a zero-height geometric box but is still painted.
  await expect
    .poll(async () => (await preview.getAttribute('points'))?.split(' ').length ?? 0)
    .toBeGreaterThanOrEqual(2);
  expect((await preview.boundingBox())!.width).toBeGreaterThan(8);
  await page.mouse.up();
}
async function style(page: Page, name: string) {
  const mobile = await page.getByRole('button', { name: '绘图', exact: true }).isVisible();
  await choose(page, mobile ? '绘图' : '电子笔线型');
  await page.getByRole('button', { name: `${name}笔迹`, exact: true }).click();
}

test.use({ viewport: { width: 1366, height: 768 } });
test.beforeEach(async ({ page }) => {
  mkdirSync(evidence, { recursive: true });
  await page.goto('/login?callbackUrl=%2Fgeometry');
  await page.getByLabel('账号邮箱').fill('student@tuheng.local');
  await page.getByLabel('密码', { exact: true }).fill(process.env.SEED_PASSWORD!);
  await page.getByRole('button', { name: '进入图衡' }).click();
  await expect(page.locator('.geometry-editor')).toBeVisible();
});

test('new oblique axes point left/down and sparse real mouse stroke fits automatically', async ({
  page,
}) => {
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByLabel('图纸类型').selectOption('OBLIQUE_DIMETRIC');
  await expect(page.getByLabel('图纸类型')).toHaveValue('OBLIQUE_DIMETRIC');
  const doc = await json(page);
  expect(doc.projectionConfig).toMatchObject({ depthAngle: -135, depthScale: 0.5 });
  const y = page.locator('[data-reference-id="axis:y"] line').first();
  expect(Number(await y.getAttribute('x2'))).toBeLessThan(0);
  expect(Number(await y.getAttribute('y2'))).toBeLessThan(0);
  await choose(page, '电子笔');
  await stroke(page, [
    { x: 0, y: 0 },
    { x: 12, y: 0 },
  ]);
  const drawn = await json(page);
  expect(drawn.entities.at(-1)).toMatchObject({ kind: 'segment', lineStyle: 'ANSWER_VISIBLE' });
  const segment = drawn.entities.at(-1)!;
  if (segment.kind !== 'segment') throw Error('Expected fitted segment');
  expect(segment.samples?.length).toBeLessThan(6);
  writeFileSync(`${evidence}/oblique.json`, JSON.stringify(drawn, null, 2));
  await page.locator('.geometry-editor').screenshot({ path: `${evidence}/oblique.png` });
});

for (const width of [1366, 390])
  test(`pen styles and a 16px infinite auxiliary line at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 768 });
    await load(page);
    await style(page, '虚线');
    await stroke(page, [
      { x: 0, y: 0 },
      { x: 16, y: 0 },
    ]);
    expect((await json(page)).entities.at(-1)).toMatchObject({
      kind: 'segment',
      lineStyle: 'ANSWER_HIDDEN',
    });
    await choose(page, '撤销');
    await style(page, '辅助线');
    await stroke(page, [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 16, y: 0 },
    ]);
    const doc = await json(page);
    const line = doc.entities.at(-1)!;
    expect(line).toMatchObject({
      kind: 'line',
      lineStyle: 'CONSTRUCTION',
      layerId: 'construction',
    });
    if (line.kind !== 'line') throw Error('Expected an infinite line');
    expect(doc.entities).toHaveLength(1);
    expect(line.samples?.length).toBeGreaterThanOrEqual(2);
    const visual = page.locator('[data-kind=line] line');
    expect((await visual.boundingBox())!.width).toBeGreaterThan(width === 390 ? 200 : 700);
    expect(await exported(page, '导出展开图 SVG')).toContain('<line');
    await page
      .locator('.geometry-editor')
      .screenshot({ path: `${evidence}/auxiliary-${width}.png` });
    writeFileSync(`${evidence}/auxiliary-${width}.json`, JSON.stringify(doc, null, 2));
    await choose(page, '恢复原始笔迹');
    expect((await json(page)).entities.at(-1)).toMatchObject({
      kind: 'polyline',
      lineStyle: 'CONSTRUCTION',
      samples: line.samples,
    });
    await choose(page, '撤销');
    expect((await json(page)).entities).toHaveLength(0);
    await choose(page, '恢复');
    expect((await json(page)).entities.at(-1)?.kind).toBe('polyline');
    await load(page, doc);
    expect(await json(page)).toEqual(doc);
    expect((await visual.boundingBox())!.width).toBeGreaterThan(width === 390 ? 200 : 700);
  });

test('hidden circles and auxiliary arcs auto-fit at different zooms, with the ruler off', async ({
  page,
}) => {
  await load(page);
  await style(page, '虚线');
  await expect(page.locator('[data-transient=ruler]')).toHaveCount(0);
  await stroke(page, penSample(1, -1));
  expect((await json(page)).entities.at(-1)).toMatchObject({
    kind: 'circle',
    lineStyle: 'ANSWER_HIDDEN',
    radius: expect.any(Number),
    center: expect.any(String),
  });
  await choose(page, '撤销');
  await choose(page, '放大');
  await closePanels(page);
  await style(page, '辅助线');
  await stroke(page, penSample(1, 1, 160));
  expect((await json(page)).entities.at(-1)).toMatchObject({
    kind: 'arc',
    lineStyle: 'CONSTRUCTION',
    sweep: expect.closeTo(160, 0),
  });
  await choose(page, '恢复原始笔迹');
  expect((await json(page)).entities.at(-1)).toMatchObject({
    kind: 'polyline',
    lineStyle: 'CONSTRUCTION',
  });
});

test('unreliable ellipse stays raw and explicit fitting remains usable and reversible', async ({
  page,
}) => {
  await load(page);
  await style(page, '虚线');
  await stroke(page, penSample(1, 1, 360, 'ellipse'));
  const raw = await json(page);
  expect(raw.entities.at(-1)?.kind).toBe('polyline');
  const adopt = page.getByRole('button', { name: '尝试拟合为圆', exact: true });
  await expect(adopt).toBeEnabled();
  await adopt.click();
  expect((await json(page)).entities.at(-1)).toMatchObject({
    kind: 'circle',
    lineStyle: 'ANSWER_HIDDEN',
  });
  await choose(page, '恢复原始笔迹');
  expect(await json(page)).toEqual(raw);
});
