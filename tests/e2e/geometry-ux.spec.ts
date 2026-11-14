import { test, expect, type Page } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { GeometryDocument, type Vec2 } from '@tuheng/contracts';
import {
  createDocument,
  addDrawing,
  addProjectionAxis,
  point,
  lineGeometry,
  length,
  localToSheet,
  mergePoints,
  exportSheetSvg,
  exportGeometryNarrative,
} from '@tuheng/geometry-core';
import { choose, closePanels } from './editor-controls';
import { connectionSheet, standardSheet } from '../repair-fixtures';

test.use({ viewport: { width: 1366, height: 768 } });
async function load(page: Page, document = connectionSheet()) {
  await page.goto('/login?callbackUrl=%2Fgeometry');
  await page.getByLabel('账号邮箱').fill('student@tuheng.local');
  await page.getByLabel('密码', { exact: true }).fill(process.env.SEED_PASSWORD!);
  await page.getByRole('button', { name: '进入图衡' }).click();
  await expect(page.locator('.geometry-editor')).toBeVisible();
  await page.getByLabel('加载几何 JSON').setInputFiles({
    name: 'ux.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(document)),
  });
  await expect(page.locator('[data-entity-id]')).toHaveCount(document.entities.length);
  await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
}
async function screen(page: Page, p: Vec2) {
  const svg = page.locator('.geo-view svg').first();
  await svg.scrollIntoViewIfNeeded();
  return svg.evaluate((el, p) => {
    const q = new DOMPoint(p.x, -p.y).matrixTransform((el as SVGSVGElement).getScreenCTM()!);
    return { x: q.x, y: q.y };
  }, p);
}
async function press(page: Page, p: Vec2) {
  const a = await screen(page, p);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
}
async function move(page: Page, p: Vec2) {
  const b = await screen(page, p);
  await page.mouse.move(b.x, b.y, { steps: 6 });
}
async function json(page: Page) {
  const pending = page.waitForEvent('download');
  await choose(page,'导出 JSON');
  await closePanels(page);
  return GeometryDocument.parse(JSON.parse(readFileSync((await (await pending).path())!, 'utf8')));
}
test('UX01: live length HUD exists before pointerup', async ({ page }) => {
  await load(page);
  await press(page, { x: -30, y: 35 });
  await move(page, { x: -20, y: 40 });
  await expect(page.locator('[data-measurement-hud]')).toContainText('mm', { timeout: 1500 });
  await page.mouse.up();
});
test('UX05: a standalone point snaps to the actual Z axis', async ({ page }) => {
  await load(page, standardSheet());
  await press(page, { x: -30, y: 40 });
  await move(page, { x: -0.5, y: 25 });
  await page.mouse.up();
  const point = (await json(page)).entities.find((e) => e.id === 'A_V');
  expect(point?.kind).toBe('point');
  if (point?.kind === 'point') {
    expect(point.position.x).toBe(0);
    expect(point.position.y).toBeCloseTo(25, 4);
  }
});
test('UX10: base axis can be selected as a read-only reference', async ({ page }) => {
  await load(page);
  await press(page, { x: 0, y: 25 });
  await page.mouse.up();
  await expect(page.getByRole('dialog', { name: '对象属性', exact: true })).toContainText('Z', {
    timeout: 1500,
  });
});
test('UX12: blank drag in selection mode previews a real rectangle', async ({ page }) => {
  await load(page);
  await press(page, { x: -65, y: 50 });
  await move(page, { x: -20, y: 25 });
  await expect(page.locator('[data-selection-mode="window"]')).toBeVisible({ timeout: 1500 });
  await page.mouse.up();
});
test('UX15: clicking an entity opens its nearby editable inspector', async ({ page }) => {
  await load(page);
  await press(page, { x: -42.5, y: 35 });
  await page.mouse.up();
  await expect(page.getByRole('dialog', { name: '对象属性', exact: true })).toBeVisible({
    timeout: 1500,
  });
});
test('UX30: construction is reachable from a named primary group', async ({ page }) => {
  await load(page);
  await expect(page.getByRole('button', { name: '构造', exact: true })).toBeVisible({
    timeout: 1500,
  });
  await page.getByRole('button', { name: '构造', exact: true }).click();
  await expect(page.getByRole('button', { name: '平行线', exact: true })).toBeVisible();
});
const evidence = 'test-results/geometry-ux-v2';
test.beforeEach(() => mkdirSync(evidence, { recursive: true }));
async function click(page: Page, p: Vec2) {
  await press(page, p);
  await page.mouse.up();
}
async function drag(page: Page, a: Vec2, b: Vec2) {
  await press(page, a);
  await move(page, b);
  await page.mouse.up();
}
function position(d: GeometryDocument, id: string) {
  return localToSheet(d, d.entities.find((e) => e.id === id)!.viewId, point(d, id));
}
test('UX02/22: snapped preview measurement, cancel adjustment and one history transaction agree', async ({
  page,
}) => {
  const d = connectionSheet(),
    lines = d.entities.filter((e) => e.kind === 'segment');
  await load(page, d);
  const q = await screen(page, { x: -10, y: 15 }),
    q1 = await screen(page, { x: -9, y: 15 }),
    scale = q1.x - q.x;
  await press(page, { x: -30, y: 35 });
  await move(page, { x: -10 + 5 / scale, y: 15 });
  const expected = Math.hypot(45, 20).toFixed(2);
  await expect(page.locator('[data-measurement-hud]')).toContainText(expected + ' mm');
  await expect(page.locator('.geo-snap-feedback')).toContainText('吸附');
  await page.screenshot({ path: evidence + '/drag-hud-snap.png' });
  await page.mouse.up();
  const merged = await json(page);
  expect(merged.entities.find((e) => e.id === lines[0].id)).toMatchObject({
    endPoint: lines[1].startPoint,
  });
  writeFileSync(evidence + '/merged.json', JSON.stringify(merged, null, 2));
  await choose(page, '取消本次吸附');
  const raw = await json(page);
  expect(raw.entities.find((e) => e.id === lines[0].id)).toMatchObject({
    endPoint: lines[0].endPoint,
  });
  expect(position(raw, lines[0].endPoint).x).toBeCloseTo(-10 + 5 / scale, 4);
  await choose(page, '撤销');
  expect(await json(page)).toEqual(d);
  await choose(page, '恢复');
  expect(await json(page)).toEqual(raw);
});
test('UX03/04/16: precise property drafts keep focus and commit once with fixed midpoint', async ({
  page,
}) => {
  const d = connectionSheet(),
    line = d.entities.find((e) => e.kind === 'segment')!;
  await load(page, d);
  await click(page, { x: -42.5, y: 35 });
  const card = page.getByRole('dialog', { name: '对象属性', exact: true }),
    input = card.getByLabel('长度 (mm)', { exact: true });
  await input.fill('-');
  await expect(input).toBeFocused();
  await input.press('Enter');
  await expect(card.getByRole('alert')).toBeVisible();
  expect(await json(page)).toEqual(d);
  await input.fill('');
  await expect(input).toHaveValue('');
  await input.fill('40');
  await card.getByLabel('局部角度 (°)').fill('90');
  await card.getByLabel('固定端').selectOption('midpoint');
  await choose(page, '确认属性');
  const next = await json(page);
  expect(point(next, line.startPoint)).toEqual({ x: 42.5, y: 15 });
  expect(point(next, line.endPoint).y).toBe(55);
  await choose(page, '撤销');
  expect(await json(page)).toEqual(d);
  await choose(page, '恢复');
  expect(await json(page)).toEqual(next);
  await input.fill('123');
  await input.press('Escape');
  await expect(input).toHaveValue('40');
  expect(await json(page)).toEqual(next);
});
test('UX06/09: origin is independent and continuous axis drag refreshes its foot', async ({
  page,
}) => {
  await load(page, standardSheet());
  await press(page, { x: -30, y: 40 });
  for (const y of [30, 25, 18]) {
    await move(page, { x: -0.4, y });
    await expect
      .poll(async () =>
        Number(await page.locator('[data-entity-id="A_V"] circle').first().getAttribute('cy')),
      )
      .toBeCloseTo(y, 4);
  }
  await move(page, { x: 0.3, y: 0.3 });
  await expect(page.locator('.geo-snap-feedback')).toContainText('原点');
  await page.mouse.up();
  const d = await json(page);
  expect(point(d, 'A_V')).toEqual({ x: 0, y: 0 });
  expect(d.entities.filter((e) => e.kind === 'point')).toHaveLength(3);
  expect(d.referenceRelations?.at(-1)?.reference).toMatchObject({ kind: 'origin' });
});
for (const factor of [0.5, 1, 2])
  test('UX08: same CSS snap distance and anchored zoom at ' + factor, async ({ page }) => {
    await load(page, standardSheet());
    const first = await screen(page, { x: -15, y: 20 }),
      before = { x: Math.round(first.x), y: Math.round(first.y) };
    const at = await page.locator('.geo-view svg').evaluate((e, p) => {
      const q = new DOMPoint(p.x, p.y).matrixTransform(
        (e as SVGSVGElement).getScreenCTM()!.inverse(),
      );
      return { x: q.x, y: -q.y };
    }, before);
    await page.mouse.move(before.x, before.y);
    await page.mouse.wheel(0, -Math.log(factor) * 1000);
    await expect
      .poll(async () => {
        const p = await screen(page, at);
        return Math.hypot(p.x - before.x, p.y - before.y);
      })
      .toBeLessThan(0.1);
    const z = await screen(page, { x: 0, y: 25 }),
      one = await screen(page, { x: 1, y: 25 });
    await press(page, { x: -30, y: 40 });
    await page.mouse.move(z.x - 5, z.y, { steps: 8 });
    await expect(page.locator('.geo-snap-feedback')).toContainText('Z');
    await page.mouse.up();
    expect(point(await json(page), 'A_V').x).toBe(0);
    expect(one.x - z.x).toBeGreaterThan(0);
  });
