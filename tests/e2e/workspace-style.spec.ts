import { expect, test, type Locator, type Page } from '@playwright/test';
import type { GeometryDocument, Vec2 } from '@tuheng/contracts';
import { addDrawing, createDocument, point } from '@tuheng/geometry-core';
import { activateCommand, at, setup } from './editor-fixture';

async function open(page: Page, doc: GeometryDocument) {
  await page.setViewportSize({ width: 1366, height: 768 });
  await setup(page);
  const editor = page.locator('[data-editor=a]');
  await editor.evaluate((el) => {
    el.style.width = '100%';
    (el.nextElementSibling as HTMLElement).hidden = true;
  });
  const input = editor.getByLabel('加载几何 JSON');
  await input.setInputFiles({
    name: 'styles.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(doc)),
  });
  await expect(input).toHaveValue('');
  return editor;
}
const read = (page: Page) => page.evaluate(() => window.editorFixture.documents()[0]!);
async function clickPoint(page: Page, svg: Locator, p: Vec2) {
  const screen = await at(svg, p.x, p.y);
  await page.mouse.click(screen.x, screen.y);
}
function controls(editor: Locator) {
  return {
    color: editor.getByLabel('绘图颜色', { exact: true }),
    pattern: editor.getByLabel('绘图线型', { exact: true }),
    width: editor.getByLabel('绘图线宽', { exact: true }),
  };
}
async function selectLine(
  page: Page,
  svg: Locator,
  doc: GeometryDocument,
  id: string,
  add = false,
) {
  const line = doc.entities.find((e) => e.id === id);
  if (line?.kind !== 'segment') throw Error('missing fixture segment');
  const a = point(doc, line.startPoint),
    b = point(doc, line.endPoint);
  let hit: Vec2 | undefined;
  // A previous selection opens an object card. Choose an uncovered point on the
  // actual line body, outside the endpoint and grip hit areas.
  for (const fraction of [0.5, 0.3, 0.7]) {
    const q = await at(svg, a.x + (b.x - a.x) * fraction, a.y + (b.y - a.y) * fraction);
    if (await svg.evaluate((s, p) => s.contains(document.elementFromPoint(p.x, p.y)), q)) {
      hit = q;
      break;
    }
  }
  expect(hit).toBeDefined();
  if (add) await page.keyboard.down('Shift');
  try {
    await page.mouse.click(hit!.x, hit!.y);
  } finally {
    if (add) await page.keyboard.up('Shift');
  }
}

test('toolbar applies all three style fields to new geometry, one object and a mixed selection without changing ownership', async ({
  page,
}) => {
  const initial = addDrawing(
    createDocument('ISOMETRIC'),
    'segment',
    'view-0',
    [
      { x: -60, y: 4 },
      { x: -26, y: 4 },
    ],
    'student',
  );
  const baseline = initial.entities.at(-1)!;
  const editor = await open(page, initial),
    svg = editor.locator('.geo-view > svg'),
    { color, pattern, width } = controls(editor);
  await expect(editor.getByRole('group', { name: '新图形的默认样式' })).toBeVisible();
  await pattern.selectOption('CENTER');
  await color.fill('#ce7145');
  await width.selectOption('0.35');
  expect(await read(page)).toEqual(initial);
  await activateCommand(editor, 'segment');
  await clickPoint(page, svg, { x: 22, y: -23 });
  await clickPoint(page, svg, { x: 60, y: -23 });
  await page.keyboard.press('Escape');
  const created = await read(page),
    fresh = created.entities.at(-1)!;
  expect(fresh).toMatchObject({
    kind: 'segment',
    appearance: { color: '#ce7145', pattern: 'CENTER', widthMm: 0.35 },
  });
  expect(created.entities.slice(0, initial.entities.length)).toEqual(initial.entities);

  await selectLine(page, svg, created, baseline.id);
  await expect(editor.getByRole('group', { name: '所选对象的样式' })).toBeVisible();
  await pattern.selectOption('PHANTOM');
  await color.fill('#355aa2');
  await width.selectOption('0.7');
  const single = await read(page);
  expect(single.entities.find((e) => e.id === baseline.id)).toMatchObject({
    appearance: { color: '#355aa2', pattern: 'PHANTOM', widthMm: 0.7 },
  });
  expect(single.entities.find((e) => e.id === fresh.id)).toEqual(fresh);
  await selectLine(page, svg, single, fresh.id, true);
  await expect(pattern).toHaveValue('mixed');
  await expect(width).toHaveValue('mixed');
  await expect(editor.getByTitle('所选颜色混合')).toBeVisible();
  await pattern.selectOption('DASHED');
  await width.selectOption('0.5');
  await color.fill('#137c65');
  const mixed = await read(page);
  for (const id of [baseline.id, fresh.id]) {
    const before = single.entities.find((e) => e.id === id)!,
      after = mixed.entities.find((e) => e.id === id)!;
    expect(after.appearance).toMatchObject({ pattern: 'DASHED', widthMm: 0.5, color: '#137c65' });
    expect(after.layerId).toBe(before.layerId);
    expect(before.lineStyle).toBe('ANSWER_VISIBLE');
    expect(after.lineStyle).toBe('ANSWER_HIDDEN');
  }
  expect(mixed.entities.filter((e) => e.kind === 'point')).toEqual(
    single.entities.filter((e) => e.kind === 'point'),
  );
  await editor.getByRole('button', { name: '撤销', exact: true }).click();
  const undone = await read(page);
  for (const id of [baseline.id, fresh.id]) {
    expect(undone.entities.find((e) => e.id === id)?.appearance?.color).toBe(
      single.entities.find((e) => e.id === id)?.appearance?.color,
    );
  }
});

