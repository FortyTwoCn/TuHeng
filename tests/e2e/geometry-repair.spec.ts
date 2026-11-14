import { test, expect, type Page } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { GeometryDocument, type Vec2 } from '@tuheng/contracts';
import {
  localToSheet,
  point,
  createDocument,
  addDrawing,
  mergePoints,
} from '@tuheng/geometry-core';
import { standardSheet, connectionSheet, penSample } from '../repair-fixtures';
const evidence = 'test-results/editor-repair';
async function login(page: Page) {
  await page.goto('/login?callbackUrl=%2Fgeometry');
  await page.getByLabel('账号邮箱').fill('student@tuheng.local');
  await page.getByLabel('密码', { exact: true }).fill(process.env.SEED_PASSWORD!);
  await page.getByRole('button', { name: '进入图衡' }).click();
  await expect(page.locator('.geometry-editor')).toBeVisible();
}
async function load(page: Page, doc: GeometryDocument) {
  await page.getByLabel('加载几何 JSON').setInputFiles({
    name: 'case.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(doc)),
  });
  await expect(page.locator('[data-entity-id]')).toHaveCount(doc.entities.length);
}
async function json(page: Page) {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 JSON', exact: true }).click();
  return GeometryDocument.parse(JSON.parse(readFileSync((await (await download).path())!, 'utf8')));
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
async function clickAt(page: Page, p: Vec2) {
  const q = await screen(page, p);
  await page.mouse.click(q.x, q.y);
}
async function drag(page: Page, a: Vec2, b: Vec2, beforeUp?: () => Promise<void>) {
  const from = await screen(page, a),
    to = await screen(page, b);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  if (beforeUp) await beforeUp();
  await page.mouse.up();
}
const choose = (page: Page, name: string) =>
  page.getByRole('button', { name, exact: true }).click();
test.use({ viewport: { width: 1440, height: 1000 }, video: 'on' });
test.beforeEach(async ({ page }) => {
  mkdirSync(evidence, { recursive: true });
  await login(page);
});
test('one sheet and real point drag before pointerup', async ({ page }) => {
  await expect(page.locator('.geo-view svg')).toHaveCount(1);
  await choose(page, '点');
  await clickAt(page, { x: -30, y: 40 });
  const p = page.locator('[data-kind=point] circle').first();
  await choose(page, '选择');
  await drag(page, { x: -30, y: 40 }, { x: -20, y: 35 }, async () => {
    await expect(p).toHaveAttribute('cx', '-20');
  });
  const doc = await json(page);
  expect(localToSheet(doc, 'view-0', point(doc, doc.entities[0].id))).toEqual({ x: -20, y: 35 });
  await choose(page, '撤销');
  expect((await json(page)).entities[0]).toMatchObject({ position: { x: 30, y: 40 } });
  await choose(page, '恢复');
  expect((await json(page)).entities[0]).toMatchObject({ position: { x: 20, y: 35 } });
});
test('5px endpoint merge, cancellation, undo/redo and connected point moves both lines', async ({
  page,
}) => {
  const fixture = connectionSheet(),
    lines = fixture.entities.filter((e) => e.kind === 'segment'),
    source = lines[0].endPoint,
    target = lines[1].startPoint;
  await load(page, fixture);
  await choose(page, '选择');
  const q = await screen(page, { x: -10, y: 15 });
  const rawEnd = { x: -10 + 5 / q.scale, y: 15 };
  await drag(page, { x: -30, y: 35 }, rawEnd, async () => {
    await expect(page.locator('[data-transient=snap-target]')).toBeVisible();
  });
  let d = await json(page);
  expect(d.entities.filter((e) => e.kind === 'point')).toHaveLength(3);
  expect(d.entities.find((e) => e.id === lines[0].id)).toMatchObject({ endPoint: target });
  expect(d.entities.some((e) => e.id === source)).toBe(false);
  writeFileSync(`${evidence}/merged.json`, JSON.stringify(d, null, 2));
  await choose(page, '取消本次吸附');
  d = await json(page);
  expect(d.entities.filter((e) => e.kind === 'point')).toHaveLength(4);
  expect(localToSheet(d, 'view-0', point(d, source)).x).toBeCloseTo(rawEnd.x, 4);
  await choose(page, '撤销');
  expect(await json(page)).toEqual(fixture);
  await choose(page, '恢复');
  expect(await json(page)).toEqual(d);
  await choose(page, '撤销');
  await drag(page, { x: -30, y: 35 }, rawEnd);
  await drag(page, { x: -10, y: 15 }, { x: 2, y: 20 }, async () => {
    await expect(page.locator(`[data-entity-id="${lines[0].id}"] line`)).toHaveAttribute('x2', '2');
    await expect(page.locator(`[data-entity-id="${lines[1].id}"] line`)).toHaveAttribute('x1', '2');
  });
  d = await json(page);
  expect(point(d, target)).toEqual({ x: -2, y: 20 });
  await page.screenshot({ path: `${evidence}/merged-drag.png`, fullPage: true });
});
test('endpoint, line body, cancellation and captured pointer outside canvas are transactional', async ({
  page,
}) => {
  const fixture = connectionSheet(),
    line = fixture.entities.find((e) => e.kind === 'segment')!;
  if (line.kind !== 'segment') throw Error();
  await load(page, fixture);
  await choose(page, '选择');
  await drag(page, { x: -55, y: 35 }, { x: -60, y: 42 }, async () => {
    await expect(page.locator(`[data-entity-id="${line.id}"] line`)).toHaveAttribute('x1', '-60');
    await expect(page.locator(`[data-entity-id="${line.id}"] line`)).toHaveAttribute('x2', '-30');
  });
  await choose(page, '撤销');
  await drag(page, { x: -42.5, y: 35 }, { x: -37.5, y: 40 }, async () => {
    await expect(page.locator(`[data-entity-id="${line.id}"] line`)).toHaveAttribute('x1', '-50');
  });
  const moved = await json(page);
  await choose(page, '撤销');
  expect(await json(page)).toEqual(fixture);
  await choose(page, '恢复');
  expect(await json(page)).toEqual(moved);
  for (const event of ['Escape', 'pointercancel', 'lostpointercapture']) {
    const a = await screen(page, { x: -50, y: 40 });
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(a.x + 20, a.y - 10, { steps: 4 });
    if (event === 'Escape') await page.keyboard.press('Escape');
    else
      await page
        .locator('.geo-active svg')
        .dispatchEvent(event, { pointerId: 1, pointerType: 'mouse' });
    await page.mouse.up();
    expect(await json(page)).toEqual(moved);
  }
  const a = await screen(page, { x: -50, y: 40 }),
    box = (await page.locator('.geo-active svg').boundingBox())!;
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width + 30, a.y, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('.geo-active svg')).toHaveAttribute('data-interaction', 'idle');
  await choose(page, '撤销');
  expect(await json(page)).toEqual(moved);
});
test('real multi-selection drag transforms a shared node once and commits one history step', async ({
  page,
}) => {
  const initial = connectionSheet(),
    lines = initial.entities.filter((e) => e.kind === 'segment'),
    fixture = mergePoints(initial, lines[0].endPoint, lines[1].startPoint, 'student');
  await load(page, fixture);
  await choose(page, '选择');
  await clickAt(page, { x: -32.5, y: 25 });
  await page.keyboard.down('Shift');
  await clickAt(page, { x: -10, y: 30 });
  await page.keyboard.up('Shift');
  await drag(page, { x: -32.5, y: 25 }, { x: -26.5, y: 32 }, async () => {
    await expect(page.locator(`[data-entity-id="${lines[0].id}"] line`)).toHaveAttribute(
      'x2',
      '-4',
    );
    await expect(page.locator(`[data-entity-id="${lines[1].id}"] line`)).toHaveAttribute(
      'x1',
      '-4',
    );
  });
  const moved = await json(page);
  for (const e of fixture.entities.filter((e) => e.kind === 'point'))
    expect(point(moved, e.id)).toEqual({ x: e.position.x - 6, y: e.position.y + 7 });
  await choose(page, '撤销');
  expect(await json(page)).toEqual(fixture);
  await choose(page, '恢复');
  expect(await json(page)).toEqual(moved);
});
test('standard coordinates, two-level parallel/perpendicular axes, reload and responsive single camera', async ({
  page,
}) => {
  const fixture = standardSheet();
  await load(page, fixture);
  for (const [id, p] of [
    ['A_V', { x: -30, y: 40 }],
    ['A_H', { x: -30, y: -20 }],
    ['A_W', { x: 20, y: 40 }],
  ] as const) {
    await expect(page.locator(`[data-entity-id="${id}"] circle`)).toHaveAttribute(
      'cx',
      String(p.x),
    );
    await expect(page.locator(`[data-entity-id="${id}"] circle`)).toHaveAttribute(
      'cy',
      String(p.y),
    );
  }
  await page.locator('.geo-tabs').getByRole('button', { name: 'H', exact: true }).click();
  await choose(page, '实线');
  await drag(page, { x: -50, y: -10 }, { x: -20, y: -10 });
  await page.getByText('新增投影轴 / 换面', { exact: true }).click();
  await page.getByLabel('新轴构造').selectOption('PARALLEL');
  await choose(page, '开始定位新轴');
  await clickAt(page, { x: -35, y: -10 });
  await clickAt(page, { x: -50, y: -35 });
  await clickAt(page, { x: -50, y: -43 });
  await choose(page, '确认新轴');
  let d = await json(page);
  expect(d.auxiliarySystems).toHaveLength(1);
  expect(d.entities).toHaveLength(6);
  const first = d.auxiliarySystems![0];
  expect(first.tangent.y).toBeCloseTo(0);
  expect(first.positiveNormal.y).toBe(-1);
  await page.locator('.geo-tabs').getByRole('button', { name: 'V1', exact: true }).click();
  await choose(page, '实线');
  await drag(page, { x: -50, y: -45 }, { x: -30, y: -45 });
  await page.getByLabel('父投影系').selectOption(first.id);
  await page.getByLabel('新轴构造').selectOption('PERPENDICULAR');
  await choose(page, '开始定位新轴');
  await clickAt(page, { x: -40, y: -45 });
  await clickAt(page, { x: -65, y: -30 });
  await clickAt(page, { x: -80, y: -30 });
  await choose(page, '确认新轴');
  d = await json(page);
  expect(d.auxiliarySystems).toHaveLength(2);
  expect(d.auxiliarySystems![1].tangent.x).toBeCloseTo(0);
  writeFileSync(`${evidence}/axes.json`, JSON.stringify(d, null, 2));
  await choose(page, '撤销');
  expect((await json(page)).auxiliarySystems).toHaveLength(1);
  await choose(page, '恢复');
  expect(await json(page)).toEqual(d);
  await load(page, d);
  expect(await json(page)).toEqual(d);
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await choose(page, '完整展开图');
    await expect(page.locator('.geo-view svg')).toHaveCount(1);
    const before = await json(page);
    await choose(page, '聚焦当前投影');
    expect(await json(page)).toEqual(before);
    await choose(page, '完整展开图');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `${evidence}/sheet-${width}.png`, fullPage: true });
  }
});
test('freehand circles at multiple zooms with ruler off are circle entities and recoverable', async ({
  page,
}) => {
  await load(page, createDocument('VHW_PROJECTION'));
  await choose(page, '电子笔');
  await expect(page.getByLabel('虚拟直尺', { exact: true })).not.toBeChecked();
  for (const zoom of [1, 2]) {
    if (zoom === 2) await choose(page, '放大');
    const c = await screen(page, { x: -20, y: 25 }),
      samples = penSample(1, zoom === 1 ? 1 : -1);
    const a = samples[0];
    await page.mouse.move(c.x + a.x, c.y - a.y);
    await page.mouse.down();
    for (const p of samples.slice(1)) await page.mouse.move(c.x + p.x, c.y - p.y);
    await page.mouse.up();
    let d = await json(page);
    expect(d.entities.at(-1)?.kind).toBe('circle');
    expect(d.entities.at(-1)).toHaveProperty('center');
    await choose(page, '恢复原始笔迹');
    d = await json(page);
    expect(d.entities.at(-1)?.kind).toBe('polyline');
    expect(d.entities.at(-1)).toHaveProperty('samples');
    await choose(page, '撤销');
  }
});
for (const width of [1024, 390])
  test(`real drag, merge, axis and circle at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const fixture = connectionSheet(),
      lines = fixture.entities.filter((e) => e.kind === 'segment');
    await load(page, fixture);
    await choose(page, '选择');
    const target = await screen(page, { x: -10, y: 15 });
    await drag(page, { x: -30, y: 35 }, { x: -10 + 5 / target.scale, y: 15 });
    let d = await json(page);
    expect(d.entities.find((e) => e.id === lines[0].id)).toMatchObject({
      endPoint: lines[1].startPoint,
    });
    await drag(page, { x: -10, y: 15 }, { x: -5, y: 20 }, async () => {
      expect(
        Number(await page.locator(`[data-entity-id="${lines[0].id}"] line`).getAttribute('x2')),
      ).toBeCloseTo(-5, 4);
    });
    await page.getByText('新增投影轴 / 换面', { exact: true }).click();
    await choose(page, '开始定位新轴');
    await clickAt(page, { x: 10, y: -10 });
    await clickAt(page, { x: 10, y: -30 });
    await clickAt(page, { x: 25, y: -20 });
    await choose(page, '确认新轴');
    d = await json(page);
    expect(d.auxiliarySystems).toHaveLength(1);
    await load(page, d);
    expect(await json(page)).toEqual(d);
    await choose(page, '电子笔');
    const c = await screen(page, { x: 15, y: 40 });
    const samples = penSample(1).map((p) => ({ x: p.x * 0.65, y: p.y * 0.65 }));
    await page.mouse.move(c.x + samples[0].x, c.y - samples[0].y);
    await page.mouse.down();
    for (const p of samples.slice(1)) await page.mouse.move(c.x + p.x, c.y - p.y);
    await page.mouse.up();
    expect((await json(page)).entities.at(-1)?.kind).toBe('circle');
    await choose(page, '完整展开图');
    await page.screenshot({ path: `${evidence}/operations-${width}.png`, fullPage: true });
  });
test('pen/touch simulated cancellation preserves samples, ignores palm during stroke and pinch never changes JSON', async ({
  page,
  context,
}) => {
  await load(page, standardSheet());
  await choose(page, '电子笔');
  const svg = page.locator('.geo-active svg');
  await svg.scrollIntoViewIfNeeded();
  const c = await screen(page, { x: -30, y: 20 }),
    initial = await svg.getAttribute('viewBox');
  await svg.dispatchEvent('pointerdown', {
    pointerId: 40,
    pointerType: 'pen',
    button: 0,
    clientX: c.x,
    clientY: c.y,
    pressure: 0.5,
  });
  for (let i = 1; i <= 10; i++)
    await svg.dispatchEvent('pointermove', {
      pointerId: 40,
      pointerType: 'pen',
      buttons: 1,
      clientX: c.x + i * 3,
      clientY: c.y,
      pressure: 0.5,
    });
  await svg.dispatchEvent('pointerdown', {
    pointerId: 41,
    pointerType: 'touch',
    button: 0,
    clientX: c.x + 60,
    clientY: c.y + 80,
  });
  await svg.dispatchEvent('pointermove', {
    pointerId: 41,
    pointerType: 'touch',
    clientX: c.x + 150,
    clientY: c.y + 80,
  });
  await expect(svg).toHaveAttribute('viewBox', initial!);
  await svg.dispatchEvent('pointercancel', { pointerId: 40, pointerType: 'pen' });
  await choose(page, '恢复中断笔迹');
  expect((await json(page)).entities.at(-1)?.kind).toBe('polyline');
  await choose(page, '平移');
  const before = await json(page);
  await svg.scrollIntoViewIfNeeded();
  const b = (await svg.boundingBox())!,
    cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: b.x + 120, y: b.y + 160, id: 1 },
      { x: b.x + 180, y: b.y + 160, id: 2 },
    ],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { x: b.x + 80, y: b.y + 160, id: 1 },
      { x: b.x + 220, y: b.y + 160, id: 2 },
    ],
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect(await json(page)).toEqual(before);
  await cdp.detach();
});

test('stem anchor stays read-only in the UI and explicit disconnection affects only the chosen answer', async ({
  page,
}) => {
  let fixture = addDrawing(
    createDocument('VHW_PROJECTION'),
    'point',
    'view-0',
    [{ x: 25, y: 35 }],
    'teacher',
  );
  const stem = fixture.entities[0];
  fixture = addDrawing(
    fixture,
    'segment',
    'view-0',
    [
      { x: 60, y: 25 },
      { x: 40, y: 25 },
    ],
    'student',
  );
  const line = fixture.entities.at(-1)!;
  await load(page, fixture);
  await choose(page, '选择');
  await drag(page, { x: -40, y: 25 }, { x: -25, y: 35 });
  const anchored = await json(page);
  expect(anchored.entities.find((e) => e.id === line.id)).toMatchObject({ endPoint: stem.id });
  await drag(page, { x: -25, y: 35 }, { x: -15, y: 45 });
  expect(await json(page)).toEqual(anchored);
  await expect(page.locator('.geo-status').first()).toContainText('只读');
  await page.getByText('节点连接与绑定', { exact: true }).click();
  await choose(page, '解除此对象连接');
  const detached = await json(page);
  expect(detached.entities.find((e) => e.id === stem.id)).toEqual(stem);
  expect(detached.entities.find((e) => e.id === line.id)).not.toMatchObject({ endPoint: stem.id });
});
