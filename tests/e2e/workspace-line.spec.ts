import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { GeometryDocument } from '@tuheng/contracts';
import { addDrawing, createDocument, distance, point } from '@tuheng/geometry-core';
import { setup, at, activateCommand } from './editor-fixture';

async function open(page: Page) {
  await setup(page);
  const editor = page.locator('[data-editor="a"]');
  await editor.evaluate((el) => {
    el.style.width = '100%';
    (el.nextElementSibling as HTMLElement).hidden = true;
  });
  await editor
    .locator('input[type=file]')
    .setInputFiles({
      name: 'line.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(createDocument('ISOMETRIC'))),
    });
  await activateCommand(editor, 'segment');
  return editor;
}
const read = (page: Page) => page.evaluate(() => window.editorFixture.documents()[0]!);
test('canvas keyboard commits a 40/20/30 mm chain with shared nodes, a world grid and a transient rubber band', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const editor = await open(page);
  const svg = editor.locator('.geo-view > svg');
  const a = await at(svg, -20, -10);
  await page.mouse.click(a.x, a.y);
  expect((await read(page)).entities).toHaveLength(0);
  const toward = await at(svg, 15, -10);
  await page.mouse.move(toward.x, toward.y);
  const rubber = editor.locator('[data-transient="rubber-band"]');
  await expect(rubber).toBeVisible();
  for (const [i, [length, degrees]] of [
    ['40', '0'],
    ['2cm', '-90'],
    ['30', '180'],
  ].entries()) {
    await page.keyboard.type(length);
    const field = editor.getByRole('textbox', { name: '动态长度' });
    await expect(field).toHaveValue(length);
    const target = await at(svg, -4 + i * 2, 9 + i * 3);
    await page.mouse.move(target.x, target.y);
    await expect(field).toHaveValue(length);
    await page.keyboard.press('Tab');
    const angle = editor.getByRole('textbox', { name: '动态角度' });
    await expect(angle).toBeFocused();
    await angle.fill(degrees);
    await expect(rubber).toHaveAttribute('x2', /./);
    expect((await read(page)).entities.filter((e) => e.kind === 'segment')).toHaveLength(i);
    await page.keyboard.press('Enter');
    await expect
      .poll(async () => (await read(page)).entities.filter((e) => e.kind === 'segment').length)
      .toBe(i + 1);
    await expect(svg).toBeFocused();
  }
  await page.keyboard.press('Escape');
  await expect(rubber).toHaveCount(0);
  const saved = await read(page);
  const segments = saved.entities.filter((e) => e.kind === 'segment');
  expect(saved.entities.filter((e) => e.kind === 'point')).toHaveLength(4);
  for (const [i, segment] of segments.entries()) {
    expect(distance(point(saved, segment.startPoint), point(saved, segment.endPoint))).toBeCloseTo(
      [40, 20, 30][i],
      9,
    );
    if (i > 0) expect(segment.startPoint).toBe(segments[i - 1].endPoint);
  }
  expect(JSON.stringify(saved)).not.toContain('rubber-band');
  for (const layer of ['minor', 'major'])
    await expect(svg.locator('[data-world-grid="' + layer + '"]')).toHaveAttribute('x', '0');
  await editor.getByRole('button', { name: '撤销', exact: true }).click();
  expect((await read(page)).entities.filter((e) => e.kind === 'segment')).toHaveLength(2);
  await editor.getByRole('button', { name: '恢复', exact: true }).click();
  expect((await read(page)).entities).toEqual(saved.entities);
  await editor.getByRole('button', { name: '文件', exact: true }).click();
  const download = page.waitForEvent('download');
  await editor.getByRole('button', { name: '导出 JSON', exact: true }).click();
  const bytes = readFileSync((await (await download).path())!);
  const drawing = GeometryDocument.parse(JSON.parse(bytes.toString('utf8')));
  expect(drawing).toEqual(saved);
  const exported = drawing.entities.filter((e) => e.kind === 'segment');
  const start = point(drawing, exported[0].startPoint);
  for (const [i, [dx, dy]] of [
    [40, 0],
    [40, -20],
    [10, -20],
  ].entries()) {
    const end = point(drawing, exported[i].endPoint);
    expect(end.x).toBeCloseTo(start.x + dx, 9);
    expect(end.y).toBeCloseTo(start.y + dy, 9);
  }
  await test
    .info()
    .attach('连续直线40-20-30mm.json', { body: bytes, contentType: 'application/json' });
  mkdirSync('test-results/workspace-line', { recursive: true });
  writeFileSync('test-results/workspace-line/continuous-line.json', bytes);
  const input = editor.locator('input[type=file]');
  await input.setInputFiles({
    name: 'empty.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(createDocument('ISOMETRIC'))),
  });
  await expect.poll(async () => (await read(page)).entities.length).toBe(0);
  await input.setInputFiles({ name: 'saved.json', mimeType: 'application/json', buffer: bytes });
  await expect.poll(() => read(page)).toEqual(drawing);
});
test('right click completes, Escape discards a typed but uncommitted segment', async ({ page }) => {
  const editor = await open(page),
    svg = editor.locator('.geo-view > svg');
  const a = await at(svg, -12, 20),
    b = await at(svg, 18, 15);
  await page.mouse.click(a.x, a.y);
  await page.mouse.click(b.x, b.y);
  const saved = await read(page);
  expect(saved.entities.filter((e) => e.kind === 'segment')).toHaveLength(1);
  await page.keyboard.type('22');
  await page.keyboard.press('Escape');
  expect((await read(page)).entities).toEqual(saved.entities);
  await expect(editor.getByRole('textbox', { name: '动态长度' })).toHaveCount(0);
  await activateCommand(editor, 'segment');
  await page.mouse.click(a.x, a.y);
  await page.mouse.click(b.x, b.y, { button: 'right' });
  await expect(editor.getByRole('textbox', { name: '动态长度' })).toHaveCount(0);
  expect((await read(page)).entities).toEqual(saved.entities);
  await activateCommand(editor, 'segment');
  await page.mouse.click(a.x, a.y);
  await page.keyboard.press('Enter');
  await expect(editor.getByRole('textbox', { name: '动态长度' })).toHaveCount(0);
  expect((await read(page)).entities).toEqual(saved.entities);
});
test('a locked length uses the orthogonal pointer direction and skips an incompatible endpoint snap', async ({
  page,
}) => {
  const editor = await open(page),
    svg = editor.locator('.geo-view > svg');
  const base = addDrawing(
    addDrawing(createDocument('ISOMETRIC'), 'point', 'view-0', [{ x: 18, y: -8 }], 'teacher'),
    'point',
    'view-0',
    [{ x: -20, y: -8 }],
    'student',
  );
  await editor
    .locator('input[type=file]')
    .setInputFiles({
      name: 'anchor.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(base)),
    });
  await expect(editor.locator('input[type=file]')).toHaveValue('');
  await editor.getByRole('button', { name: '正交', exact: true }).click();
  await activateCommand(editor, 'segment');
  const a = await at(svg, -20, -8),
    near = await at(svg, 17, -7.7);
  await page.mouse.click(a.x, a.y);
  await page.mouse.move(near.x, near.y, { steps: 8 });
  await expect(editor.locator('[data-snap-feedback]')).toContainText(/端点|重合/);
  await page.keyboard.type('25');
  await page.keyboard.press('Enter');
  const doc = await read(page),
    line = doc.entities.find((e) => e.kind === 'segment')!;
  const start = point(doc, line.startPoint),
    end = point(doc, line.endPoint);
  expect(end.y).toBeCloseTo(start.y, 9);
  expect(end.x - start.x).toBeCloseTo(25, 9);
  expect(line.endPoint).not.toBe(base.entities[0].id);
  expect(doc.entities[0]).toEqual(base.entities[0]);
});
test.describe('touch line entry', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test('touches the visible length, direction and commit controls without a hardware keyboard', async ({
    page,
  }) => {
    const editor = await open(page),
      svg = editor.locator('.geo-view > svg');
    const a = await at(svg, 2, 2);
    await page.touchscreen.tap(a.x, a.y);
    const length = editor.getByRole('textbox', { name: '动态长度' });
    await length.tap();
    await length.fill('12.5');
    await editor.getByRole('textbox', { name: '动态角度' }).fill('35');
    await editor.getByRole('button', { name: '确认本段' }).tap();
    const doc = await read(page),
      s = doc.entities.find((e) => e.kind === 'segment')!;
    expect(distance(point(doc, s.startPoint), point(doc, s.endPoint))).toBeCloseTo(12.5, 9);
    await editor.getByRole('button', { name: '完成', exact: true }).tap();
    await expect(length).toHaveCount(0);
  });
});