test('a student cannot restyle a teacher stem or a mixed stem and student selection', async ({
  page,
}) => {
  let initial = createDocument('ISOMETRIC');
  initial = addDrawing(
    initial,
    'segment',
    'view-0',
    [
      { x: -55, y: 18 },
      { x: -16, y: 18 },
    ],
    'teacher',
  );
  const stem = initial.entities.at(-1)!;
  initial = addDrawing(
    initial,
    'segment',
    'view-0',
    [
      { x: 15, y: -18 },
      { x: 58, y: -18 },
    ],
    'student',
  );
  const answer = initial.entities.at(-1)!;
  const editor = await open(page, initial),
    svg = editor.locator('.geo-view > svg'),
    { color, pattern, width } = controls(editor);
  await selectLine(page, svg, initial, stem.id);
  for (const field of [color, pattern, width]) await expect(field).toBeDisabled();
  await selectLine(page, svg, initial, answer.id, true);
  await expect(editor.getByText('已选 2', { exact: true })).toBeVisible();
  for (const field of [color, pattern, width]) await expect(field).toBeDisabled();
  expect(await read(page)).toEqual(initial);
});

test('hidden grid still snaps to its millimetre spacing and object capture acts independently', async ({
  page,
}) => {
  const initial = addDrawing(
    createDocument('ISOMETRIC'),
    'point',
    'view-0',
    [{ x: -29, y: 19 }],
    'teacher',
  );
  const editor = await open(page, initial),
    svg = editor.locator('.geo-view > svg');
  const display = editor.getByRole('button', { name: '显示网格', exact: true }),
    grid = editor.getByRole('button', { name: '网格捕捉', exact: true }),
    objects = editor.getByRole('button', { name: '对象捕捉', exact: true });
  const drawnGrid = svg.locator('g > rect[fill^="url("]');
  await expect(drawnGrid).toHaveCount(1);
  await display.click();
  await grid.click();
  await objects.click();
  await expect(drawnGrid).toHaveCount(0);
  await expect(grid).toHaveAttribute('aria-pressed', 'true');
  await expect(objects).toHaveAttribute('aria-pressed', 'false');
  const spacing=editor.getByLabel('网格间距（mm）',{exact:true});
  await spacing.fill('10');
  await spacing.press('Enter');
  expect((await read(page)).settings.grid).toBe(10);
  await activateCommand(editor, 'point');
  await clickPoint(page, svg, { x: -30.8, y: 20.6 });
  let doc = await read(page);
  expect(doc.entities.at(-1)).toMatchObject({ kind: 'point', position: { x: -30, y: 20 } });
  expect(doc.entities[0]).toEqual(initial.entities[0]);
  await page.keyboard.press('Escape');
  await grid.click();
  await objects.click();
  await expect(drawnGrid).toHaveCount(0);
  await expect(grid).toHaveAttribute('aria-pressed', 'false');
  await expect(objects).toHaveAttribute('aria-pressed', 'true');
  await activateCommand(editor, 'segment');
  await clickPoint(page, svg, { x: -29, y: 19 });
  await clickPoint(page, svg, { x: -5, y: 32 });
  doc = await read(page);
  expect(doc.entities.at(-1)).toMatchObject({
    kind: 'segment',
    startPoint: initial.entities[0].id,
  });
  await page.keyboard.press('Escape');
  await display.click();
  await expect(drawnGrid).toHaveCount(1);
  await expect(grid).toHaveAttribute('aria-pressed', 'false');
  await expect(objects).toHaveAttribute('aria-pressed', 'true');
  expect(await read(page)).toEqual(doc);
});
