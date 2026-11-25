import { expect, test, type Locator, type Page } from '@playwright/test';

import { readFile, mkdir } from 'node:fs/promises';
import { GeometryDocument, type GeometryDocument as Drawing } from '@tuheng/contracts';
import { dimensionValue } from '@tuheng/geometry-core';
import { setup, at, activateCommand, openParameters } from './editor-fixture';

const read = (page: Page) => page.evaluate(() => window.editorFixture.documents()[0]!);
async function editor(page: Page) {
  await page.setViewportSize({ width: 1366, height: 900 });
  await setup(page);
  const e = page.locator('[data-editor=a]');
  await e.evaluate((el) => {
    (el as HTMLElement).style.width = '100%';
    (el.nextElementSibling as HTMLElement).hidden = true;
  });
  return e;
}
async function begin(e: Locator, id: string) {
  await activateCommand(e, id);
  if (id !== 'clear') await openParameters(e);
  return e;
}
async function coords(panel: Locator, ...points: string[]) {
  for (const xy of points) {
    await openParameters(panel);
    await panel.getByRole('textbox', { name: '精确输入' }).fill(xy);
    await panel.getByRole('button', { name: '输入', exact: true }).click();
  }
}
async function file(e: Locator, action: string) {
  const button = e.getByRole('button', { name: action, exact: true });
  if (!(await button.isVisible()))
    await e.getByRole('button', { name: '文件', exact: true }).click();
  await button.click();
}
async function exportFile(page: Page, e: Locator, action: string) {
  const pending = page.waitForEvent('download');
  await file(e, action);
  const downloaded = await pending;
  return {
    name: downloaded.suggestedFilename(),
    bytes: await readFile((await downloaded.path())!),
  };
}
async function roundtrip(page: Page, e: Locator) {
  const before = await read(page),
    exported = await exportFile(page, e, '导出 JSON');
  const expected = GeometryDocument.parse(JSON.parse(exported.bytes.toString('utf8')));
  expect(expected.entities).toEqual(before.entities);
  await page.reload();
  await expect
    .poll(async () => (await read(page)).entities.length)
    .toBeLessThan(expected.entities.length);
  const chooser = page.waitForEvent('filechooser');
  await file(e, '打开 JSON 或图纸包 ZIP');
  await (
    await chooser
  ).setFiles({ name: 'roundtrip.json', mimeType: 'application/json', buffer: exported.bytes });
  await expect.poll(() => read(page)).toEqual(expected);
  return expected;
}
async function screenshot(e: Locator, name: string) {
  const focus = await at(e.locator('.geo-view svg'), -29, 23);
  await e.page().mouse.move(focus.x, focus.y);
  for (let i = 0; i < 4; i++) await e.page().mouse.wheel(0, -110);
  await e
    .page()
    .evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
  await mkdir('docs/evidence/cad', { recursive: true });
  await e.screenshot({ path: `docs/evidence/cad/${name}.png`, animations: 'disabled' });
}

test('five associated dimensions use measured geometry across save and reload', async ({
  page,
}) => {
  const e = await editor(page),
    svg = e.locator('.geo-view svg');
  await (await begin(e, 'clear')).getByRole('button', { name: '完成', exact: true }).click();
  await coords(await begin(e, 'circle'), '42,11', '47,11');
  for (const [id, points] of [
    ['linearDimension', ['8,20', '14,28', '17,21']],
    ['alignedDimension', ['20,14', '26,22', '23,27']],
    ['angularDimension', ['32,30', '42,30', '32,41', '40,36']],
  ] as const) {
    const p = await begin(e, id);
    if (id === 'alignedDimension')
      await p.getByLabel('显示文字（空白使用实测值）').fill('校核尺寸');
    await coords(p, ...points);
  }
  for (const [id, label] of [
    ['radiusDimension', '49,17'],
    ['diameterDimension', '38,6'],
  ]) {
    const panel = await begin(e, id);
    if ((await panel.locator('.cad-step-message').innerText()).includes('选择被标注')) {
      const pt = await at(svg, -47, 11);
      await page.mouse.click(pt.x, pt.y);
    }
    await expect(panel).toContainText(id === 'radiusDimension' ? '定位半径标注' : '定位直径标注');
    await coords(panel, label);
  }
  const doc = await read(page);
  const dimensions = doc.entities.filter((e) => e.kind === 'dimension');
  expect(dimensions.map((e) => e.dimensionType)).toEqual([
    'LINEAR',
    'ALIGNED',
    'ANGULAR',
    'RADIUS',
    'DIAMETER',
  ]);
  expect(dimensions.map((e) => dimensionValue(doc, e))).toEqual([8, 10, 90, 5, 10]);
  expect(dimensions[1].textOverride).toBe('校核尺寸');
  await screenshot(e, 'five-dimensions');
  await roundtrip(page, e);
});

