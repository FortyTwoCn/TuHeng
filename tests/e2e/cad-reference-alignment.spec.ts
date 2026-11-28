import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import {
  addDrawing,
  createDocument,
  dimensionValue,
  distance,
  hatchStrokes,
  point,
  localToSheet,
  sheetToLocal,
} from '@tuheng/geometry-core';
import type { GeometryDocument } from '@tuheng/contracts';
import { activateCommand, at, setup } from './editor-fixture';

const v = (x: number, y: number) => ({ x, y });
const line = (d: GeometryDocument, a: ReturnType<typeof v>, b: ReturnType<typeof v>) =>
  addDrawing(d, 'segment', d.views[0].id, [a, b], 'student');

async function fixture(page: Page, source: GeometryDocument) {
  await page.setViewportSize({ width: 1366, height: 900 });
  await setup(page);
  const e = page.locator('[data-editor=a]');
  await e.evaluate((el) => {
    el.style.width = '100%';
    (el.nextElementSibling as HTMLElement).hidden = true;
  });
  const file = e.getByLabel('加载几何 JSON');
  await file.setInputFiles({
    name: 'reference-alignment.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(source)),
  });
  const read = () => page.evaluate(() => window.editorFixture.documents()[0]!);
  await expect.poll(read).toEqual(source);
  const svg = e.locator('.geo-view > svg');
  const hover = async (x: number, y: number) => {
    const p = await at(svg, x, y);
    await page.mouse.move(p.x, p.y);
    return p;
  };
  return {
    e,
    svg,
    file,
    read,
    hover,
    pick: async (x: number, y: number, button: 'left' | 'right' = 'left') => {
      const p = await hover(x, y);
      await page.mouse.click(p.x, p.y, { button });
    },
    finish: () => e.getByRole('button', { name: '完成', exact: true }).click(),
  };
}

test('acquires two independent tracking bases and commits their exact crossing to the line', async ({
  page,
}, info) => {
  let d = createDocument('ISOMETRIC');
  for (const p of [v(-35, 25), v(13, -20)])
    d = addDrawing(d, 'point', d.views[0].id, [p], 'teacher');
  const { e, svg, pick, hover, read } = await fixture(page, d);
  await activateCommand(e, 'segment');
  await page.keyboard.press('F11');
  await pick(-57, -34);
  await hover(-35, 25);
  await expect(svg.locator('[data-transient=tracking-base]')).toHaveCount(1);
  await hover(13, -20);
  await expect(svg.locator('[data-transient=tracking-base]')).toHaveCount(2);
  await hover(13.5, 25.4);
  await expect(e.locator('[data-snap-feedback=true]')).toContainText('追踪交点');
  await expect(svg.locator('[data-transient=tracking]')).toHaveCount(2);
  await e.screenshot({ path: info.outputPath('tracking-crossing.png') });
  await pick(13.5, 25.4);
  const after = await read(),
    segment = after.entities.find((e) => e.kind === 'segment')!;
  expect(point(after, segment.endPoint)).toEqual(v(13, 25));
  expect(after.entities.slice(0, d.entities.length)).toEqual(d.entities);
});

