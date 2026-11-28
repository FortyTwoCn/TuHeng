import { expect, test, type Locator, type Page } from '@playwright/test';
import { captureCadReconstruction, freezeConstructionFrame } from './cad-reconstruction-evidence';
import { prepareLogin } from './identity-login';

const lesson = 'docs/geometry-examples/construction/THREE-VIEW-CONSTRUCTION.json';
const button = (scope: Locator | Page, name: string) =>
  scope.getByRole('button', { name, exact: true });
const editor = (page: Page) => page.locator('.geometry-editor');
const drawing = (page: Page) => page.getByLabel('统一展开图绘图区');
const narration = (page: Page) => page.getByRole('complementary', { name: '分步动画面板' });
const timeline = (page: Page) => page.getByRole('navigation', { name: '作图步骤时间轴' });
const preview = (page: Page) => page.getByRole('region', { name: '立体图三维预览' });
const reference = (page: Page) => page.getByRole('complementary', { name: '参考图纸预览' });
const visibleOutline = (page: Page) => drawing(page).locator('[data-entity-id="v-outline-1"]');
const darkButton = '切换深色画布';
const lightButton = '切换浅色画布';

test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' });

async function openEditor(page: Page, file = lesson) {
  const email = await prepareLogin(page, 'student', '/geometry');
  await email.fill('student@tuheng.local');
  await page.getByLabel('密码', { exact: true }).fill(process.env.SEED_PASSWORD!);
  await button(page, '登录').click();
  await expect(page).toHaveURL('/geometry');
  await expect(editor(page)).toHaveAttribute('data-workspace-ready', 'true');
  await page.getByLabel('加载几何 JSON', { exact: true }).setInputFiles(file);
  await expect(drawing(page).locator('[data-entity-id]').first()).toBeVisible();
}

async function capture(page: Page, name: string) {
  const directory = process.env.CAD_TEACHING_EVIDENCE;
  if (directory) await captureCadReconstruction(page, name, directory);
}

