import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import sharp from 'sharp';
import { loadGeometryDocument, serializeGeometryDocument } from '@tuheng/geometry-core';
import { prepareLogin } from './identity-login';
import { choose, closePanels } from './editor-controls';
import { at } from './editor-fixture';

const base = 'docs/geometry-examples/construction/THREE-VIEW-CONSTRUCTION';
const read = (suffix: string) => readFileSync(base + suffix, 'utf8');
const canvas = (page: Page) => page.getByLabel('统一展开图绘图区');
const panel = (page: Page) => page.getByRole('complementary', { name: '分步动画面板' });
const button = (scope: Page | Locator, name: string) =>
  scope.getByRole('button', { name, exact: true });
test.use({ viewport: { width: 1440, height: 900 } });

async function openEditor(page: Page) {
  const email = await prepareLogin(page, 'student', '/geometry');
  await email.fill('student@tuheng.local');
  await page.getByLabel('密码', { exact: true }).fill(process.env.SEED_PASSWORD!);
  await button(page, '登录').click();
  await expect(page).toHaveURL('/geometry');
  await expect(page.locator('.geometry-editor')).toHaveAttribute('data-workspace-ready', 'true');
  await button(page, '切换浅色画布').click();
}

async function load(page: Page, text = read('.json'), animation = false) {
  await page
    .getByLabel(animation ? '加载动画 JSON' : '加载几何 JSON', { exact: true })
    .setInputFiles({
      name: animation ? 'lesson.animation.json' : 'drawing.json',
      mimeType: 'application/json',
      buffer: Buffer.from(text),
    });
}

async function download(page: Page, action: () => Promise<void>) {
  const pending = page.waitForEvent('download');
  await action();
  const file = await pending;
  return { name: file.suggestedFilename(), text: readFileSync(await file.path(), 'utf8') };
}

async function shot(page: Page, info: TestInfo, name: string) {
  const directory = process.env.CAD_ANIMATION_EVIDENCE;
  if (directory) mkdirSync(directory, { recursive: true });
  await page.locator('.geometry-editor').screenshot({
    path: directory ? resolve(directory, name + '.png') : info.outputPath(name + '.png'),
    animations: 'allow',
    scale: 'css',
  });
}

async function freeze(view: Locator, time: number) {
  await view.locator('[data-construction-play-key]').evaluate((element, timeMs) => {
    for (const animation of element.getAnimations({ subtree: true })) {
      animation.pause();
      animation.currentTime = timeMs;
    }
  }, time);
}

async function sampleGuide(view: Locator, guide: Locator, fraction: number) {
  const samples = await guide.evaluate((node, progress) => {
    const line = node as SVGGeometryElement;
    const trace = line.parentElement!.querySelector('.geo-ink-trace')!;
    const animation = trace.getAnimations()[0];
    animation.pause();
    const timing = animation.effect!.getTiming();
    animation.currentTime = timing.delay! + Number(timing.duration) * progress;
    const box = line.closest('svg')!.getBoundingClientRect();
    const length = line.getTotalLength();
    const locations = [0.1, 0.8].map((offset) => {
      const point = line.getPointAtLength(length * offset).matrixTransform(line.getScreenCTM()!);
      return { x: Math.round(point.x - box.left), y: Math.round(point.y - box.top) };
    });
    return { locations, length, dash: parseFloat(getComputedStyle(trace).strokeDashoffset) };
  }, fraction);
  const { data, info } = await sharp(await view.screenshot({ scale: 'css', animations: 'allow' }))
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const blue = samples.locations.map(({ x, y }) => {
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const i = ((y + dy) * info.width + x + dx) * info.channels;
        if (data[i + 2] > data[i] + 60 && data[i + 1] > data[i] + 35) return true;
      }
    return false;
  });
  return { blue, dash: samples.dash, length: samples.length };
}