test('UX07/10/18: offset new axis is a real snapping and construction reference', async ({
  page,
}) => {
  let d = addProjectionAxis(
    standardSheet(),
    {
      name: 'X1',
      viewName: 'V1',
      retainedViewId: 'view-1',
      replacedViewId: 'view-0',
      parentId: null,
      method: 'FREE',
      referenceEntityId: null,
      anchor: { x: -40, y: 10 },
      through: { x: -20, y: 30 },
      side: 1,
    },
    'student',
  );
  await load(page, d);
  await drag(page, { x: -30, y: 40 }, { x: -29.5, y: 20 });
  const after = await json(page);
  const p = position(after, 'A_V');
  expect(p.x).toBeCloseTo(-29.75, 4);
  expect(p.y).toBeCloseTo(20.25, 4);
  expect(after.referenceRelations?.at(-1)?.reference).toMatchObject({
    kind: 'projectionAxis',
    systemId: d.auxiliarySystems![0].id,
  });
  await choose(page, '关闭对象属性');
  await click(page, { x: -10, y: 40 });
  await expect(page.getByRole('dialog', { name: '对象属性', exact: true })).toContainText('X1');
  await choose(page, '平行线');
  await click(page, { x: -20, y: 50 });
  d = await json(page);
  const line = d.entities.at(-1)!;
  expect(line.kind).toBe('line');
  const v = lineGeometry(d, line).d;
  expect(Math.abs(v.x + v.y)).toBeLessThan(1e-6);
  writeFileSync(evidence + '/reference-axis.json', JSON.stringify(d, null, 2));
});
test('UX12/13/14: window crossing and Shift multi-view marquee use exact geometry', async ({
  page,
}) => {
  let d = addDrawing(
    standardSheet(),
    'circle',
    'view-0',
    [
      { x: 50, y: 20 },
      { x: 60, y: 20 },
    ],
    'student',
  );
  d = addDrawing(
    d,
    'line',
    'view-0',
    [
      { x: 70, y: 10 },
      { x: 70, y: 40 },
    ],
    'student',
  );
  const circle = d.entities.find((e) => e.kind === 'circle')!,
    line = d.entities.at(-1)!;
  await load(page, d);
  await press(page, { x: -75, y: 35 });
  await move(page, { x: -39, y: 5 });
  await expect(page.locator('[data-selection-mode="window"]')).toBeVisible();
  await page.screenshot({ path: evidence + '/window-marquee.png' });
  await page.mouse.up();
  await expect(page.locator('[data-entity-id="' + circle.id + '"]')).toHaveAttribute(
    'data-selected',
    'true',
  );
  await expect(page.locator('[data-entity-id="' + line.id + '"]')).not.toHaveAttribute(
    'data-selected',
    'true',
  );
  await drag(page, { x: -40, y: 35 }, { x: -75, y: 5 });
  await expect(page.locator('[data-entity-id="' + line.id + '"]')).toHaveAttribute(
    'data-selected',
    'true',
  );
  await click(page, { x: 45, y: -30 });
  await drag(page, { x: -35, y: 45 }, { x: -25, y: 35 });
  await page.keyboard.down('Shift');
  await drag(page, { x: 15, y: 45 }, { x: 25, y: 35 });
  await page.keyboard.up('Shift');
  await expect(page.getByRole('dialog', { name: '对象属性', exact: true })).toContainText(
    '2 个对象',
  );
  await drag(page, { x: -30, y: 40 }, { x: -25, y: 43 });
  const moved = await json(page);
  expect(position(moved, 'A_V').x).toBeCloseTo(-25, 4);
  expect(position(moved, 'A_W').x).toBeCloseTo(25, 4);
  expect(position(moved, 'A_W').y).toBeCloseTo(43, 4);
});
test('UX18/19/20: reference-first finite construction, confirmed direction and maintained relation', async ({
  page,
}) => {
  const initial = connectionSheet(),
    lines = initial.entities.filter((e) => e.kind === 'segment');
  await load(page, initial);
  await click(page, { x: 0, y: 25 });
  await choose(page, '垂直线');
  await page.getByLabel('几何范围').selectOption('segment');
  await page.getByLabel('构造长度 (mm)').fill('12');
  await click(page, { x: -55, y: 35 });
  let d = await json(page);
  const made = d.entities.at(-1)!;
  expect(made).toMatchObject({ kind: 'segment', startPoint: lines[0].startPoint });
  expect(length(lineGeometry(d, made).d)).toBeCloseTo(12);
  await choose(page, '撤销');
  await click(page, { x: -42.5, y: 35 });
  await choose(page, '调整为平行');
  await page.getByLabel('保持关系（有向绑定）').check();
  await click(page, { x: -10, y: 30 });
  await expect(page.getByRole('dialog', { name: '构造与关系' })).toContainText('检查预览');
  expect(await json(page)).toEqual(initial);
  await choose(page, '确认方向调整');
  d = await json(page);
  expect(d.referenceRelations?.at(-1)).toMatchObject({
    kind: 'PARALLEL',
    mode: 'BINDING',
    status: 'SATISFIED',
  });
  await drag(page, { x: -30, y: 35 }, { x: -25, y: 43 });
  d = await json(page);
  const a = lineGeometry(d, lines[0]).d,
    b = lineGeometry(d, lines[1]).d;
  expect(a.x * b.y - a.y * b.x).toBeCloseTo(0);
  await choose(page, '撤销');
  expect((await json(page)).referenceRelations?.at(-1)?.status).toBe('SATISFIED');
});
test('UX21/23/29: shared node movement and clean exports preserve projection identities', async ({
  page,
}) => {
  let d = connectionSheet();
  const lines = d.entities.filter((e) => e.kind === 'segment');
  d = mergePoints(d, lines[0].endPoint, lines[1].startPoint, 'student');
  await load(page, d);
  await drag(page, { x: -10, y: 15 }, { x: -16, y: 20 });
  const moved = await json(page);
  expect(moved.entities.find((e) => e.id === lines[0].id)).toMatchObject({
    endPoint: lines[1].startPoint,
  });
  expect(position(moved, lines[1].startPoint).x).toBeCloseTo(-16, 4);
  expect(position(moved, lines[1].startPoint).y).toBeCloseTo(20, 4);
  for (const text of [JSON.stringify(moved), exportSheetSvg(moved), exportGeometryNarrative(moved)])
    expect(text).not.toMatch(/measurement-hud|data-transient|geo-floating-inspector/);
  await load(page, standardSheet());
  await drag(page, { x: -30, y: 40 }, { x: 20, y: 40 });
  const separate = await json(page);
  expect(separate.entities.some((e) => e.id === 'A_V')).toBe(true);
  expect(separate.entities.some((e) => e.id === 'A_W')).toBe(true);
});
for (const [width, height] of [
  [360, 800],
  [390, 844],
  [768, 1024],
  [1024, 768],
  [1366, 768],
])
  test(
    'UX15/17/30: fullscreen layout and local properties ' + width + 'x' + height,
    async ({ page }) => {
      await page.setViewportSize({ width, height });
      await load(page);
      await choose(page, '展开编辑');
      const canvas = page.locator('.geo-view svg');
      const b = (await canvas.boundingBox())!;
      expect(b.y).toBeLessThan(130);
      expect(b.y + b.height).toBeLessThanOrEqual(height);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await click(page, { x: -42.5, y: 35 });
      const card = page.getByRole('dialog', { name: '对象属性', exact: true });
      await expect(card).toBeVisible();
      if (width < 700) {
        await expect(card.locator('.geo-compact-summary')).toContainText('25.00 mm');
        await choose(page, '编辑属性');
      }
      const input = card.getByLabel('长度 (mm)', { exact: true });
      await input.fill('28');
      await expect(input).toBeFocused();
      await page.screenshot({ path: evidence + '/properties-' + width + '.png' });
      await choose(page, '确认属性');
      expect(
        length(
          lineGeometry(
            await json(page),
            (await json(page)).entities.find((e) => e.kind === 'segment')!,
          ).d,
        ),
      ).toBeCloseTo(28);
    },
  );
