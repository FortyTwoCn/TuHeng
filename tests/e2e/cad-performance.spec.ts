import { test, expect, type Locator, type Page } from '@playwright/test';
import { cpus, platform } from 'node:os';
import { readFileSync, writeFileSync } from 'node:fs';
import { cadPerformanceDrawing } from '../cad-performance-fixture';
import { at, setup } from './editor-fixture';
import { prepareLogin } from './identity-login';
import { choose, closePanels } from './editor-controls';

function startSampling(svg: Locator) {
  return svg.evaluate((el) => {
    window.frameSamples = [];
    el.addEventListener('pointermove', () => {
      const start = performance.now();
      requestAnimationFrame(() =>
        requestAnimationFrame(() => window.frameSamples.push(performance.now() - start)),
      );
    });
  });
}
function distribution(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    samples: sorted.length,
    medianMs: sorted[Math.floor(sorted.length * 0.5)],
    p95Ms: sorted[Math.floor(sorted.length * 0.95)],
    maxMs: sorted.at(-1),
    chronologicalMs: values.map((v) => Number(v.toFixed(2))),
  };
}

async function samplePinch(page: Page, svg: Locator) {
  const canvas = (await svg.boundingBox())!;
  const middle = { x: canvas.x + canvas.width * 0.75, y: canvas.y + canvas.height * 0.65 };
  const scale = () => svg.evaluate((el) => (el as SVGSVGElement).getScreenCTM()!.a);
  const beginning = await scale();
  const cdp = await page.context().newCDPSession(page);
  const touches = (r: number) => [
    { x: middle.x - r, y: middle.y, id: 1 },
    { x: middle.x + r, y: middle.y, id: 2 },
  ];
  for (const p of touches(32))
    expect(
      await svg.evaluate((el, at) => el.contains(document.elementFromPoint(at.x, at.y)), p),
    ).toBe(true);
  await page.evaluate(() => {
    window.frameSamples = [];
  });
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touches(32) });
    for (let i = 1; i <= 16; i++)
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: touches(32 + 2 * i),
      });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await cdp.detach();
  }
  await expect.poll(scale).toBeGreaterThan(beginning);

  await expect
    .poll(() => page.evaluate(() => window.frameSamples.length))
    .toBeGreaterThanOrEqual(10);
  return distribution(await page.evaluate(() => window.frameSamples.slice()));
}

// Trace capture snapshots the whole SVG after input. Keep it out of this timing sample.
test.use({ hasTouch: true, viewport: { width: 1440, height: 900 }, trace: 'off', video: 'off' });
test('共享节点、椭圆、样条与剖面的复杂图纸支持实时拖动及双指缩放', async ({
  page,
  browser,
}, info) => {
  await setup(page);
  const source = cadPerformanceDrawing(34, 19);
  const first = page.locator('[data-editor=a]');
  const svg = first.locator('.geo-view svg');
  await first.getByLabel('加载几何 JSON').setInputFiles({
    name: 'complex.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(source)),
  });
  await expect(first.locator('[data-entity-id]')).toHaveCount(source.entities.length);
  const second = await page.evaluate(() => window.editorFixture.documents()[1]);
  const center = first.locator('[data-entity-id="p-5-5"] circle').first();
  const pointDiameter = () =>
    center.evaluate((el) => {
      const c = el as SVGCircleElement,
        m = c.getScreenCTM()!;
      return c.getBBox().width * Math.hypot(m.a, m.b);
    });
  const original = Number(await center.getAttribute('cx'));
  expect(await pointDiameter()).toBeCloseTo(6, 1);
  const pointer = await at(svg, -30, 30);
  await page.mouse.move(pointer.x, pointer.y);
  await page.mouse.down();
  await startSampling(svg);
  for (let i = 1; i <= 24; i++) await page.mouse.move(pointer.x + i * 0.8, pointer.y + i * 0.42);
  await expect.poll(async () => Number(await center.getAttribute('cx'))).not.toBe(original);
  const authoritative = await page.evaluate(() => window.editorFixture.documents()[0]!);
  expect(authoritative.entities).toEqual(source.entities);
  await expect
    .poll(() => page.evaluate(() => window.frameSamples.length))
    .toBeGreaterThanOrEqual(20);
  const drag = distribution(await page.evaluate(() => window.frameSamples.slice()));
  await page.mouse.up();
  const afterDrag = await page.evaluate(() => window.editorFixture.documents()[0]!);
  expect(afterDrag.entities).not.toEqual(source.entities);

  await svg.focus();
  await page.keyboard.press('Escape');
  const pinch = await samplePinch(page, svg);
  expect(await pointDiameter()).toBeCloseTo(6, 1);
  const [sameGeometry, otherEditor] = await page.evaluate(() => window.editorFixture.documents());
  expect(sameGeometry).toEqual(afterDrag);
  expect(otherEditor).toEqual(second);
  const report = {
    browser: browser.version(),
    os: platform(),
    cpu: cpus()[0].model,
    entities: source.entities.length,
    viewport: '1440x900',
    editors: 2,
    methodology:
      'SVG pointermove arrival to second requestAnimationFrame; includes frame scheduling. Chromium CDP touch emulation.',
    drag,
    pinch,
  };
  writeFileSync(info.outputPath('cad-browser-performance.json'), JSON.stringify(report, null, 2));
});

test('练习页加载复杂图纸，双指缩放后导出的正式 JSON 与加载时一致', async ({
  page,
  browser,
}, info) => {
  await prepareLogin(page, 'student', '/geometry');
  await page.getByLabel('已绑定邮箱', { exact: true }).fill('student@tuheng.local');
  await page.getByLabel('密码', { exact: true }).fill(process.env.SEED_PASSWORD!);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  const source = cadPerformanceDrawing(34, 19);
  const editor = page.locator('.geometry-editor'),
    svg = editor.locator('.geo-view svg');
  await editor.getByLabel('加载几何 JSON').setInputFiles({
    name: 'complex.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(source)),
  });
  await expect(editor.locator('[data-entity-id]')).toHaveCount(source.entities.length);
  await svg.scrollIntoViewIfNeeded();
  await startSampling(svg);
  const pinch = await samplePinch(page, svg);
  const download = page.waitForEvent('download');
  await choose(page, '导出 JSON');
  await closePanels(page);
  const exported = JSON.parse(readFileSync((await (await download).path())!, 'utf8'));
  expect(exported).toEqual(source);
  writeFileSync(
    info.outputPath('cad-workspace-performance.json'),
    JSON.stringify(
      {
        browser: browser.version(),
        os: platform(),
        cpu: cpus()[0].model,
        route: '/geometry',
        viewport: '1440x900',
        entities: source.entities.length,
        pinch,
      },
      null,
      2,
    ),
  );
});