test('逐笔蓝线和红线、阶段跳转、暂停、擦除与加深的浏览器证据', async ({ page }, info) => {
  await openEditor(page);
  await load(page);
  const view = canvas(page);
  await expect(view.locator('[data-entity-id="v-outline-1"]')).toHaveCount(1);
  const grid = view.locator('[data-viewport-grid]');
  const minor = view.locator('[data-world-grid="minor"]');
  await expect(grid).toBeVisible();
  await expect(minor).toHaveAttribute('width', '5');
  await button(page, '讲解').click();
  await expect(grid).toBeVisible();
  await expect(minor).toHaveAttribute('width', '5');
  await expect(view.locator('[data-reference-id="axis:X"]')).toBeVisible();
  await button(page, '显示网格').click();
  await expect(grid).toHaveCount(0);
  await button(page, '显示网格').click();
  await expect(grid).toBeVisible();
  const controls = panel(page);
  const clock = view.locator('[data-construction-play-key]');
  const shape = (id: string) => view.locator(`[data-entity-id="${id}"]`);
  await expect(button(controls, '上一步')).toBeDisabled();
  await expect(shape('v-center-1')).toHaveAttribute('data-construction-role', 'ACTIVE_CONSTRUCT');
  await expect(shape('v-outline-1')).toHaveCount(0);
  await freeze(view, 950);
  await shot(page, info, '01-centerlines');

  await button(controls, '下一步').click();
  await expect(shape('v-center-1')).toHaveAttribute('data-construction-role', 'COMPLETED_DRAFT');
  await expect(shape('v-center-1')).toHaveCSS('stroke', 'rgb(162, 174, 185)');
  await expect(shape('v-outline-1')).toHaveCSS('stroke', 'rgb(212, 43, 59)');
  const guide = view.locator('[data-temporary-guide="front:right-edge"] > line');
  await expect(guide).toHaveCSS('stroke', 'rgb(8, 121, 204)');
  await expect(
    view.locator('[data-temporary-guide="front:right-edge"] .geo-ink-trace'),
  ).toHaveAttribute('pathLength', '1');
  const early = await sampleGuide(view, guide, 0.23);
  const late = await sampleGuide(view, guide, 0.91);
  expect(early.length).toBeGreaterThan(90);
  expect(early.dash).toBeGreaterThan(late.dash);
  expect(early.blue).toEqual([true, false]);
  expect(late.blue).toEqual([true, true]);
  const delay = (id: string) =>
    shape(id)
      .locator('.geo-ink-trace')
      .evaluate((e) => parseFloat(getComputedStyle(e).animationDelay));
  expect(await delay('v-outline-1')).toBeLessThan(await delay('v-outline-4'));
  expect(await delay('v-outline-1')).toBeGreaterThanOrEqual(0.83);
  const before = await clock.getAttribute('data-construction-play-key');
  await button(controls, '重新播放本步动画').click();
  await expect(clock).not.toHaveAttribute('data-construction-play-key', before!);
  await freeze(view, 1510);
  await expect(view.locator('[data-focus-kind="SPECIAL"]')).toHaveCount(1);
  await shot(page, info, '02-projection-and-strokes');

  await button(controls, '作图线').click();
  await expect(guide).toHaveCount(0);
  await expect(shape('v-overrun-1')).toHaveCount(0);
  await expect(shape('v-center-1')).toHaveCount(1);
  await button(controls, '作图线').click();
  await button(controls, '上一步').click();
  await expect(controls.getByRole('heading', { name: '确定孔中心和基准' })).toBeVisible();
  await controls.getByLabel('播放速度').selectOption('fast');
  await button(controls, '自动播放').click();
  await button(controls, '暂停').click();
  await expect(clock).toHaveAttribute('data-construction-paused', 'true');
  await button(controls, '自动播放').click();
  await expect(controls.getByRole('heading', { name: '定位并描画主视图' })).toBeVisible();
  await button(controls, '暂停').click();

  const timeline = page.getByRole('navigation', { name: '作图步骤时间轴' });
  await button(timeline, '第 5 步').click();
  await expect(button(timeline, '第 5 步')).toHaveAttribute('aria-current', 'step');
  await expect(shape('v-overrun-1')).toHaveAttribute('data-construction-role', 'ERASING');
  await expect(shape('v-overrun-1')).toHaveCSS('stroke-dasharray', '1px, 5px');
  await shot(page, info, '03-erasing');
  await controls.getByLabel('选择作图步骤').selectOption('5');
  await expect(button(controls, '下一步')).toBeDisabled();
  await expect(shape('v-overrun-1')).toHaveCount(0);
  await expect(view.locator('[data-temporary-guide]')).toHaveCount(0);
  await expect(shape('v-outline-1')).toHaveAttribute('data-construction-role', 'DEEPENED');
  await expect(shape('v-outline-1')).toHaveCSS('stroke', 'rgb(20, 34, 48)');
  await expect(shape('v-hole-35-1')).toHaveCSS('stroke-dasharray', '7px, 4px');
  await expect(shape('v-center-1')).toHaveCSS('stroke-dasharray', '12px, 3px, 2px, 3px');
  await shot(page, info, '04-deepened');
  await view.press('Delete');
  await button(page, '作图').click();
  await expect(shape('v-overrun-1')).toHaveCount(1);
});

