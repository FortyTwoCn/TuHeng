import { expect, test, type Locator, type Page } from '@playwright/test';
import type { GeometryDocument, Vec2 } from '@tuheng/contracts';
import {
  add,
  addDrawing,
  angle,
  createDocument,
  cross,
  distance,
  dot,
  localToSheet,
  point,
  scale,
  sub,
} from '@tuheng/geometry-core';
import { activateCommand, at, setup } from './editor-fixture';

const v = (x: number, y: number) => ({ x, y });
const view = 'view-0';
const read = (page: Page) => page.evaluate(() => window.editorFixture.documents()[0]!);
const segments = (doc: GeometryDocument) => doc.entities.filter((e) => e.kind === 'segment');

async function open(page: Page, initial = createDocument('VHW_PROJECTION')) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setup(page);
  const editor = page.locator('[data-editor="a"]');
  await editor.evaluate((el) => {
    el.style.width = '100%';
    (el.nextElementSibling as HTMLElement).hidden = true;
  });
  await editor.getByLabel('加载几何 JSON', { exact: true }).setInputFiles({
    name: 'front.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(initial)),
  });
  await expect.poll(() => read(page)).toEqual(initial);
  await expect(editor.getByRole('button', { name: '对象捕捉追踪' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  return { editor, svg: editor.locator('.geo-view > svg') };
}

async function screen(svg: Locator, doc: GeometryDocument, position: Vec2) {
  const p = localToSheet(doc, view, position);
  return at(svg, p.x, p.y);
}

async function clickAt(page: Page, svg: Locator, doc: GeometryDocument, position: Vec2) {
  const p = await screen(svg, doc, position);
  await page.mouse.move(p.x, p.y);
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.mouse.click(p.x, p.y);
}

async function hoverNear(page: Page, svg: Locator, doc: GeometryDocument, position: Vec2) {
  const p = add(await screen(svg, doc, position), v(2.4, 1));
  await page.mouse.move(p.x, p.y, { steps: 4 });
  return p;
}

test('the default front view draws exactly -90° to X with a pointer offset of 2.6 CSS pixels', async ({
  page,
}) => {
  const { editor, svg } = await open(page);
  await activateCommand(editor, 'segment');
  const empty = await read(page);
  await clickAt(page, svg, empty, v(65, 36));
  await clickAt(page, svg, empty, v(20, 36));
  await expect.poll(async () => segments(await read(page)).length).toBe(1);
  const base = await read(page);
  const start = point(base, segments(base)[0].endPoint);
  const target = await hoverNear(page, svg, base, v(start.x, 0));
  await expect(editor.locator('[data-snap-feedback=true]')).toContainText('吸附：垂直 ∩ X 轴');
  await expect(svg.locator('[data-relation-guide="perpendicular"]')).toBeVisible();
  await expect(editor.getByRole('textbox', { name: '动态角度' })).toHaveValue(/^-90(?:\.0)?$/);
  await page.mouse.click(target.x, target.y);
  await expect.poll(async () => segments(await read(page)).length).toBe(2);
  const doc = await read(page),
    line = segments(doc)[1];
  const a = point(doc, line.startPoint),
    b = point(doc, line.endPoint);
  expect(a.x).toBe(b.x);
  expect(b.y).toBe(0);
  expect(angle(sub(b, a))).toBe(-90);
  expect(doc.referenceRelations).toContainEqual(
    expect.objectContaining({
      targetId: line.endPoint,
      reference: { kind: 'baseAxis', axisId: 'X' },
    }),
  );
});

test('an oblique segment normal meets X at its exact mathematical intersection', async ({
  page,
}) => {
  const { editor, svg } = await open(page);
  await activateCommand(editor, 'segment');
  const empty = await read(page);
  await clickAt(page, svg, empty, v(19, 26));
  await clickAt(page, svg, empty, v(37, 38));
  await expect.poll(async () => segments(await read(page)).length).toBe(1);
  const base = await read(page),
    original = segments(base)[0];
  const a = point(base, original.startPoint),
    b = point(base, original.endPoint);
  const direction = sub(b, a);
  const end = v(b.x + (direction.y * b.y) / direction.x, 0);
  const target = await hoverNear(page, svg, base, end);
  await expect(svg.locator('[data-relation-guide="perpendicular"]')).toHaveAttribute(
    'data-source-id',
    original.id,
  );
  await expect(editor.locator('[data-snap-feedback=true]')).toContainText('吸附：垂直 ∩ X 轴');
  await page.mouse.click(target.x, target.y);
  await expect.poll(async () => segments(await read(page)).length).toBe(2);
  const doc = await read(page),
    line = segments(doc)[1],
    final = point(doc, line.endPoint);
  expect(Math.abs(dot(sub(final, b), direction))).toBeLessThan(1e-8);
  expect(distance(final, end)).toBeLessThan(1e-8);
});

for (const command of ['point', 'segment', 'line']) {
  test(`${command} immediately captures both extensions with two dashed guides`, async ({
    page,
  }) => {
    const { editor, svg } = await open(page);
    await activateCommand(editor, 'segment');
    const empty = await read(page);
    await clickAt(page, svg, empty, v(14, 10));
    await clickAt(page, svg, empty, v(26, 16));
    await expect.poll(async () => segments(await read(page)).length).toBe(1);
    await page.keyboard.press('Escape');
    await expect(editor.getByRole('textbox', { name: '动态角度' })).toHaveCount(0);
    const start = await screen(svg, empty, v(66, 12));
    const end = await screen(svg, empty, v(53, 24));
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => segments(await read(page)).length).toBe(2);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await activateCommand(editor, command);
    const doc = await read(page);
    const [first, second] = segments(doc);
    const a = point(doc, first.startPoint),
      b = point(doc, first.endPoint);
    const c = point(doc, second.startPoint),
      d = point(doc, second.endPoint);
    const u = sub(b, a),
      w = sub(d, c);
    const intersection = add(a, scale(u, cross(sub(c, a), w) / cross(u, w)));
    const target = await hoverNear(page, svg, doc, intersection);
    const tracks = svg.locator('line[data-transient="tracking"]');
    await expect(tracks).toHaveCount(2);
    await expect(editor.locator('[data-snap-feedback=true]')).toContainText('吸附：延长线交点');
    const sources = await tracks.evaluateAll((nodes) =>
      nodes.map((node) => Number(node.getAttribute('x1'))),
    );
    expect(sources).toEqual([localToSheet(doc, view, b).x, localToSheet(doc, view, d).x]);
    await page.mouse.click(target.x, target.y);
    if (command !== 'point') await clickAt(page, svg, doc, v(67, 48));
    await expect
      .poll(async () => (await read(page)).entities.length)
      .toBeGreaterThan(doc.entities.length);
    const saved = await read(page),
      last = saved.entities.at(-1)!;
    const final =
      last.kind === 'point'
        ? last.position
        : last.kind === 'line'
          ? last.anchor
          : last.kind === 'segment'
            ? point(saved, last.startPoint)
            : undefined;
    expect(final).toBeDefined();
    expect(distance(final!, intersection)).toBeLessThan(1e-8);
  });
}

test('dragging a selected segment endpoint shows the normal and retains the axis placement', async ({
  page,
}) => {
  const fixed = v(22, 36),
    moving = v(29, 12);
  const reference = addDrawing(
    createDocument('VHW_PROJECTION'),
    'segment',
    view,
    [v(12, 36), v(56, 36)],
    'student',
  );
  const doc = addDrawing(reference, 'segment', view, [fixed, moving], 'student');
  const { editor, svg } = await open(page, doc);
  await clickAt(page, svg, doc, scale(add(fixed, moving), 0.5));
  const begin = await screen(svg, doc, moving);
  await page.mouse.move(begin.x, begin.y);
  await page.mouse.down();
  await hoverNear(page, svg, doc, v(fixed.x, 0));
  await expect(svg.locator('[data-relation-guide="perpendicular"]')).toBeVisible();
  await expect(svg.locator('line[data-transient="tracking"]')).toHaveCount(1);
  await expect(editor.locator('[data-snap-feedback=true]')).toContainText('吸附：垂直 ∩ X 轴');
  await page.mouse.up();
  const segment = segments(doc)[1];
  await expect.poll(async () => point(await read(page), segment.endPoint)).toEqual(v(fixed.x, 0));
  const saved = await read(page);
  expect(point(saved, segment.startPoint)).toEqual(fixed);
  expect(saved.referenceRelations).toContainEqual(
    expect.objectContaining({
      targetId: segment.endPoint,
      reference: { kind: 'baseAxis', axisId: 'X' },
    }),
  );
});