test('UX01/02: new line and circle preview measurements equal snapped committed geometry', async ({
  page,
}) => {
  await load(page, createDocument('VHW_PROJECTION'));
  await choose(page, '实线');
  await press(page, { x: -0.5, y: 30 });
  await move(page, { x: -20, y: 30 });
  await expect(page.locator('[data-measurement-hud]')).toContainText('20.00 mm');
  await page.mouse.up();
  let d = await json(page);
  expect(length(lineGeometry(d, d.entities.at(-1)!).d)).toBeCloseTo(20, 4);
  await choose(page, '撤销');
  await choose(page, '圆');
  await click(page, { x: -0.5, y: 30 });
  await press(page, { x: -20, y: 30 });
  await move(page, { x: -20, y: 30.2 });
  await expect(page.locator('[data-measurement-hud]')).toContainText('20.00 mm');
  await expect(page.locator('[data-transient=preview-circle]')).toBeVisible();
  await page.mouse.up();
  d = await json(page);
  const circle = d.entities.at(-1)!;
  expect(circle.kind).toBe('circle');
  if (circle.kind === 'circle') {
    expect(circle.radius).toBeCloseTo(Math.hypot(20, 0.2), 3);
    expect(point(d, circle.center).x).toBe(0);
  }
  await choose(page, '取消本次吸附');
  const raw = await json(page);
  const c = raw.entities.at(-1)!;
  if (c.kind === 'circle') expect(point(raw, c.center).x).toBeCloseTo(0.5, 4);
});
test('UX22: pause snap preserves original stroke and the next gesture restores the global setting', async ({
  page,
}) => {
  await load(page, createDocument('VHW_PROJECTION'));
  await choose(page, '实线');
  await press(page, { x: -0.5, y: 30 });
  await move(page, { x: -20, y: 30 });
  await page.keyboard.down('Alt');
  await move(page, { x: -20, y: 31 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  const raw = await json(page),
    line = raw.entities.find((e) => e.kind === 'segment')!;
  expect(point(raw, line.startPoint).x).toBeCloseTo(0.5, 4);
  expect(raw.referenceRelations ?? []).toHaveLength(0);
  await choose(page, '点');
  await click(page, { x: -0.5, y: 15 });
  const d = await json(page);
  const p = d.entities.at(-1)!;
  if (p.kind === 'point') expect(p.position.x).toBe(0);
});
