import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { setup, at, activateCommand as choose, openParameters } from './editor-fixture';

async function open(page: Page) {
  await setup(page);
  const editor = page.locator('[data-editor=a]');
  await editor.evaluate((e) => {
    e.setAttribute('style', 'width:100%;min-width:0');
    (e.nextElementSibling as HTMLElement).style.display = 'none';
  });
  return editor;
}
async function snap(page: Page, editor: Locator, name: string) {
  mkdirSync('docs/evidence/cad', { recursive: true });
  await editor.screenshot({ path: `docs/evidence/cad/${name}.png`, animations: 'disabled' });
}
const read = (p: Page) => p.evaluate(() => window.editorFixture.documents()[0]!);

test('erase, undo and redo controls use the selected object and the editor history', async ({
  page,
}) => {
  const editor = await open(page);
  const initial = await read(page);
  const target = initial.entities.find((e) => e.kind === 'segment')!;
  const midpoint = await editor
    .locator('[data-entity-id="' + target.id + '"] line')
    .first()
    .evaluate((line) => {
      const bounds = line.getBoundingClientRect();
      return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
    });
  await page.mouse.click(midpoint.x, midpoint.y);
  await choose(editor, 'erase');
  await expect
    .poll(async () => (await read(page)).entities.some((e) => e.id === target.id))
    .toBe(false);
  const erased = await read(page);
  await editor.getByRole('button', { name: '撤销', exact: true }).click();
  expect((await read(page)).entities).toEqual(initial.entities);
  await editor.getByRole('button', { name: '恢复', exact: true }).click();
  expect((await read(page)).entities).toEqual(erased.entities);
});

test('Chinese text survives JSON reload and produces real PNG and packaged downloads', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const e = await open(page),
    svg = e.locator('.geo-view svg');
  await svg.focus();
  await page.keyboard.type('t');
  const panel = await openParameters(e);
  await panel.getByLabel('文字内容').fill('剖切面 A—A');
  await panel.getByRole('textbox', { name: '精确输入' }).fill('23,32');
  await panel.getByRole('button', { name: '输入', exact: true }).click();
  const original = await read(page);
  expect(original.entities.at(-1)).toMatchObject({ kind: 'text', content: '剖切面 A—A' });
  for (const [action, name, magic] of [
    ['下载预览 PNG', 'tuheng.png', '89504e470d0a1a0a'],
    ['下载图纸包 ZIP', 'tuheng.zip', '504b0304'],
    ['导出 JSON', 'tuheng.json', ''],
  ]) {
    await e.getByRole('button', { name: '文件', exact: true }).click();
    const pending = page.waitForEvent('download');
    await e.getByRole('button', { name: action, exact: true }).click();
    const file = await pending;
    expect(file.suggestedFilename()).toBe(name);
    const bytes = readFileSync((await file.path())!);
    if (magic) expect(bytes.subarray(0, magic.length / 2).toString('hex')).toBe(magic);
    else {
      await page.evaluate(() => window.editorFixture.external());
      await e
        .locator('input[type=file]')
        .setInputFiles({ name: 'drawing.json', mimeType: 'application/json', buffer: bytes });
      await expect.poll(async () => (await read(page)).entities).toEqual(original.entities);
    }
  }
});

test('precise local input creates splines, text, annotations and ellipses; a radius grip previews and undoes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const e = await open(page),
    svg = e.locator('.geo-view svg');
  for (const [command, points, kind] of [
    ['ellipse', ['24,16', '@9,0', '24,21'], 'ellipse'],
    ['spline', ['25,12', '29,18', '34,13', '40,17'], 'curve'],
    ['text', ['12,30'], 'text'],
    ['leftDirection', ['25,30'], 'symbol'],
    ['toleranceFrame', ['40,29'], 'engineeringAnnotation'],
    ['arc3', ['20,9', '26,13', '32,9'], 'arc'],
  ] as const) {
    await choose(e, command);
    const panel = await openParameters(e);
    if (command === 'text') await panel.getByLabel('文字内容').fill('左视图');
    for (const p of points) {
      const field = panel.getByRole('textbox', { name: '精确输入' });
      await field.fill(p);
      await field.press('Enter');
    }
    if (command === 'spline') await e.getByRole('button', { name: '完成' }).click();
    expect((await read(page)).entities.at(-1)?.kind).toBe(kind);
  }
  const ellipse = (await read(page)).entities.find((o) => o.kind === 'ellipse')!;
  const center = (await read(page)).entities.find((o) => o.id === ellipse.center)!;
  expect(center.kind).toBe('point');
  // The rendered shape provides the viewport transform even on a reflected V frame.
  const element = e.locator(`[data-entity-id="${ellipse.id}"]`).first(),
    rect = await element.boundingBox();
  expect(rect).toBeTruthy();
  const click = await at(svg, -24, 21);
  await page.mouse.click(click.x, click.y);
  const grip = e.locator('circle[data-cad-grip="minor"]');
  await expect(grip).toBeVisible();
  const handle = (await grip.boundingBox())!;
  const x = handle.x + handle.width / 2,
    y = handle.y + handle.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 5, { steps: 4 });
  await page.mouse.up();
  const changed = (await read(page)).entities.find((o) => o.id === ellipse.id);
  expect(changed).not.toEqual(ellipse);
  await e.getByRole('button', { name: '撤销', exact: true }).click();
  expect((await read(page)).entities.find((o) => o.id === ellipse.id)).toEqual(ellipse);
});

