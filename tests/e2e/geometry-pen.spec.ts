import { prepareLogin } from './identity-login';
import { test, expect, type Page } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { GeometryDocument, type Vec2 } from '@tuheng/contracts';
import { createDocument, lineGeometry, unit } from '@tuheng/geometry-core';
import {
  penSample,
  wavyLineSample,
  borderlineCircleSample,
  driftingLineSample,
} from '../repair-fixtures';
import { choose, closePanels, settings } from './editor-controls';

const evidence = 'test-results/pen-repair';
async function load(page: Page, doc = createDocument('OBLIQUE_DIMETRIC')) {
  await page.getByLabel('加载几何 JSON').setInputFiles({
    name: 'pen.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(doc)),
  });
  await expect(page.getByLabel('加载几何 JSON')).toHaveValue('');
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
  const previewBox = (await preview.boundingBox())!;
  expect(Math.hypot(previewBox.width, previewBox.height)).toBeGreaterThan(8);
  await page.mouse.up();
}
async function style(page: Page, name: string) {
  await choose(page, '电子笔线型');
  await page.getByRole('button', { name: `${name}笔迹`, exact: true }).click();
}

test.use({ viewport: { width: 1366, height: 768 } });
test.beforeEach(async ({ page }) => {
  mkdirSync(evidence, { recursive: true });
  await prepareLogin(page, 'student', '/geometry');
  await page.getByLabel('已绑定邮箱', { exact: true }).fill('student@tuheng.local');
  await page.getByLabel('密码', { exact: true }).fill(process.env.SEED_PASSWORD!);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.locator('.geometry-editor')).toBeVisible();
});

