import { expect, test, type Locator, type Page } from '@playwright/test';
import { addDrawing, createDocument, distance, point } from '@tuheng/geometry-core';
import type { GeometryDocument, Vec2 } from '@tuheng/contracts';
import { mkdir } from 'node:fs/promises';
import { prepareLogin } from './identity-login';
import { activateCommand, at, setup } from './editor-fixture';

async function startDrawing(page: Page, doc: GeometryDocument, anchor: Vec2, touch = false) {
  await setup(page);
  const editor = page.locator('[data-editor="a"]');
  await editor.evaluate((el) => {
    el.style.width = '100%';
    (el.nextElementSibling as HTMLElement).hidden = true;
  });
  const file = editor.locator('input[type=file]');
  await file.setInputFiles({
    name: 'reference.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(doc)),
  });
  await expect(file).toHaveValue('');
  await activateCommand(editor, 'segment', touch);
  const svg = editor.locator('.geo-view > svg');
  const start = await at(svg, anchor.x, anchor.y);
  if (touch) await page.touchscreen.tap(start.x, start.y);
  else await page.mouse.click(start.x, start.y);
  return { editor, svg };
}
const read = (page: Page) => page.evaluate(() => window.editorFixture.documents()[0]!);
async function hover(page: Page, svg: Locator, p: Vec2) {
  const screen = await at(svg, p.x, p.y);
  await page.mouse.move(screen.x, screen.y, { steps: 4 });
  return screen;
}
const lineA = { x: -26, y: 4 },
  lineB = { x: -10, y: 16 };
const obliqueLine = () =>
  addDrawing(createDocument('ISOMETRIC'), 'segment', 'view-0', [lineA, lineB], 'teacher');