test('tracks from a V endpoint onto X and into H after committing the axis point', async ({
  page,
}) => {
  const { e, svg, pick, hover, read } = await fixture(page, createDocument('VHW_PROJECTION'));
  await activateCommand(e, 'segment');
  await page.keyboard.press('F8');
  await pick(-52, 39);
  await pick(-24, 39);
  const front = await read();
  const segment = front.entities.find((entity) => entity.kind === 'segment')!;
  expect(segment.viewId).toBe('view-0');
  const endpoint = point(front, segment.endPoint);
  expect(endpoint.y).toBe(point(front, segment.startPoint).y);
  const source = localToSheet(front, segment.viewId, endpoint);

  await activateCommand(e, 'point');
  await page.keyboard.press('F11');
  await hover(source.x, source.y);
  const base = svg.locator('[data-transient=tracking-base]');
  await expect(base).toHaveCount(1);
  const guide = svg.locator('[data-transient=tracking]');
  const onAxis = await hover(source.x + 0.7, 0.8);
  const feedback = e.locator('[data-snap-feedback=true]');
  await expect(feedback).toContainText('追踪交点 · X 轴');
  await expect(guide).toHaveCSS('visibility', 'visible');
  await expect(guide).toHaveAttribute('stroke-dasharray', /\S/);
  await expect(guide).toHaveAttribute('x1', String(source.x));
  await expect(guide).toHaveAttribute('y1', String(-source.y));
  await expect(guide).toHaveAttribute('x2', String(source.x));
  await expect(guide).toHaveAttribute('y2', '0');
  await page.mouse.click(onAxis.x, onAxis.y);
  expect((await read()).entities.at(-1)).toMatchObject({
    kind: 'point',
    viewId: 'view-0',
    position: v(endpoint.x, 0),
  });

  const inTop = await hover(source.x + 0.7, -28);
  await expect(base).toHaveCount(1);
  await expect(feedback).toContainText('垂直追踪');
  await expect(guide).toHaveCSS('visibility', 'visible');
  await expect(guide).toHaveAttribute('x1', String(source.x));
  await expect(guide).toHaveAttribute('y1', String(-source.y));
  await expect(guide).toHaveAttribute('x2', String(source.x));
  expect(Number(await guide.getAttribute('y2'))).toBeCloseTo(28, 0);
  await page.mouse.click(inTop.x, inTop.y);
  const after = await read();
  expect(after.entities.at(-1)).toMatchObject({
    kind: 'point',
    viewId: 'view-1',
    position: { x: endpoint.x, y: expect.closeTo(-28, 0) },
  });
});