test('动画 JSON 独立往返、错误定位和编排保存回写完整图纸', async ({ page }) => {
  await openEditor(page);
  await load(page);
  await expect(canvas(page).locator('[data-entity-id="v-outline-1"]')).toHaveCount(1);
  const schema = await download(page, () => choose(page, '下载动画 JSON Schema'));
  expect(JSON.parse(schema.text).properties.schemaVersion.const).toBe(
    'tuheng.construction-animation/1.0.0',
  );
  await closePanels(page);
  await button(page, '讲解').click();
  const controls = panel(page);
  await controls.getByText('动画 JSON', { exact: true }).click();
  const animation = await download(page, () => button(controls, '导出动画 JSON').click());
  expect(animation.name).toBe('tuheng.animation.json');
  expect(JSON.parse(animation.text)).toEqual(JSON.parse(read('.animation.json')));
  await button(controls, '编排步骤').click();
  await button(controls, '清除已保存动画').click();
  const cleared = await download(page, () => choose(page, '导出 JSON'));
  expect(loadGeometryDocument(cleared.text).constructionAnimation).toBeUndefined();
  await closePanels(page);
  const upload = page.waitForEvent('filechooser');
  await choose(page, '导入动画 JSON');
  await (
    await upload
  ).setFiles({
    name: 'lesson.animation.json',
    mimeType: 'application/json',
    buffer: Buffer.from(animation.text),
  });
  await expect(controls.getByRole('heading', { name: '确定孔中心和基准' })).toBeVisible();
  await closePanels(page);
  const restored = await download(page, () => choose(page, '导出 JSON'));
  expect(loadGeometryDocument(restored.text)).toEqual(loadGeometryDocument(read('.json')));
  await closePanels(page);
  const broken = JSON.parse(animation.text);
  broken.steps[1].entityIds[0] = 'missing-boundary';
  await load(page, JSON.stringify(broken), true);
  const diagnostic = page.getByRole('alert').filter({ hasText: '$.steps[1].entityIds[0]' });
  await expect(diagnostic).toContainText('图纸实体「missing-boundary」不存在');
  await button(diagnostic, '关闭').click();
  const still = await download(page, () => choose(page, '导出 JSON'));
  expect(loadGeometryDocument(still.text)).toEqual(loadGeometryDocument(restored.text));
  await closePanels(page);
  await button(controls, '编排步骤').click();
  await button(controls, '新增阶段').click();
  await controls.getByLabel('阶段名称').fill('补充观察');
  await button(controls, '新增步骤').click();
  await controls.getByLabel('步骤标题').fill('比较相邻棱边');
  await controls.getByLabel('步骤讲解').fill('通过已选侧边检查对正关系。');
  const selected = await at(canvas(page), -16, 33);
  await page.mouse.click(selected.x, selected.y);
  await expect(button(controls, '绑定主体（0）')).toBeEnabled();
  await button(controls, '绑定主体（0）').click();
  await button(controls, '步骤上移').click();
  await button(controls, '保存动画编排').click();
  const saved = loadGeometryDocument((await download(page, () => choose(page, '导出 JSON'))).text);
  expect(saved.constructionAnimation?.phases.at(-1)?.title).toBe('补充观察');
  expect(saved.constructionAnimation?.steps[5]).toMatchObject({
    title: '比较相邻棱边',
    narration: '通过已选侧边检查对正关系。',
    entityIds: ['v-outline-4'],
  });
  expect(saved.entities).toEqual(loadGeometryDocument(read('.json')).entities);
});