for (const [kind, anchor, target, delta] of [
  ['parallel', { x: -24, y: -12 }, { x: 8, y: 12.4 }, { x: 0.8, y: 0.6 }],
  ['perpendicular', { x: 16, y: -15 }, { x: -2.3, y: 9 }, { x: -0.6, y: 0.8 }],
] as const) {
  test(
    kind +
      ' preview identifies the oblique reference, survives a compatible length and follows the committed segment',
    async ({ page }) => {
      const doc = obliqueLine(),
        source = doc.entities.at(-1)!;
      const { editor, svg } = await startDrawing(page, doc, anchor);
      await hover(page, svg, target);
      const guide = svg.locator('[data-relation-guide="' + kind + '"]');
      await expect(guide).toHaveAttribute('data-source-id', source.id);
      expect((await read(page)).entities).toEqual(doc.entities);
      await page.keyboard.type('28.5');
      await expect(guide).toBeVisible();
      await page.keyboard.press('Enter');
      const saved = await read(page);
      const line = saved.entities.at(-1)!;
      expect(line.kind).toBe('segment');
      if (line.kind !== 'segment') throw Error('Expected line');
      const a = point(saved, line.startPoint),
        b = point(saved, line.endPoint);
      expect(b.x - a.x).toBeCloseTo(28.5 * delta.x, 8);
      expect(b.y - a.y).toBeCloseTo(28.5 * delta.y, 8);
      expect(saved.entities.find((e) => e.id === source.id)).toEqual(source);
      expect(saved.referenceRelations ?? []).toEqual(doc.referenceRelations ?? []);
      await page.keyboard.press('Escape');
      await expect(guide).toHaveCount(0);
      await editor.getByRole('button', { name: '撤销', exact: true }).click();
      expect((await read(page)).entities).toEqual(doc.entities);
    },
  );
}
test('a circle displays a tangent contact before clicking; direction and radius in the saved geometry are perpendicular', async ({
  page,
}) => {
  const center = { x: 0, y: 10 },
    anchor = { x: -20, y: 10 },
    radius = 8;
  const doc = addDrawing(
    createDocument('ISOMETRIC'),
    'circle',
    'view-0',
    [center, { x: 8, y: 10 }],
    'teacher',
  );
  const { svg } = await startDrawing(page, doc, anchor);
  const contact = { x: -3.2, y: 10 + Math.sqrt(64 - 3.2 ** 2) };
  const screen = await hover(page, svg, { x: contact.x + 0.28, y: contact.y - 0.2 });
  const guide = svg.locator('[data-relation-guide="tangent"]');
  await expect(guide).toHaveAttribute('data-source-id', doc.entities.at(-1)!.id);
  expect((await read(page)).entities).toEqual(doc.entities);
  await page.mouse.click(screen.x, screen.y);
  const saved = await read(page),
    line = saved.entities.at(-1)!;
  if (line.kind !== 'segment') throw Error('Expected a tangent segment');
  const a = point(saved, line.startPoint),
    b = point(saved, line.endPoint);
  expect(distance(b, center)).toBeCloseTo(radius, 7);
  expect((b.x - a.x) * (b.x - center.x) + (b.y - a.y) * (b.y - center.y)).toBeCloseTo(0, 7);
  expect(saved.constraints).toEqual(doc.constraints);
});
test('an explicit incompatible angle clears the relation marker and preserves the entered direction', async ({
  page,
}) => {
  const { svg, editor } = await startDrawing(page, obliqueLine(), { x: -24, y: -12 });
  await hover(page, svg, { x: 8, y: 12.4 });
  const guide = svg.locator('[data-relation-guide="parallel"]');
  await expect(guide).toBeVisible();
  await editor.getByRole('textbox', { name: '动态角度' }).fill('13');
  await expect(guide).toHaveCount(0);
  await page.keyboard.press('Enter');
  const saved = await read(page),
    line = saved.entities.at(-1)!;
  if (line.kind !== 'segment') throw Error('Expected line');
  const a = point(saved, line.startPoint),
    b = point(saved, line.endPoint);
  expect((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI).toBeCloseTo(13, 7);
});

test('official workspace shows each relation on the paper before committing or cancelling', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const login = await prepareLogin(page, 'student', '/geometry');
  await login.fill('student@tuheng.local');
  await page.getByLabel('密码', { exact: true }).fill(process.env.SEED_PASSWORD!);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  const editor = page.getByRole('main', { name: '独立几何作图' }),
    svg = editor.getByLabel('统一展开图绘图区');
  await expect(svg).toBeVisible();
  const circle = addDrawing(
    createDocument('ISOMETRIC'),
    'circle',
    'view-0',
    [
      { x: 0, y: 10 },
      { x: 8, y: 10 },
    ],
    'teacher',
  );
  const destination = 'docs/evidence/cad-workspace';
  await mkdir(destination, { recursive: true });
  for (const [kind, doc, anchor, target] of [
    ['parallel', obliqueLine(), { x: -24, y: -12 }, { x: 8, y: 12.4 }],
    ['perpendicular', obliqueLine(), { x: 16, y: -15 }, { x: -2.3, y: 9 }],
    ['tangent', circle, { x: -20, y: 10 }, { x: -3, y: 17.1 }],
  ] as const) {
    // Each example has its own frozen teacher reference. Open a blank practice
    // sheet for it; importing over the previous example must protect that stem.
    await page.reload();
    await expect(svg).toBeVisible();
    const file = editor.getByLabel('加载几何 JSON');
    await file.setInputFiles({
      name: 'paper.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(doc)),
    });
    await expect(file).toHaveValue('');
    await expect(svg.locator('[data-entity-id="' + doc.entities.at(-1)!.id + '"]')).toHaveCount(1);
    await activateCommand(editor, 'segment');
    const start = await at(svg, anchor.x, anchor.y);
    // Use the given starting coordinate even when fitting the loaded paper has
    // brought a projection axis within the CSS-pixel capture radius.
    await svg.focus();
    await page.keyboard.down('Alt');
    await page.mouse.click(start.x, start.y);
    await page.keyboard.up('Alt');
    await hover(page, svg, target);
    const guide = svg.locator('[data-relation-guide="' + kind + '"]');
    await expect(guide).toHaveAttribute('data-source-id', doc.entities.at(-1)!.id);
    await expect(editor.locator('[data-entity-id]')).toHaveCount(doc.entities.length);
    await editor.screenshot({
      path: destination + '/guide-' + kind + '.png',
      animations: 'disabled',
    });
    await page.keyboard.press('Escape');
    await expect(guide).toHaveCount(0);
    await expect(editor.locator('[data-entity-id]')).toHaveCount(doc.entities.length);
  }
});