for (const acquireLeft of [true, false]) {
  test(
    acquireLeft
      ? 'tracks P1 in V after picking Q2 in H and draws the aligned 50 mm segment'
      : 'copies the 50 mm length in H with only P2 retained in V',
    async ({ page }) => {
      const { e, svg, pick, hover, read } = await fixture(page, createDocument('VH_PROJECTION'));
      const p1 = v(-60, 30),
        p2 = v(-10, 30),
        q2 = v(-10, -25);
      const segments = async () => (await read()).entities.filter((s) => s.kind === 'segment');
      const grid = e.getByRole('button', { name: '网格捕捉', exact: true });
      if ((await grid.getAttribute('aria-pressed')) === 'false') await grid.click();
      await activateCommand(e, 'segment');
      await pick(p1.x, p1.y);
      await pick(p2.x, p2.y);
      await expect.poll(segments).toHaveLength(1);
      const [source] = await segments();
      const front = await read();
      expect(source.viewId).toBe('view-0');
      expect(localToSheet(front, source.viewId, point(front, source.startPoint))).toEqual(p1);
      expect(localToSheet(front, source.viewId, point(front, source.endPoint))).toEqual(p2);

      await page.keyboard.press('Space');
      if (!acquireLeft) await grid.click();
      await activateCommand(e, 'segment');
      await page.keyboard.press('F11');
      await expect(e.getByRole('button', { name: '对象捕捉追踪' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      const bases = svg.locator('[data-transient="tracking-base"]');
      const feedback = e.locator('[data-snap-feedback=true]');
      await hover(p2.x, p2.y);
      await expect(bases).toHaveCount(1);
      await expect(bases).toHaveAttribute('cx', String(p2.x));
      await expect(bases).toHaveAttribute('cy', String(-p2.y));
      const start = await hover(q2.x + 0.3, q2.y);
      await expect(feedback).toContainText('垂直追踪');
      await page.mouse.click(start.x, start.y);
      await expect(bases).toHaveCount(1);
      await expect.poll(segments).toHaveLength(1);

      if (acquireLeft) {
        await hover(p1.x, p1.y);
        await expect(feedback).toContainText('端点');
        await expect(svg.locator('[data-transient="snap-target"]')).toHaveAttribute(
          'cx',
          String(p1.x),
        );
        await page.waitForTimeout(450);
        await expect(bases).toHaveCount(2);
        await expect(bases.nth(1)).toHaveAttribute('cx', String(p1.x));
        await expect(bases.nth(1)).toHaveAttribute('cy', String(-p1.y));
      }

      const q1 = await at(svg, p1.x, q2.y);
      const end = v(q1.x + 2.4, q1.y + 1);
      await page.mouse.move(end.x, end.y, { steps: 8 });
      const equal = svg.locator('[data-equal-length-source-id]');
      await expect(equal).toHaveAttribute('data-equal-length-source-id', source.id);
      await expect(equal.locator('text')).toHaveText('等长');
      await expect(bases).toHaveCount(acquireLeft ? 2 : 1);
      if (acquireLeft) {
        const guide = svg.locator('line[data-transient="tracking"][x1="-60"][y1="-30"]');
        await expect(guide).toHaveAttribute('x2', String(p1.x));
        await expect(guide).toHaveAttribute('stroke-dasharray', /\S/);
        expect(Number(await guide.getAttribute('y2'))).toBeCloseTo(-q2.y, 1);
      }
      await page.mouse.click(end.x, end.y);
      await expect.poll(segments).toHaveLength(2);
      const [, drawn] = await segments(),
        h = await read();
      expect(drawn.viewId).toBe('view-1');
      const a = localToSheet(h, drawn.viewId, point(h, drawn.startPoint));
      const b = localToSheet(h, drawn.viewId, point(h, drawn.endPoint));
      expect(a.x).toBe(p2.x);
      expect(b.x).toBe(p1.x);
      expect(a.y).toBe(b.y);
      expect(Math.abs(distance(a, b) - 50)).toBeLessThan(1e-6);
    },
  );
}

test('Escape breaks a V chain and lets the active line tool start an independent H segment', async ({
  page,
}) => {
  const { e, svg, pick, hover, read } = await fixture(page, createDocument('VHW_PROJECTION'));
  const lineButton = e.locator('[data-command=segment]:visible');
  const selectButton = e.locator('[data-command=select]:visible');
  await activateCommand(e, 'segment');
  await pick(-52, 33);
  await pick(-24, 39);
  const first = await read();
  await hover(-16, 23);
  await expect(svg.locator('[data-transient=rubber-band]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(lineButton).toHaveAttribute('aria-pressed', 'true');
  await expect(e.getByRole('region', { name: 'CAD 命令' })).toContainText('请指定新起点');
  await expect(svg.locator('[data-transient=rubber-band]')).toHaveCount(0);
  expect(await read()).toEqual(first);

  await pick(-43, -18);
  await pick(-28, -36);
  const after = await read();
  const segments = after.entities.filter((entity) => entity.kind === 'segment');
  expect(segments.map((segment) => segment.viewId)).toEqual(['view-0', 'view-1']);
  expect(segments[0]).toEqual(first.entities.at(-1));
  expect(segments[1].startPoint).not.toBe(segments[0].endPoint);
  expect(point(after, segments[1].startPoint).y).toBeCloseTo(-18, 0);

  await page.keyboard.press('Escape');
  await expect(lineButton).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(selectButton).toHaveAttribute('aria-pressed', 'true');
  expect(await read()).toEqual(after);
});

test('uses the fixed 45-degree miter line for an exact intersection on the unfolded sheet', async ({
  page,
}) => {
  const d = createDocument('THREE_VIEW'),
    frame = d.views[0].id;
  const input = line(d, sheetToLocal(d, frame, v(22, -38)), sheetToLocal(d, frame, v(62, -38)));
  const { e, svg, pick, read } = await fixture(page, input);
  await expect(svg.locator('[data-reference-id="axis:MITER_45"]')).toBeVisible();
  await activateCommand(e, 'point');
  await pick(38.5, -38.3);
  const after = await read(),
    last = after.entities.at(-1)!;
  expect(last.kind).toBe('point');
  if (last.kind === 'point')
    expect(localToSheet(after, last.viewId, last.position)).toEqual(v(38, -38));
});

test('box-trim stays on the current boundaries and keeps each commit undoable', async ({
  page,
}, info) => {
  let d = createDocument('ISOMETRIC');
  for (const y of [6, 18, 33]) d = line(d, v(-38, y), v(38, y));
  for (const x of [-18, 18]) d = line(d, v(x, -43), v(x, 43));
  const { e, svg, pick, hover, read, finish } = await fixture(page, d);
  await activateCommand(e, 'trim');
  await pick(-18, -23);
  await pick(18, -23);
  await finish();
  await pick(-7, 0);
  await hover(7, 25);
  await expect(svg.locator('[data-transient=trim-box]')).toBeVisible();
  await e.screenshot({ path: info.outputPath('batch-trim-preview.png') });
  await pick(7, 25);
  expect(await read()).toEqual(d);
  await finish();
  const trimmed = await read();
  expect(trimmed.entities.filter((e) => e.kind === 'segment')).toHaveLength(7);
  await pick(0, 33);
  await finish();
  expect((await read()).entities.filter((e) => e.kind === 'segment')).toHaveLength(8);
  await e.getByRole('button', { name: '撤销', exact: true }).click();
  await expect.poll(read).toEqual(trimmed);
  await e.getByRole('button', { name: '撤销与恢复历史' }).click();
  await e.getByRole('button', { name: /撤销 1 步/ }).click();
  await expect.poll(read).toEqual(d);
});

test('clicks an upper curved hatch face and preserves the bounded fill in its own ZIP', async ({
  page,
}, info) => {
  let d = createDocument('ISOMETRIC');
  d = addDrawing(d, 'circle', d.views[0].id, [v(0, 0), v(36, 0)], 'student');
  d = line(d, v(-50, 0), v(50, 0));
  const { e, pick, read, finish } = await fixture(page, d);
  await activateCommand(e, 'hatch');
  await pick(5, 14);
  await finish();
  const result = await read(),
    h = result.entities.find((o) => o.kind === 'hatch')!;
  expect(h.spans?.flat()).toHaveLength(2);
  expect(hatchStrokes(result, h).every((stroke) => stroke.every((p) => p.y >= -1e-7))).toBe(true);
  await e.screenshot({ path: info.outputPath('partial-hatch.png') });
  const fileMenu = () => e.getByRole('button', { name: '文件', exact: true }).click();
  await fileMenu();
  const downloaded = page.waitForEvent('download');
  await e.getByRole('button', { name: '下载图纸包 ZIP' }).click();
  const zip = await readFile((await (await downloaded).path())!);
  await e.getByRole('button', { name: '撤销', exact: true }).click();
  await expect.poll(read).toEqual(d);
  await fileMenu();
  const chooser = page.waitForEvent('filechooser');
  await e.getByRole('button', { name: '打开 JSON 或图纸包 ZIP' }).click();
  await (await chooser).setFiles({ name: 'drawing.zip', mimeType: 'application/zip', buffer: zip });
  await expect.poll(read).toEqual(result);
});

test('two line picks measure the selected supplementary sector', async ({ page }, info) => {
  let d = createDocument('ISOMETRIC');
  d = line(d, v(-38, 8), v(42, 8));
  d = line(d, v(-22, -24), v(28, 26));
  const { e, svg, pick, read } = await fixture(page, d);
  await activateCommand(e, 'angularDimension');
  await pick(-31, 8);
  await pick(23, 21);
  await pick(-12, 22);
  const result = await read(),
    dim = result.entities.find((o) => o.kind === 'dimension')!;
  expect(dim.referenceIds).toHaveLength(2);
  expect(dimensionValue(result, dim)).toBeCloseTo(135, 8);
  await e.screenshot({ path: info.outputPath('supplementary-angle.png') });
  const label = await svg.locator('[data-kind=dimension] text').first().boundingBox();
  expect(label).not.toBeNull();
  await page.mouse.dblclick(label!.x + label!.width / 2, label!.y + label!.height / 2);
  const properties = e.getByRole('dialog', { name: '对象属性' });
  await expect(properties.getByRole('button', { name: '收起详情' })).toBeVisible();
  await properties.getByText('尺寸公差', { exact: true }).click();
  await properties.getByLabel('公差代号', { exact: true }).fill('H7');
  await properties.getByRole('button', { name: '确认属性' }).click();
  const edited = (await read()).entities.find((o) => o.kind === 'dimension')!;
  expect(edited.tolerance?.code).toBe('H7');
  expect(dimensionValue(await read(), edited)).toBeCloseTo(135, 8);
});

test('uses the arc center for both orthogonal picks and defaults to a positive sweep', async ({
  page,
}) => {
  const { e, pick, read } = await fixture(page, createDocument('ISOMETRIC'));
  await activateCommand(e, 'arc');
  await page.keyboard.press('F8');
  await page.keyboard.press('F3');
  await pick(-25, 10);
  await pick(5, 19);
  await pick(-12, -17);
  const arc = (await read()).entities.find((shape) => shape.kind === 'arc');
  expect(arc).toMatchObject({
    kind: 'arc',
    startAngle: expect.closeTo(0, 6),
    radius: expect.closeTo(30, 0),
    sweep: expect.closeTo(270, 6),
  });
});

test('right-click repeats the drawing command and jumps over two history entries', async ({
  page,
}) => {
  const d = createDocument('ISOMETRIC');
  const { e, pick, read } = await fixture(page, d);
  await activateCommand(e, 'circle');
  await pick(-35, 22);
  await pick(-19, 22);
  await pick(15, -24, 'right');
  await expect(e.locator('[data-command=circle]')).toHaveAttribute('aria-pressed', 'true');
  await pick(15, -24);
  await pick(39, -24);
  const drawn = await read();
  expect(drawn.entities.filter((o) => o.kind === 'circle')).toHaveLength(2);
  await e.getByRole('button', { name: '撤销与恢复历史' }).click();
  await e.getByRole('button', { name: /撤销 2 步/ }).click();
  await expect.poll(read).toEqual(d);
  await e.getByRole('button', { name: '撤销与恢复历史' }).click();
  await e.getByRole('button', { name: /恢复 2 步/ }).click();
  await expect.poll(read).toEqual(drawn);
});

test('a free first pick captures one contact of a common tangent between two circles', async ({
  page,
}) => {
  let d = createDocument('ISOMETRIC');
  const frame = d.views[0].id,
    a = v(-42, 1),
    b = v(31, 1),
    ra = 18,
    rb = 10;
  for (const [center, r] of [
    [a, ra],
    [b, rb],
  ] as const)
    d = addDrawing(d, 'circle', frame, [center, v(center.x + r, center.y)], 'student');
  const normal = v((ra - rb) / (b.x - a.x), Math.sqrt(1 - ((ra - rb) / (b.x - a.x)) ** 2));
  const qa = v(a.x + normal.x * ra, a.y + normal.y * ra),
    qb = v(b.x + normal.x * rb, b.y + normal.y * rb);
  const { e, pick, hover, read } = await fixture(page, d);
  await activateCommand(e, 'segment');
  await hover(qa.x - 0.3, qa.y + 0.35);
  await expect(e.locator('[data-snap-feedback=true]')).toContainText('外公切首点');
  await pick(qa.x - 0.3, qa.y + 0.35);
  await hover(qb.x + 0.2, qb.y + 0.35);
  await expect(e.locator('[data-relation-guide=tangent]')).toBeVisible();
  await expect(e.locator('[data-snap-feedback=true]')).toContainText('公切点');
  await pick(qb.x + 0.2, qb.y + 0.35);
  const saved = await read(),
    segment = saved.entities.find((e) => e.kind === 'segment')!;
  const start = point(saved, segment.startPoint),
    end = point(saved, segment.endPoint);
  expect(start.x).toBeCloseTo(qa.x, 7);
  expect(start.y).toBeCloseTo(qa.y, 7);
  expect(end.x).toBeCloseTo(qb.x, 7);
  expect(end.y).toBeCloseTo(qb.y, 7);
});

test('the pointer-side rotate field commits exact geometry by entering an angle', async ({
  page,
}) => {
  const d = line(createDocument('ISOMETRIC'), v(-25, 13), v(15, 13));
  const source = d.entities.find((e) => e.kind === 'segment')!;
  const { e, pick, hover, read } = await fixture(page, d);
  await pick(-6, 13);
  await activateCommand(e, 'rotate');
  await pick(-25, 13);
  await hover(-10, 26);
  const angle = e.getByRole('textbox', { name: '动态旋转角' });
  await expect(angle).toBeVisible();
  await angle.fill('90');
  await angle.press('Enter');
  const saved = await read();
  expect(point(saved, source.startPoint)).toEqual(v(-25, 13));
  const end = point(saved, source.endPoint);
  expect(end.x).toBeCloseTo(-25, 9);
  expect(end.y).toBeCloseTo(53, 9);
});