test('types precise measurements while dragging a segment endpoint and a circle radius, one undo each', async ({
  page,
}) => {
  const editor = await open(page),
    svg = editor.locator('.geo-view > svg');
  const empty = createDocument('ISOMETRIC');
  const original = addDrawing(
    addDrawing(
      empty,
      'segment',
      'view-0',
      [
        { x: -35, y: -20 },
        { x: -15, y: -20 },
      ],
      'student',
    ),
    'circle',
    'view-0',
    [
      { x: 18, y: 12 },
      { x: 26, y: 12 },
    ],
    'student',
  );
  await editor
    .locator('input[type=file]')
    .setInputFiles({
      name: 'grips.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(original)),
    });
  await activateCommand(editor, 'select');
  const from = await at(svg, -15, -20),
    to = await at(svg, -3, -14);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await expect(editor.getByRole('textbox', { name: '动态长度' })).toBeVisible();
  await page.keyboard.type('31.5');
  await page.mouse.up();
  expect((await read(page)).entities).toEqual(original.entities);
  await page.keyboard.press('Enter');
  const changed = await read(page),
    line = changed.entities.find((e) => e.kind === 'segment')!;
  expect(distance(point(changed, line.startPoint), point(changed, line.endPoint))).toBeCloseTo(
    31.5,
    8,
  );
  await editor.getByRole('button', { name: '撤销', exact: true }).click();
  expect((await read(page)).entities).toEqual(original.entities);
  const closeCard = editor.getByRole('button', { name: '关闭对象属性', exact: true });
  if (await closeCard.isVisible()) await closeCard.click();
  const edge = await at(svg, 18, 20);
  await page.mouse.click(edge.x, edge.y);
  const handle = svg.locator('circle[data-cad-grip="radius"]');
  await expect(handle).toBeVisible();
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 18, box.y + box.height / 2 + 10, { steps: 6 });
  await expect(editor.getByRole('textbox', { name: '动态半径' })).toBeVisible();
  await page.keyboard.type('1.5cm');
  await page.keyboard.press('Enter');
  await page.mouse.up();
  expect((await read(page)).entities.find((e) => e.kind === 'circle')?.radius).toBeCloseTo(15, 8);
  await editor.getByRole('button', { name: '撤销', exact: true }).click();
  expect((await read(page)).entities).toEqual(original.entities);
});