test('engineering annotation fields and three direction symbols persist with their graphical expressions', async ({
  page,
}) => {
  const e = await editor(page);
  await (await begin(e, 'clear')).getByRole('button', { name: '完成', exact: true }).click();
  for (const [id, point] of [
    ['datum', '50,38'],
    ['roughness', '24,38'],
    ['toleranceFrame', '56,22'],
    ['toleranceText', '20,22'],
    ['direction', '14,8'],
    ['leftDirection', '32,8'],
    ['rightDirection', '50,8'],
  ]) {
    const panel = await begin(e, id);
    if (id === 'datum') await panel.getByLabel('基准代号').fill('B');
    if (id === 'roughness') await panel.getByLabel('加工要求').selectOption('不去除材料');
    if (id === 'toleranceText') {
      await panel.getByLabel('上偏差').fill('');
      await panel.getByLabel('下偏差').fill('−0.15');
    }
    await coords(panel, point, ...(id==='direction' ? ['20,9'] : []));
  }
  const doc = await read(page),
    annotations = doc.entities.filter((o) => o.kind === 'engineeringAnnotation');
  expect(annotations.map((o) => o.annotationType)).toEqual([
    'DATUM',
    'ROUGHNESS',
    'GEOMETRIC_TOLERANCE',
    'TOLERANCE_TEXT',
  ]);
  expect(annotations[3].fields).toEqual(['10', '', '−0.15']);
  expect(annotations[1].roughnessMode).toBe('REMOVAL_PROHIBITED');
  for (const a of annotations)
    await expect(e.locator(`[data-entity-id="${a.id}"] text`).first()).toBeVisible();
  const cells = e.locator(`[data-entity-id="${annotations[2].id}"] text`);
  const displayX = await cells.evaluateAll((nodes) =>
    nodes.map((n) => n.getBoundingClientRect().left),
  );
  expect(displayX).toEqual([...displayX].sort((a, b) => a - b));
  expect(doc.entities.filter((o) => o.kind === 'symbol').map((s) => s.symbolType)).toEqual([
    'DIRECTION',
    'LEFT_ROTATION',
    'RIGHT_ROTATION',
  ]);
  await screenshot(e, 'engineering-annotations');
  await roundtrip(page, e);
});

test('compass measures an opening, transfers it to two distinct centers and undoes one arc at a time', async ({
  page,
}) => {
  const e = await editor(page),
    p = await begin(e, 'compass');
  await coords(p, '14,12', '17,16');
  await expect(p.getByLabel('开度 mm')).toHaveValue('5');
  for (const points of [
    ['22,24', '27,24', '22,29'],
    ['37,24', '42,24', '37,29'],
  ]) {
    await coords(p, ...points);
    await p.getByRole('button', { name: '完成', exact: true }).click();
  }
  const arcs = (d: Drawing) => d.entities.filter((o) => o.kind === 'arc');
  const full = await read(page);
  expect(arcs(full).map((a) => a.radius)).toEqual([5, 5]);
  expect(arcs(full)[0].center).not.toBe(arcs(full)[1].center);
  await p.getByRole('button', { name: '取消', exact: true }).click();
  await e.getByRole('button', { name: '撤销', exact: true }).click();
  expect(arcs(await read(page))).toHaveLength(1);
  await e.getByRole('button', { name: '恢复', exact: true }).click();
  expect(arcs(await read(page))).toEqual(arcs(full));
  await roundtrip(page, e);
});

test('invalid hatch spacing keeps the preview and document recoverable until confirmation', async ({
  page,
}) => {
  const e = await editor(page);
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  await (await begin(e, 'clear')).getByRole('button', { name: '完成', exact: true }).click();
  await coords(await begin(e, 'circle'), '32,20', '42,20');
  const before = await read(page);
  const p = await begin(e, 'hatch');
  await p.getByLabel('图纸间距 mm').fill('0.001');
  await coords(p, '33,21');
  await expect(e.locator('svg [data-kind="hatch"] text')).toContainText('剖面间距');
  await p.getByRole('button', { name: '完成', exact: true }).click();
  expect(await read(page)).toEqual(before);
  await openParameters(p);
  await p.getByLabel('图纸间距 mm').fill('2');
  await p.getByRole('button', { name: '完成', exact: true }).click();
  const saved = (await read(page)).entities.find((o) => o.kind === 'hatch');
  expect(saved).toMatchObject({
    spacing: 2,
    loops: [[before.entities.find((o) => o.kind === 'circle')!.id]],
  });
  expect(failures).toEqual([]);
});