test('CAD mouse previews a segment before release, first click adds nothing, completed chain shares its knot', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const e = await open(page),
    svg = e.locator('.geo-view > svg'),
    initial = await read(page);
  await choose(e, 'segment');
  const a = await at(svg, -45, 18),
    b = await at(svg, -33, 26),
    c = await at(svg, -24, 20);
  await page.mouse.click(a.x, a.y);
  expect(await read(page)).toEqual(initial);
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.down();
  await expect(e.getByLabel('动态长度')).toBeVisible();
  await snap(page, e, 'desktop-live-segment');
  await page.mouse.up();
  await page.mouse.click(c.x, c.y);
  await e.getByRole('button', { name: '完成', exact: true }).click();
  const doc = await read(page),
    lines = doc.entities.slice(initial.entities.length).filter((o) => o.kind === 'segment');
  expect(lines).toHaveLength(2);
  expect(lines[0].endPoint).toBe(lines[1].startPoint);
  await e.getByRole('button', { name: '撤销', exact: true }).click();
  expect((await read(page)).entities.filter((o) => o.kind === 'segment')).toHaveLength(3);
});

for (const [width, height] of [
  [390, 844],
  [1024, 768],
]) {
  test.describe(`CAD touch ${width}`, () => {
    test.use({ hasTouch: true, viewport: { width, height } });
    test('tap geometry, pinch between steps, confirm dimension, copy/delete and undo', async ({
      page,
      context,
    }) => {
      const e = await open(page),
        svg = e.locator('.geo-view > svg'),
        initial = await read(page);
      const tap = async (x: number, y: number) => {
        const p = await at(svg, x, y);
        await page.touchscreen.tap(p.x, p.y);
      };
      await choose(e, 'circle', true);
      await tap(-32, 22);
      const center = await at(svg, -32, 22);
      const beforeScale = await svg.evaluate((el) => (el as SVGSVGElement).getScreenCTM()!.a);
      const cdp = await context.newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [
          { x: center.x - 16, y: center.y, id: 1 },
          { x: center.x + 16, y: center.y, id: 2 },
        ],
      });
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          { x: center.x - 20, y: center.y, id: 1 },
          { x: center.x + 20, y: center.y, id: 2 },
        ],
      });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect
        .poll(() =>
          svg.evaluate(
            (el, starting) => (el as SVGSVGElement).getScreenCTM()!.a / starting,
            beforeScale,
          ),
        )
        .toBeCloseTo(1.25, 1);
      const anchored = await at(svg, -32, 22);
      expect(Math.hypot(anchored.x - center.x, anchored.y - center.y)).toBeLessThan(1.25);
      expect((await read(page)).entities).toHaveLength(initial.entities.length);
      await tap(-25, 22);
      await expect
        .poll(async () => (await read(page)).entities.filter((o) => o.kind === 'circle').length)
        .toBe(1);
      await choose(e, 'radiusDimension', true);
      await tap(-25, 22);
      await tap(-19, 27);
      await expect
        .poll(async () => (await read(page)).entities.filter((o) => o.kind === 'dimension').length)
        .toBe(1);
      await choose(e, 'rectangle', true);
      const area = (await svg.boundingBox())!;
      const left = area.x + area.width * 0.14,
        top = area.y + area.height * 0.13;
      await page.touchscreen.tap(left, top);
      await page.touchscreen.tap(left + 55, top + 50);
      await expect
        .poll(async () => (await read(page)).entities.filter((o) => o.kind === 'segment').length)
        .toBe(6);
      const edge=(await read(page)).entities.filter(o=>o.kind==='segment').at(-1)!;
      const tapEdge=async()=>{
        const rect=(await e.locator('[data-entity-id="'+edge.id+'"] > line').first().boundingBox())!;
        await page.touchscreen.tap(rect.x+rect.width/2,rect.y+rect.height/2);
      };
      await tapEdge();
      const card = e.getByRole('dialog', { name: '对象属性' });
      await expect(card).toBeVisible();
      const before = (await read(page)).entities.length;
      await snap(page, e, width === 390 ? 'phone-properties' : 'tablet-properties');
      await card.getByRole('button', { name: '复制', exact: true }).tap();
      expect((await read(page)).entities.length).toBeGreaterThan(before);
      await e.getByRole('button', { name: '撤销', exact: true }).tap();
      if (!(await card.isVisible())) await tapEdge();
      page.once('dialog', (d) => d.accept());
      await card.getByRole('button', { name: '删除', exact: true }).tap();
      expect((await read(page)).entities.length).toBeLessThan(before);
    });
  });
}