test('a tangent leaves a point on the circle, and a shorter numeric segment never claims a remote contact', async ({
  page,
}) => {
  const center = { x: 0, y: 10 };
  const circle = addDrawing(
    createDocument('ISOMETRIC'),
    'circle',
    'view-0',
    [center, { x: 8, y: 10 }],
    'teacher',
  );
  const { editor, svg } = await startDrawing(page, circle, { x: 8, y: 10 });
  const screen = await hover(page, svg, { x: 8.3, y: 22 });
  const guide = svg.locator('[data-relation-guide="tangent"]');
  await expect(guide).toBeVisible();
  await page.mouse.click(screen.x, screen.y);
  const doc = await read(page),
    line = doc.entities.at(-1)!;
  if (line.kind !== 'segment') throw Error('Expected a tangent starting at the circle');
  const start = point(doc, line.startPoint),
    end = point(doc, line.endPoint);
  expect(distance(start, center)).toBeCloseTo(8, 7);
  expect(end.x).toBeCloseTo(start.x, 7);
  await page.keyboard.press('Escape');
  await activateCommand(editor, 'segment');
  const a = await at(svg, -20, 10);
  await page.mouse.click(a.x, a.y);
  await hover(page, svg, { x: -3, y: 17.1 });
  await expect(guide).toBeVisible();
  await page.keyboard.type('5');
  await expect(guide).toHaveCount(0);
  await page.keyboard.press('Enter');
  const updated = await read(page),
    short = updated.entities.at(-1)!;
  if (short.kind !== 'segment') throw Error('Expected a short segment');
  expect(distance(point(updated, short.startPoint), point(updated, short.endPoint))).toBeCloseTo(
    5,
    8,
  );
});

test.describe('touch relation guides', () => {
  test.use({ hasTouch: true, viewport: { width: 1024, height: 768 } });
  test('touch holds a parallel preview before release, and a second finger cancels that pick', async ({
    page,
    context,
  }) => {
    const original = obliqueLine();
    const { svg } = await startDrawing(page, original, { x: -24, y: -12 }, true);
    const end = await at(svg, 8, 12.4);
    const client = await context.newCDPSession(page);
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ ...end, id: 1 }],
    });
    const guide = svg.locator('[data-relation-guide="parallel"]');
    await expect(guide).toBeVisible();
    expect((await read(page)).entities).toEqual(original.entities);
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { ...end, id: 1 },
        { x: end.x + 23, y: end.y + 15, id: 2 },
      ],
    });
    await expect(guide).toHaveCount(0);
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    expect((await read(page)).entities).toEqual(original.entities);
    await page.touchscreen.tap(end.x, end.y);
    const doc = await read(page);
    const last = doc.entities.at(-1)!;
    if (last.kind !== 'segment') throw Error('Expected a committed parallel line');
    const a = point(doc, last.startPoint),
      b = point(doc, last.endPoint);
    expect(b.y - a.y).toBeCloseTo((b.x - a.x) * 0.75, 7);
  });
});

test('an explicitly angled line releases a horizontal feature-tracking preview', async ({
  page,
}) => {
  const feature = { x: -25, y: 10 };
  const doc = addDrawing(createDocument('ISOMETRIC'), 'point', 'view-0', [feature], 'teacher');
  const { editor, svg } = await startDrawing(page, doc, { x: -10, y: -20 });
  await page.keyboard.press('F11');
  await hover(page, svg, feature);
  await expect(svg.locator('[data-transient=tracking-base]')).toHaveCount(1);
  await hover(page, svg, { x: 20, y: 10.3 });
  const track = svg.locator('[data-transient="tracking"]');
  await expect(track).toHaveCount(1);
  await page.keyboard.type('40');
  await page.keyboard.press('Tab');
  await editor.getByRole('textbox', { name: '动态角度', exact: true }).fill('10');
  await expect(track).toHaveCount(0);
  await page.keyboard.press('Enter');
  const saved = await read(page);
  const segment = saved.entities.at(-1)!;
  if (segment.kind !== 'segment') throw Error('Expected a segment');
  const a = point(saved, segment.startPoint),
    b = point(saved, segment.endPoint);
  expect(distance(a, b)).toBeCloseTo(40, 8);
  expect((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI).toBeCloseTo(10, 8);
});