const channels = (color: string) => color.match(/[\d.]+/g)!.map(Number);
function luminance(channels: number[]) {
  return [0.2126, 0.7152, 0.0722].reduce((value, weight, i) => {
    const x = channels[i] / 255;
    return value + weight * (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
  }, 0);
}
function contrast(a: string, b: string) {
  const x = luminance(channels(a));
  const y = luminance(channels(b));
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
const paint = (node: Locator) =>
  node.evaluate((element) => {
    const { backgroundColor, color, borderTopColor, colorScheme } = getComputedStyle(element);
    return { backgroundColor, color, borderTopColor, colorScheme };
  });
const scenePixel = (canvas: Locator, point: [number, number] = [0.03, 0.03]) =>
  canvas.evaluate((node: HTMLCanvasElement, [u, v]) => {
    const x = Math.floor(node.width * u);
    const y = Math.floor(node.height * v);
    return [...node.getContext('2d')!.getImageData(x, y, 1, 1).data];
  }, point);

async function surfacePalette(locators: Locator[], theme: 'light' | 'dark') {
  return Promise.all(
    locators.map(async (node) => {
      await expect(node).toBeVisible();
      const state = await paint(node);
      expect(state.colorScheme).toBe(theme);
      const brightness = luminance(channels(state.backgroundColor));
      if (theme === 'dark') expect(brightness).toBeLessThan(0.15);
      else expect(brightness).toBeGreaterThan(0.65);
      expect(contrast(state.color, state.backgroundColor)).toBeGreaterThanOrEqual(4.5);
      return state;
    }),
  );
}

async function matchesLegend(page: Page, sample: string, mark: Locator, dot = false) {
  const ink = await mark.evaluate((element, dot) => {
    const style = getComputedStyle(element);
    return dot ? style.fill : style.stroke;
  }, dot);
  await expect(editor(page).locator('[data-sample="' + sample + '"]')).toHaveCSS(
    dot ? 'background-color' : 'border-top-color',
    ink,
  );
  return ink;
}

async function checkPlaybackLayout(panel: Locator) {
  const controls = panel.getByRole('group', { name: '步骤播放' }).getByRole('button');
  const tops = await controls.evaluateAll((elements) =>
    elements.map((element) => element.getBoundingClientRect().top),
  );
  expect(tops).toHaveLength(3);
  expect(new Set(tops).size).toBe(1);
  const speed = (await panel.getByLabel('播放速度').boundingBox())!;
  const guides = (await button(panel, '作图线').boundingBox())!;
  expect(speed.y).toBeCloseTo(guides.y, 0);
  expect(speed.height).toBeCloseTo(guides.height, 0);
}

async function loadReference(page: Page) {
  await button(page, '参考图纸').click();
  await page.getByLabel('选择参考图纸文件').setInputFiles(lesson);
  const view = page.getByLabel('参考图纸绘图区');
  await expect(view).toBeVisible();
  return view;
}

test('桌面讲解工作区实时切换主题，线型图例、Canvas 与参考图纸随之恢复', async ({ page }) => {
  await openEditor(page);
  await button(page, lightButton).click();
  await button(page, '讲解').click();
  await expect(
    editor(page).locator('.cad-topbar').getByRole('group', { name: '讲解模块' }),
  ).toBeVisible();
  await checkPlaybackLayout(narration(page));
  const empty = button(preview(page), '生成三维模型');
  expect((await empty.boundingBox())!.width).toBeLessThan(200);
  await button(narration(page), '下一步').click();
  await expect(narration(page).getByRole('progressbar')).toHaveAttribute('value', '2');
  await expect(drawing(page).locator('[data-viewport-grid]')).toBeVisible();
  await freezeConstructionFrame(drawing(page), 1510);
  const playKey = drawing(page).locator('[data-construction-play-key]');
  const frame = await playKey.getAttribute('data-construction-play-key');
  const guide = drawing(page).locator('[data-temporary-guide="front:right-edge"] > line');
  const currentInk = await matchesLegend(page, 'draw', visibleOutline(page));
  await matchesLegend(page, 'guide', guide);
  await capture(page, '01-teaching-light');

  await button(page, darkButton).click();
  await expect(playKey).toHaveAttribute('data-construction-play-key', frame!);
  expect(await matchesLegend(page, 'draw', visibleOutline(page))).not.toBe(currentInk);
  await matchesLegend(page, 'guide', guide);
  for (const sample of ['special', 'general']) {
    const dot = drawing(page)
      .locator('[data-focus-kind="' + sample.toUpperCase() + '"] circle')
      .first();
    await matchesLegend(page, sample, dot, true);
  }
  const label = drawing(page).locator('.geo-construction-focus-label').first();
  const paper = (await paint(drawing(page))).backgroundColor;
  expect(contrast(await label.evaluate((e) => getComputedStyle(e).fill), paper)).toBeGreaterThan(
    4.5,
  );
  await capture(page, '02-teaching-dark');

  await button(timeline(page), '第 5 步').click();
  await matchesLegend(page, 'erase', drawing(page).locator('[data-entity-id="v-overrun-1"]'));
  await narration(page).getByLabel('选择作图步骤').selectOption('5');
  await expect(visibleOutline(page)).toHaveAttribute('data-construction-role', 'DEEPENED');
  expect(
    contrast(await matchesLegend(page, 'visible', visibleOutline(page)), paper),
  ).toBeGreaterThan(7);
  await matchesLegend(page, 'hidden', drawing(page).locator('[data-entity-id="v-hole-35-1"]'));

  await button(preview(page), '生成三维模型').click();
  const canvas = preview(page).getByLabel('三维实体画布');
  await expect(canvas).toBeVisible();
  const referenceView = await loadReference(page);
  const edge = referenceView.locator('[data-entity-id="v-outline-1"] > line');
  const midpoint = await edge.evaluate((line: SVGLineElement) => {
    const p = line
      .getPointAtLength(line.getTotalLength() * 0.2)
      .matrixTransform(line.getScreenCTM()!);
    return { x: p.x, y: p.y };
  });
  await page.mouse.click(midpoint.x, midpoint.y);
  const properties = reference(page).getByRole('region', { name: '参考图元属性' });
  await expect(properties.getByText('起点坐标')).toBeVisible();
  await expect(button(reference(page), '复制到主画框')).toBeDisabled();
  await expect(button(timeline(page), '第 6 步')).toBeInViewport();
  await capture(page, '08-dark-reference-properties');

  const surfaces = [
    editor(page).locator('.cad-topbar'),
    editor(page).locator('.cad-statusbar'),
    editor(page).getByRole('group', { name: '讲解模块' }),
    narration(page),
    narration(page).locator('.geo-construction-narration'),
    narration(page).getByLabel('选择作图步骤'),
    editor(page).locator('.geo-construction-footer'),
    editor(page).locator('.geo-construction-legend'),
    preview(page),
    drawing(page),
    reference(page),
    reference(page).locator('.geo-reference-titlebar'),
    reference(page).locator('.geo-reference-inspector'),
    referenceView,
  ];
  const orbit = (await canvas.getAttribute('data-orbit'))!;
  const selected = referenceView.locator('[data-entity-id="v-outline-1"]');
  await button(page, lightButton).click();
  const light = await surfacePalette(surfaces, 'light');
  const lightInk = await matchesLegend(page, 'visible', visibleOutline(page));
  await expect.poll(async () => luminance(await scenePixel(canvas))).toBeGreaterThan(0.65);
  const lightPixel = await scenePixel(canvas);

  await button(page, darkButton).click();
  const dark = await surfacePalette(surfaces, 'dark');
  for (const [i, value] of dark.entries())
    expect(value.backgroundColor).not.toBe(light[i].backgroundColor);
  expect(await matchesLegend(page, 'visible', visibleOutline(page))).not.toBe(lightInk);
  await expect.poll(async () => luminance(await scenePixel(canvas))).toBeLessThan(0.15);
  expect((await scenePixel(canvas))[3]).toBe(255);
  await expect(canvas).toHaveAttribute('data-orbit', orbit);
  await expect(selected).toHaveAttribute('data-selected', 'true');

  await button(page, lightButton).click();
  expect(await surfacePalette(surfaces, 'light')).toEqual(light);
  expect(await matchesLegend(page, 'visible', visibleOutline(page))).toBe(lightInk);
  // Chromium dithers gradient channels by one value.
  await expect
    .poll(async () =>
      Math.max(
        ...(await scenePixel(canvas)).map((channel, i) => Math.abs(channel - lightPixel[i])),
      ),
    )
    .toBeLessThanOrEqual(1);

  await button(reference(page), '切为浮窗').click();
  await expect(reference(page)).toHaveAttribute('data-placement', 'floating');
  const floatingLight = await surfacePalette([reference(page), referenceView], 'light');
  await button(page, darkButton).click();
  await surfacePalette([reference(page), referenceView], 'dark');
  await button(reference(page), '最小化参考图纸').click();
  const chip = button(page, '参考图纸 · 点击展开');
  await surfacePalette([chip], 'dark');
  await button(page, lightButton).click();
  await surfacePalette([chip], 'light');
  await chip.click();
  expect(await surfacePalette([reference(page), referenceView], 'light')).toEqual(floatingLight);

  await button(page, '格式审核').click();
  const audit = page.getByRole('complementary', { name: '格式审核面板' });
  const auditSurfaces = [audit, audit.locator('.geo-audit-heading [data-severity]')];
  const auditLight = await surfacePalette(auditSurfaces, 'light');
  await button(page, darkButton).click();
  await surfacePalette(auditSurfaces, 'dark');
  await button(page, lightButton).click();
  expect(await surfacePalette(auditSurfaces, 'light')).toEqual(auditLight);
});

async function showReconstruction(page: Page, file: string) {
  await openEditor(page, 'docs/geometry-examples/reconstruction/' + file + '.json');
  await button(page, '格式审核').click();
  const audit = page.getByRole('complementary', { name: '格式审核面板' });
  await button(audit, '生成三维模型').click();
  await button(page, '收起步骤讲解').click();
  await button(page, '收起步骤条').click();
  const split = page.getByRole('separator', { name: '调整二维与三维分屏宽度' });
  for (let i = 0; i < 3; i++) await split.press('ArrowLeft');
}

test('7-24 的实体和半透明视图使用真实双主题 3D 像素', async ({ page }) => {
  await showReconstruction(page, '7-24-THREE-VIEW-COMPLETE');
  await button(page, lightButton).click();
  const canvas = preview(page).getByLabel('三维实体画布');
  await expect(preview(page).locator('summary')).toContainText('88 × 53 × 73 mm');
  await expect.poll(async () => luminance(await scenePixel(canvas))).toBeGreaterThan(0.65);
  const face = () => scenePixel(canvas, [0.74, 0.63]);
  const solidLight = luminance(await face());
  expect(solidLight).toBeLessThan(0.6);
  await capture(page, '03-7-24-light-solid');
  const translucent = button(preview(page), '半透明');
  await translucent.click();
  await expect.poll(async () => luminance(await face())).toBeGreaterThan(solidLight + 0.06);
  await capture(page, '04-7-24-light-translucent');
  await button(page, darkButton).click();
  await expect(translucent).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => luminance(await scenePixel(canvas))).toBeLessThan(0.15);
  await capture(page, '06-7-24-dark-translucent');
  const translucentDark = luminance(await face());
  await translucent.click();
  await expect.poll(async () => luminance(await face())).toBeGreaterThan(translucentDark + 0.06);
  await capture(page, '05-7-24-dark-solid');
  await button(page, lightButton).click();
  await expect.poll(async () => luminance(await face())).toBeCloseTo(solidLight, 2);
});

test('3-19 的暗色空间场景保留投影面、标签与投影射线', async ({ page }) => {
  await showReconstruction(page, '3-19-VH-SPATIAL');
  const canvas = preview(page).getByLabel('画法几何三维画布');
  await expect(canvas).toHaveAttribute('data-spatial-points', '8');
  await expect(canvas).toHaveAttribute('data-spatial-faces', '2');
  await expect(canvas).toHaveAttribute('data-projection-rays', '16');
  await expect.poll(async () => (await scenePixel(canvas))[3]).toBe(255);
  expect(luminance(await scenePixel(canvas))).toBeLessThan(0.15);
  await capture(page, '07-3-19-dark-spatial');
});

test.describe('390 × 844 触控编辑器', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('两种主题的讲解标签、图纸、步骤条、立体图与参考图均可点按', async ({ page }) => {
    await openEditor(page);
    await button(editor(page).getByRole('group', { name: '工作区模式' }), '讲解').tap();
    await loadReference(page);
    const tabs = editor(page).getByRole('group', { name: '工作区视图' });
    await button(tabs, '讲解').tap();
    await button(narration(page), '下一步').tap();
    await checkPlaybackLayout(narration(page));
    await capture(page, '09-mobile-dark');
    for (const theme of ['dark', 'light'] as const) {
      if (theme === 'light') await button(page, lightButton).tap();
      await surfacePalette([editor(page).locator('.cad-topbar'), tabs], theme);
      for (const [tab, surface] of [
        ['讲解', narration(page)],
        ['图纸', drawing(page)],
        ['步骤条', editor(page).locator('.geo-construction-footer')],
        ['立体', preview(page)],
        ['参考图', reference(page)],
      ] as const) {
        await button(tabs, tab).tap();
        await surfacePalette([surface], theme);
        const bounds = (await surface.boundingBox())!;
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.width).toBeGreaterThanOrEqual(378);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
        expect(bounds.y + bounds.height).toBeLessThan(844);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
      }
      await button(tabs, '步骤条').tap();
      const last = button(timeline(page), '第 6 步');
      await last.tap();
      await expect(last).toHaveAttribute('aria-current', 'step');
      expect(await timeline(page).evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
    }
  });
});