test('new oblique axes point left/down and sparse real mouse stroke fits automatically', async ({
  page,
}) => {
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByLabel('图纸类型').selectOption('OBLIQUE_DIMETRIC');
  await expect(page.getByLabel('斜二等轴图编辑器', { exact: true })).toBeVisible();
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

function tiltedStroke(degrees: number, length = 160) {
  const angle = (degrees * Math.PI) / 180;
  return Array.from({ length: 81 }, (_, i) => ({
    x: ((i * length) / 80) * Math.cos(angle) - Math.sin(i * 0.8) * 0.2 * Math.sin(angle),
    y: ((i * length) / 80) * Math.sin(angle) + Math.sin(i * 0.8) * 0.2 * Math.cos(angle),
  }));
}
for (const width of [1024, 390])
  test(`near-horizontal and near-vertical pen auxiliary lines correct direction and preserve recovery at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 768 });
    for (const degrees of [4, 86]) {
      const base = createDocument('VHW_PROJECTION');
      await load(page, base);
      await style(page, '辅助线');
      await stroke(page, tiltedStroke(degrees));
      const doc = await json(page);
      const line = doc.entities.at(-1)!;
      expect(line.kind).toBe('line');
      if (line.kind !== 'line') throw Error('Expected fitted auxiliary line');
      expect(Math.abs(degrees === 4 ? line.direction.y : line.direction.x)).toBeLessThan(1e-10);
      await expect(page.locator('.cad-step-message')).toContainText(
        degrees === 4 ? '水平' : '垂直',
      );
      const visual = (await page.locator('[data-kind=line] line').boundingBox())!;
      expect(degrees === 4 ? visual.width : visual.height).toBeGreaterThan(250);
      await page
        .locator('.geometry-editor')
        .screenshot({ path: `${evidence}/direction-${width}-${degrees}.png` });
      writeFileSync(`${evidence}/direction-${width}-${degrees}.json`, JSON.stringify(doc, null, 2));
      await choose(page, '撤销');
      expect(await json(page)).toEqual(base);
      await choose(page, '恢复');
      expect(await json(page)).toEqual(doc);
      // Camera operations do not consume the recovery for this drawing transaction.
      await choose(page, '放大');
      await closePanels(page);
      await choose(page, '取消本次吸附');
      const unsnapped = await json(page),
        original = unsnapped.entities.at(-1)!;
      if (original.kind !== 'line') throw Error();
      expect(Math.abs(degrees === 4 ? original.direction.y : original.direction.x)).toBeGreaterThan(
        0.04,
      );
      expect(original.samples).toEqual(line.samples);
      await choose(page, '撤销');
      expect(await json(page)).toEqual(base);
      await choose(page, '恢复');
      expect(await json(page)).toEqual(unsnapped);
      await choose(page, '恢复原始笔迹');
      expect((await json(page)).entities.at(-1)).toMatchObject({
        kind: 'polyline',
        samples: line.samples,
      });
    }
  });

test('pen direction snapping respects finite styles, scale, switches, pause and deliberate diagonals', async ({
  page,
}) => {
  for (const name of ['实线', '虚线']) {
    for (const degrees of [4, 86]) {
      await load(page, createDocument('VHW_PROJECTION'));
      await style(page, name);
      if (degrees === 86) {
        await choose(page, '放大');
        await closePanels(page);
      }
      await stroke(page, tiltedStroke(degrees));
      const doc = await json(page),
        line = doc.entities.at(-1)!;
      expect(line.kind).toBe('segment');
      expect(line.lineStyle).toBe(name === '实线' ? 'ANSWER_VISIBLE' : 'ANSWER_HIDDEN');
      const d = unit(lineGeometry(doc, line).d);
      expect(Math.abs(degrees === 4 ? d.y : d.x)).toBeLessThan(1e-10);
    }
  }
  for (const mode of ['disabled', 'axes', 'paused', 'diagonal']) {
    await load(page, createDocument('VHW_PROJECTION'));
    await style(page, '辅助线');
    if (mode === 'disabled') {
      await settings(page);
      await page.getByLabel('启用作图吸附', { exact: true }).uncheck();
      await closePanels(page);
    }
    if (mode === 'axes' || mode === 'paused') {
      await settings(page);
      if (mode === 'axes') await page.getByLabel('参考轴吸附', { exact: true }).uncheck();
      else await page.getByRole('button', { name: '下一次不吸附', exact: true }).click();
      await closePanels(page);
    }
    await stroke(page, tiltedStroke(mode === 'diagonal' ? 20 : 4));
    const doc = await json(page),
      line = doc.entities.at(-1)!;
    if (line.kind !== 'line') throw Error();
    expect(Math.abs(line.direction.y)).toBeGreaterThan(0.04);
    await expect(page.locator('.cad-step-message')).not.toContainText('校正为水平');
    if (mode === 'paused') {
      // The next pen gesture in the same session consumes the restored global setting.
      await stroke(page, tiltedStroke(4).map((p) => ({ x: p.x, y: p.y + 25 })));
      const corrected = await json(page);
      expect(corrected.entities).toHaveLength(doc.entities.length + 1);
      const next = corrected.entities.at(-1)!;
      if (next.kind !== 'line') throw Error('Expected the second fitted auxiliary line');
      expect(Math.abs(next.direction.y)).toBeLessThan(1e-10);
    }
    if (mode === 'disabled') {
      await settings(page);
      await page.getByLabel('启用作图吸附', { exact: true }).check();
      await closePanels(page);
    }
    if (mode === 'axes') {
      await settings(page);
      await page.getByLabel('参考轴吸附', { exact: true }).check();
      await closePanels(page);
    }
  }
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

test('unreliable ellipse stays raw without a confirmation flow and remains undoable', async ({
  page,
}) => {
  await load(page);
  await style(page, '虚线');
  await stroke(page, penSample(1, 1, 360, 'ellipse'));
  const raw = await json(page);
  expect(raw.entities.at(-1)?.kind).toBe('polyline');
  await expect(page.getByRole('button', { name: /尝试拟合|采用拟合|恢复原始笔迹/ })).toHaveCount(0);
  await choose(page, '撤销');
  expect((await json(page)).entities).toHaveLength(0);
  await choose(page, '恢复');
  expect(await json(page)).toEqual(raw);
});
test('long hand-drawn lines fit on release in every pen style without a circle prompt', async ({
  page,
}) => {
  await load(page, createDocument('VHW_PROJECTION'));
  for (const [name, kind, lineStyle] of [
    ['实线', 'segment', 'ANSWER_VISIBLE'],
    ['虚线', 'segment', 'ANSWER_HIDDEN'],
    ['辅助线', 'line', 'CONSTRUCTION'],
  ] as const) {
    await style(page, name);
    await stroke(page, wavyLineSample());
    await expect(page.locator(`[data-kind=${kind}]`)).toHaveCount(1);
    await expect(page.getByRole('button', { name: /尝试拟合|采用拟合/ })).toHaveCount(0);
    const doc = await json(page);
    expect(doc.entities.at(-1)).toMatchObject({ kind, lineStyle, samples: expect.any(Array) });
    if (name === '实线') {
      writeFileSync(`${evidence}/automatic-line.json`, JSON.stringify(doc, null, 2));
      await page.locator('.geometry-editor').screenshot({ path: `${evidence}/automatic-line.png` });
    }
    await choose(page, '恢复原始笔迹');
    expect((await json(page)).entities.at(-1)).toMatchObject({ kind: 'polyline', lineStyle });
    await choose(page, '撤销');
    expect((await json(page)).entities).toHaveLength(0);
    await choose(page, '恢复');
    expect((await json(page)).entities.at(-1)?.kind).toBe('polyline');
    await choose(page, '撤销');
  }
});
test('a valid noisy circle is automatically adopted on release, without confirmation', async ({
  page,
}) => {
  await load(page, createDocument('VHW_PROJECTION'));
  await choose(page, '电子笔');
  await stroke(page, borderlineCircleSample());
  await expect(page.locator('[data-kind=circle]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /尝试拟合|采用拟合/ })).toHaveCount(0);
  expect((await json(page)).entities.at(-1)).toMatchObject({
    kind: 'circle',
    radius: expect.any(Number),
  });
});
for (const width of [1366, 390])
  test(`vertical drifting strokes auto-fit upwards and downwards at different zooms (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 768 });
    await load(page, createDocument('VHW_PROJECTION'));
    await choose(page, '电子笔');
    for (const zoom of [1, 2]) {
      if (zoom === 2) {
        await choose(page, '放大');
        await closePanels(page);
      }
      for (const reverse of [false, true]) {
        await stroke(page, driftingLineSample(90, reverse, 300, true));
        await expect(page.locator('[data-kind=segment]')).toHaveCount(1);
        const doc = await json(page),
          segment = doc.entities.at(-1)!;
        expect(segment).toMatchObject({ kind: 'segment', samples: expect.any(Array) });
        if (zoom === 1 && !reverse) {
          writeFileSync(`${evidence}/vertical-drift-${width}.json`, JSON.stringify(doc, null, 2));
          await page
            .locator('.geometry-editor')
            .screenshot({ path: `${evidence}/vertical-drift-${width}.png` });
        }
        await choose(page, '撤销');
        expect((await json(page)).entities).toHaveLength(0);
        await choose(page, '恢复');
        expect(await json(page)).toEqual(doc);
        await choose(page, '恢复原始笔迹');
        expect((await json(page)).entities.at(-1)?.kind).toBe('polyline');
        await choose(page, '撤销');
      }
    }
  });
