import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { exportCadPackage, exportDocumentToDxf, loadGeometryDocument } from '@tuheng/geometry-core';
import { prepareLogin } from './identity-login';

const fixture = readFileSync('docs/geometry-examples/construction/THREE-VIEW-CONSTRUCTION.json');
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const main = (page: Page) => page.getByLabel('统一展开图绘图区');
const reference = (page: Page) => page.getByRole('complementary', { name: '参考图纸预览' });
const referenceCanvas = (page: Page) => page.getByLabel('参考图纸绘图区');
const modes = (page: Page) => page.getByRole('group', { name: '工作区模式' });

async function openEditor(page: Page) {
  const email = await prepareLogin(page, 'student', '/geometry');
  await email.fill('student@tuheng.local');
  await page.getByLabel('密码', { exact: true }).fill(process.env.SEED_PASSWORD!);
  await button(page, '登录').click();
  await expect(page).toHaveURL('/geometry');
  await expect(page.locator('.geometry-editor')).toHaveAttribute('data-workspace-ready', 'true');
}

test.use({ viewport: { width: 1440, height: 900 } });

test('讲解模块随工作区模式显示，可单独收起并保持主画布镜头', async ({ page }) => {
  await openEditor(page);
  const editor = page.locator('.geometry-editor');
  const narration = page.getByRole('complementary', { name: '分步动画面板' });
  const timeline = page.getByRole('navigation', { name: '作图步骤时间轴' });
  const solid = page.getByRole('region', { name: '立体图三维预览' });
  await page.getByLabel('加载几何 JSON', { exact: true }).setInputFiles({
    name: 'drawing.json',
    mimeType: 'application/json',
    buffer: fixture,
  });
  await expect(editor).toHaveAttribute('data-workspace-mode', 'drafting');
  for (const pane of [narration, timeline, solid]) await expect(pane).toHaveCount(0);
  await expect(button(page, '直线')).toBeVisible();
  const drawing = main(page);
  await drawing.hover();
  await page.mouse.wheel(0, -170);
  const camera = () =>
    drawing.evaluate((svg: SVGSVGElement) => {
      const box = svg.viewBox.baseVal;
      return { x: box.x + box.width / 2, y: box.y + box.height / 2, scale: svg.getScreenCTM()!.a };
    });
  const before = await camera();
  await modes(page).getByRole('button', { name: '讲解' }).click();
  await expect(editor).toHaveAttribute('data-workspace-mode', 'teaching');
  for (const pane of [narration, timeline, solid]) await expect(pane).toBeVisible();
  await expect(drawing.locator('[data-viewport-grid]')).toBeVisible();
  await expect(button(page, '直线')).toHaveCount(0);
  const after = await camera();
  expect(after.x).toBeCloseTo(before.x, 3);
  expect(after.y).toBeCloseTo(before.y, 3);
  expect(after.scale).toBeCloseTo(before.scale, 3);
  await button(page, '收起步骤讲解').click();
  await expect(narration).toHaveCount(0);
  await expect(timeline).toBeVisible();
  await button(page, '展开步骤讲解').click();
  await button(page, '收起步骤条').click();
  await expect(timeline).toHaveCount(0);
  await button(page, '收起立体图 3D').click();
  await expect(solid).toHaveCount(0);
  await button(page, '编排步骤').click();
  await expect(button(page, '直线')).toBeVisible();
  await modes(page).getByRole('button', { name: '作图' }).click();
  await expect(narration).toHaveCount(0);
  await expect(drawing.locator('[data-viewport-grid]')).toBeVisible();
});