test('审核定位错位，生成真实三维实体并在两种布局联动', async ({ page }, info) => {
  await openEditor(page);
  const incorrect = loadGeometryDocument(read('.json'));
  for (const entity of incorrect.entities)
    if (entity.kind === 'point' && entity.viewId === 'view-1') entity.position.x += 7;
  await load(page, serializeGeometryDocument(incorrect));
  await expect(canvas(page).locator('[data-entity-id="h-outline-1"]')).toHaveCount(1);
  await button(page, '格式审核').click();
  const audit = page.getByRole('complementary', { name: '格式审核面板' });
  await expect(audit.getByText('未通过', { exact: true })).toBeVisible();
  await expect(button(audit, '生成三维模型')).toBeDisabled();
  await audit.getByRole('button', { name: /长对正/ }).click();
  await expect(canvas(page).locator('[data-audit-markers="projection-x"]')).toBeVisible();
  await expect(canvas(page).locator('[data-entity-id="h-outline-2"]')).toHaveAttribute(
    'data-selected',
    'true',
  );
  await shot(page, info, '05-audit-misalignment');

  await load(page);
  await expect(audit.getByText('通过', { exact: true }).first()).toBeVisible();
  await expect(canvas(page).locator('[data-audit-markers="projection-x"]')).toHaveCount(0);
  await button(audit, '生成三维模型').click();
  const view3D = page.getByLabel('三维实体画布');
  await expect(view3D).toBeVisible();
  expect(Number(await view3D.getAttribute('data-triangle-count'))).toBeGreaterThan(100);
  await expect
    .poll(() =>
      view3D.evaluate((node: HTMLCanvasElement) => {
        const data = node.getContext('2d')!.getImageData(0, 0, node.width, node.height).data;
        return data.some((value, i) => i % 4 === 3 && value > 0);
      }),
    )
    .toBe(true);
  const preview = page.getByRole('region', { name: '立体图三维预览' });
  await expect(panel(page)).toBeVisible();
  for (const view of ['正视', '俯视', '左视', '轴测']) {
    await button(preview, view).click();
    await expect(button(preview, view)).toHaveAttribute('aria-pressed', 'true');
    if (view !== '轴测') await expect(view3D).not.toHaveAttribute('data-highlighted-faces', '0');
  }
  await button(preview, '半透明').click();
  await expect(button(preview, '半透明')).toHaveAttribute('aria-pressed', 'true');
  await button(preview, '线框').click();
  await expect(button(preview, '实体')).toHaveAttribute('aria-pressed', 'true');
  await button(preview, '实体').click();
  const orbit = await view3D.getAttribute('data-orbit');
  const box = (await view3D.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 43, box.y + box.height / 2 + 27, { steps: 4 });
  await page.mouse.up();
  await expect(view3D).not.toHaveAttribute('data-orbit', orbit!);
  const rotated = await view3D.getAttribute('data-orbit');
  await page.mouse.wheel(0, -120);
  await expect(view3D).not.toHaveAttribute('data-orbit', rotated!);
  await button(preview, '正视').click();
  await expect(canvas(page).locator('[data-entity-id="v-outline-1"]')).toHaveAttribute(
    'data-model-linked',
    'true',
  );
  await button(preview, '二维-三维联动').click();
  await expect(view3D).toHaveAttribute('data-highlighted-faces', '0');
  await button(preview, '二维-三维联动').click();
  await button(preview, '轴测').click();
  const edge = await at(canvas(page), -44, 55);
  await page.mouse.move(edge.x, edge.y);
  await expect(view3D).not.toHaveAttribute('data-highlighted-faces', '0');
  const separator = page.getByRole('separator', { name: '调整二维与三维分屏宽度' });
  await separator.press('ArrowLeft');
  await expect(separator).toHaveAttribute('aria-valuenow', '54');
  await panel(page).getByLabel('选择作图步骤').selectOption('5');
  await expect(canvas(page)).toBeVisible();
  await expect(view3D).toBeVisible();
  await shot(page, info, '06-animation-and-solid');

  await page.setViewportSize({ width: 390, height: 844 });
  const tabs = page.getByRole('group', { name: '工作区视图' });
  await expect(tabs).toBeVisible();
  await button(tabs, '立体').click();
  await expect(view3D).toBeVisible();
  await expect(canvas(page)).toBeHidden();
  await shot(page, info, '07-mobile-solid');
  await button(tabs, '图纸').click();
  await expect(canvas(page)).toBeVisible();
  await expect(view3D).toBeHidden();
  await shot(page, info, '08-mobile-animation');
});
