import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { addDrawing, createDocument, point } from '@tuheng/geometry-core';
import { setup, at, activateCommand, openParameters } from './editor-fixture';

async function controls(page: Page) {
  await setup(page);
  const editor = page.locator('[data-editor=a]');
  await editor.evaluate((el) => {
    (el as HTMLElement).style.width = '100%';
    (el.nextElementSibling as HTMLElement).style.display = 'none';
  });
  const doc = () => page.evaluate(() => window.editorFixture.documents()[0]!);
  const load = async (d: ReturnType<typeof createDocument>) => {
    await editor.getByLabel('加载几何 JSON').setInputFiles({
      name: 'input.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(d)),
    });
    await expect.poll(doc).toEqual(d);
  };
  const command = (id: string) => activateCommand(editor, id);
  const panel = editor.getByRole('region', { name: 'CAD 命令' });
  const finish = () => panel.getByRole('button', { name: '完成', exact: true }).click();
  const input = async (value: string) => {
    const fields = await openParameters(editor);
    await fields.getByRole('textbox', { name: '精确输入' }).fill(value);
    await fields.getByRole('button', { name: '输入', exact: true }).click();
  };
  const hit = async (x: number, y: number) => {
    const svg: Locator = editor.locator('.geo-view svg').first();
    await svg.scrollIntoViewIfNeeded();
    const q = await at(svg, -x, y); // V local x increases to the left.
    await page.mouse.click(q.x, q.y);
  };
  return { editor, doc, load, command, panel, finish, input, hit };
}
test.use({ viewport: { width: 1366, height: 768 } });
test('move, copy, rotate and mirror preview and confirm with a selected line', async ({ page }) => {
  const { editor, doc, load, command, finish, input, hit } = await controls(page);
  const base = addDrawing(
    createDocument('VHW_PROJECTION'),
    'segment',
    'view-0',
    [
      { x: 12, y: 20 },
      { x: 32, y: 20 },
    ],
    'student',
  );
  const line = base.entities.find((e) => e.kind === 'segment')!;
  await load(base);
  for (const [id, values] of [
    ['move', ['12,20', '@0,5']],
    ['copy', ['12,20', '@7,5']],
    ['rotate', ['12,20', '12,40']],
    ['mirror', ['20,5', '20,35']],
  ] as const) {
    await editor.locator('.geo-view > svg').focus();
    await page.keyboard.press('Escape');
    await command(id);
    await hit(22,20);
    await finish(); // close command-first selection
    for (const v of values) await input(v);
    expect(await doc()).toEqual(base);
    await finish();
    const drawn = await doc();
    const segments = drawn.entities.filter((e) => e.kind === 'segment');
    expect(segments).toHaveLength(id === 'copy' || id === 'mirror' ? 2 : 1);
    const last = segments.at(-1)!;
    const a = point(drawn, last.startPoint),
      b = point(drawn, last.endPoint);
    if (id === 'move') {
      expect(a.y).toBe(25);
      expect(b.y).toBe(25);
    }
    if (id === 'copy') {
      expect(a).toEqual({ x: 19, y: 25 });
      expect(b).toEqual({ x: 39, y: 25 });
    }
    if (id === 'rotate') {
      expect(a.x).toBeCloseTo(12);
      expect(b.x).toBeCloseTo(12);
      expect(b.y).toBeCloseTo(40);
    }
    if (id === 'mirror') {
      expect(a.x).toBeCloseTo(28);
      expect(b.x).toBeCloseTo(8);
      expect(last.id).not.toBe(line.id);
    }
    await editor.getByRole('button', { name: '撤销', exact: true }).click();
    await expect.poll(doc).toEqual(base);
  }
});
test('extend a line onto a circular boundary, then chamfer and fillet a corner', async ({
  page,
}) => {
  const { editor, doc, load, command, finish, hit } = await controls(page);
  let d = addDrawing(
    createDocument('VHW_PROJECTION'),
    'segment',
    'view-0',
    [
      { x: 10, y: 20 },
      { x: 20, y: 20 },
    ],
    'student',
  );
  d = addDrawing(
    d,
    'circle',
    'view-0',
    [
      { x: 38, y: 20 },
      { x: 44, y: 20 },
    ],
    'student',
  );
  await load(d);
  await command('extend');
  await hit(38, 26);
  await finish();
  await hit(19, 20);
  await finish();
  const extended = await doc(),
    seg = extended.entities.find((e) => e.kind === 'segment')!;
  expect(point(extended, seg.endPoint).x).toBeCloseTo(32);
  let corner = addDrawing(
    createDocument('VHW_PROJECTION'),
    'segment',
    'view-0',
    [
      { x: 12, y: 12 },
      { x: 35, y: 12 },
    ],
    'student',
  );
  corner = addDrawing(
    corner,
    'segment',
    'view-0',
    [
      { x: 12, y: 12 },
      { x: 12, y: 32 },
    ],
    'student',
  );
  await load(corner);
  for (const id of ['chamfer', 'fillet']) {
    await command(id);
    await hit(23, 12);
    await hit(12, 22);
    expect(await doc()).toEqual(corner);
    await finish();
    const drawn = await doc(),
      e = drawn.entities.at(-1)!;
    expect(e.kind).toBe(id === 'chamfer' ? 'segment' : 'arc');
    if (e.kind === 'arc') expect(e.radius).toBeCloseTo(10, 1);
    await editor.getByRole('button', { name: '撤销', exact: true }).click();
    await expect.poll(doc).toEqual(corner);
  }
});