test('参考图纸分屏、浮窗、属性、跨类型复制和撤销', async ({ page }) => {
  await openEditor(page);
  await page.getByLabel('图纸类型').selectOption('ISOMETRIC');
  const drawing = main(page);
  const referenceView = referenceCanvas(page);
  const empty = await drawing.locator('[data-entity-id]').count();
  await button(page, '文件').click();
  const chooser = page.waitForEvent('filechooser');
  await button(page, '加载参考图纸').click();
  await (
    await chooser
  ).setFiles({ name: '三视图.json', mimeType: 'application/json', buffer: fixture });
  await expect(reference(page)).toHaveAttribute('data-placement', 'docked');
  await expect(referenceView).toBeVisible();
  await expect(referenceView.locator('[data-entity-id="v-outline-1"]')).toHaveCount(1);
  const divider = page.getByRole('separator', { name: '调整参考图纸分屏宽度' });
  const split = (await divider.boundingBox())!;
  await page.mouse.move(split.x + split.width / 2, split.y + split.height / 2);
  await page.mouse.down();
  await page.mouse.move(split.x - 66, split.y + split.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(async () => Number(await divider.getAttribute('aria-valuenow')))
    .toBeGreaterThan(30);
  const mainCamera = await drawing.getAttribute('viewBox');
  await referenceView.hover();
  const referenceCamera = await referenceView.getAttribute('viewBox');
  await page.mouse.wheel(0, -145);
  await expect(referenceView).not.toHaveAttribute('viewBox', referenceCamera!);
  await expect(drawing).toHaveAttribute('viewBox', mainCamera!);
  await button(page, '适配视图').click();

  await button(page, '切为浮窗').click();
  await expect(reference(page)).toHaveAttribute('data-placement', 'floating');
  const title = reference(page).locator('.geo-reference-titlebar');
  const titleBox = (await title.boundingBox())!;
  await page.mouse.move(titleBox.x + 32, titleBox.y + titleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(titleBox.x - 95, titleBox.y + titleBox.height / 2 + 52, { steps: 6 });
  await page.mouse.up();
  expect((await title.boundingBox())!.x).toBeLessThan(titleBox.x - 75);
  const resize = (await reference(page).locator('.geo-reference-resize').boundingBox())!;
  const beforeSize = (await reference(page).boundingBox())!;
  await page.mouse.move(resize.x + 10, resize.y + 10);
  await page.mouse.down();
  await page.mouse.move(resize.x + 62, resize.y + 38, { steps: 4 });
  await page.mouse.up();
  expect((await reference(page).boundingBox())!.width).toBeGreaterThan(beforeSize.width + 40);
  await button(page, '最小化参考图纸').click();
  await expect(reference(page)).toBeHidden();
  await button(page, '参考图纸 · 点击展开').click();
  await expect(reference(page)).toHaveAttribute('data-placement', 'floating');
  await button(page, '停靠分屏').click();
  await expect(reference(page)).toHaveAttribute('data-placement', 'docked');

  const edge = referenceView.locator('[data-entity-id="v-outline-1"] > line');
  const midpoint = await edge.evaluate((line: SVGLineElement) => {
    const p = line
      .getPointAtLength(line.getTotalLength() * 0.2)
      .matrixTransform(line.getScreenCTM()!);
    return { x: p.x, y: p.y, length: line.getTotalLength() };
  });
  await page.mouse.click(midpoint.x, midpoint.y);
  await expect(referenceView.locator('[data-entity-id="v-outline-1"]')).toHaveAttribute(
    'data-selected',
    'true',
  );
  const props = reference(page).getByRole('region', { name: '参考图元属性' });
  await expect(props.getByText('起点坐标')).toBeVisible();
  await expect(props.getByText('终点坐标')).toBeVisible();
  await expect(props.getByText(midpoint.length + ' mm')).toBeVisible();
  const adjacent = await referenceView
    .locator('[data-entity-id="v-outline-4"] > line')
    .evaluate((line: SVGLineElement) => {
      const p = line
        .getPointAtLength(line.getTotalLength() * 0.4)
        .matrixTransform(line.getScreenCTM()!);
      return { x: p.x, y: p.y };
    });
  await page.keyboard.down('Shift');
  await page.mouse.click(adjacent.x, adjacent.y);
  await page.keyboard.up('Shift');
  await expect(reference(page).getByText('2 个对象')).toBeVisible();
  await modes(page).getByRole('button', { name: '讲解' }).click();
  await expect(button(page, '复制到主画框')).toBeDisabled();
  await expect(reference(page).getByText('请切回作图模式后复制')).toBeVisible();
  await modes(page).getByRole('button', { name: '作图' }).click();
  await button(page, '复制到主画框').click();
  await expect(drawing.locator('[data-entity-id]')).toHaveCount(empty + 5);
  const copied = drawing.locator('[data-kind="segment"][data-selected="true"] > line');
  await expect(copied).toHaveCount(2);
  expect(
    await copied.first().evaluate((line: SVGLineElement) => line.getTotalLength()),
  ).toBeCloseTo(midpoint.length, 5);
  await drawing.press('Control+z');
  await expect(drawing.locator('[data-entity-id]')).toHaveCount(empty);
  await drawing.press('Control+Shift+z');
  await expect(drawing.locator('[data-entity-id]')).toHaveCount(empty + 5);
  await button(page, '关闭参考图纸').click();
  await expect(reference(page)).toHaveCount(0);
  await expect(drawing.locator('[data-entity-id]')).toHaveCount(empty + 5);
});

test('窄屏参考图纸可切换、可单独加载 DXF，已加载图纸保留在导入错误后', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openEditor(page);
  await button(page, '参考图纸').click();
  await expect(reference(page)).toBeVisible();
  const input = page.getByLabel('选择参考图纸文件');
  const parsed = loadGeometryDocument(fixture.toString());
  await input.setInputFiles({
    name: '三视图.dxf',
    mimeType: 'application/dxf',
    buffer: Buffer.from(exportDocumentToDxf(parsed)),
  });
  await expect(referenceCanvas(page)).toBeVisible();
  await expect(referenceCanvas(page).locator('[data-kind="segment"]').first()).toHaveCSS(
    'stroke',
    'rgb(231, 241, 244)',
  );
  await input.setInputFiles({
    name: '坏图纸.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{'),
  });
  await expect(reference(page).getByRole('alert')).toContainText('参考图纸加载失败');
  await expect(referenceCanvas(page).locator('[data-kind="segment"]').first()).toHaveCount(1);
  const tabs = page.getByRole('group', { name: '工作区视图' });
  await tabs.getByRole('button', { name: '图纸', exact: true }).click();
  await expect(reference(page)).toBeHidden();
  await expect(main(page)).toBeVisible();
  await expect(main(page).locator('[data-entity-id]')).toHaveCount(0);
  await tabs.getByRole('button', { name: '参考图', exact: true }).click();
  await button(page, '最小化参考图纸').click();
  await expect(main(page)).toBeVisible();
  await button(page, '参考图纸 · 点击展开').click();
  await expect(referenceCanvas(page)).toBeVisible();
  await expect(main(page)).toBeHidden();
  await input.setInputFiles({
    name: '三视图.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(await (await exportCadPackage(parsed)).arrayBuffer()),
  });
  await expect(referenceCanvas(page).locator('[data-entity-id="v-outline-1"]')).toHaveCount(1);
  await button(page, '切为浮窗').click();
  const title = reference(page).locator('.geo-reference-titlebar');
  const from = (await title.boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: from.x + 18, y: from.y + 16 }],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: from.x + 18, y: from.y + 123 }],
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
  await expect.poll(async () => (await title.boundingBox())!.y).toBeGreaterThan(from.y + 65);
  const workspace = (await page.locator('.geo-workspace-content').boundingBox())!;
  const floated = (await reference(page).boundingBox())!;
  expect(floated.y + floated.height).toBeLessThan(workspace.y + workspace.height);
});
