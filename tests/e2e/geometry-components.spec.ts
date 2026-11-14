import { test, expect, type Page, type Locator } from '@playwright/test';
import { build } from 'esbuild';
import { cpus, platform } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
let script = '',
  css = '';
test.beforeAll(async () => {
  const built = await build({
    entryPoints: ['tests/components/editor-fixture.tsx'],
    bundle: true,
    write: false,
    outdir: 'fixture',
    platform: 'browser',
    format: 'iife',
    define: { 'process.env.NODE_ENV': '"production"' },
    alias: {
      '@tuheng/geometry-editor/src/styles.css': './packages/geometry-editor/src/styles.css',
    },
  });
  script = built.outputFiles.find((f) => f.path.endsWith('.js'))!.text;
  css = built.outputFiles.find((f) => f.path.endsWith('.css'))!.text;
});
async function setup(page: Page) {
  await page.route('**/__test/editor-fixture', (r) =>
    r.fulfill({
      contentType: 'text/html',
      body:
        '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:8px;font-family:system-ui}' +
        css +
        '</style></head><body><div id="root"></div><script>' +
        script +
        '</script></body></html>',
    }),
  );
  await page.goto('/__test/editor-fixture');
  await expect(page.locator('.geometry-editor')).toHaveCount(2);
}
async function at(svg: Locator, x: number, y: number) {
  return svg.evaluate(
    (e, p) => {
      const q = new DOMPoint(p.x, -p.y).matrixTransform((e as SVGSVGElement).getScreenCTM()!);
      return { x: q.x, y: q.y };
    },
    { x, y },
  );
}
test.use({ viewport: { width: 1366, height: 900 } });
test('UX26: two controlled editors isolate keyboard, camera and same-revision input drafts', async ({
  page,
}) => {
  await setup(page);
  const first = page.locator('[data-editor=a]'),
    second = page.locator('[data-editor=b]'),
    svg = first.locator('.geo-view svg');
  const initial = await page.evaluate(() => window.editorFixture.documents());
  const p = await at(svg, -42.5, 35);
  await page.mouse.click(p.x, p.y);
  const input = first.getByLabel('长度 (mm)', { exact: true });
  await input.fill('-');
  await page.evaluate(() => window.editorFixture.echo());
  await expect(input).toHaveValue('-');
  await expect(input).toBeFocused();
  await input.fill('32');
  await input.press('Enter');
  let next = await page.evaluate(() => window.editorFixture.documents());
  expect(next[0]).not.toEqual(initial[0]);
  expect(next[1]).toEqual(initial[1]);
  await svg.focus();
  await page.keyboard.press('Control+z');
  next = await page.evaluate(() => window.editorFixture.documents());
  expect(next).toEqual(initial);
  await page.keyboard.press('Control+y');
  next = await page.evaluate(() => window.editorFixture.documents());
  expect(next[0]).not.toEqual(initial[0]);
  await second.locator('.geo-view svg').focus();
  await page.keyboard.press('Control+z');
  expect(await page.evaluate(() => window.editorFixture.documents())).toEqual(next);
  const camera = await second.locator('svg').getAttribute('viewBox');
  await svg.focus();
  await page.mouse.move(p.x, p.y);
  await page.mouse.wheel(0, -250);
  await page.waitForTimeout(100);
  expect(await second.locator('svg').getAttribute('viewBox')).toBe(camera);
  const c = await at(second.locator('svg'), -42.5, 35);
  await page.mouse.click(c.x, c.y);
  await expect(second.locator('.geo-compact-summary')).toBeVisible();
  await expect(second.locator('.geo-compact-summary')).toContainText('25.00 mm');
  mkdirSync('test-results/geometry-ux-v2', { recursive: true });
  await page.screenshot({ path: 'test-results/geometry-ux-v2/two-editors-narrow.png' });
});
test('UX24/26: external revision during real drag cancels safely without overwriting replacement', async ({
  page,
}) => {
  await setup(page);
  const svg = page.locator('[data-editor=a] .geo-view svg'),
    p = await at(svg, -30, 35);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 25, p.y - 10, { steps: 5 });
  await expect(page.locator('[data-editor=a] [data-measurement-hud]')).toBeVisible();
  await page.evaluate(() => window.editorFixture.external());
  const external = await page.evaluate(() => window.editorFixture.documents());
  await page.mouse.move(p.x + 40, p.y - 15);
  await page.mouse.up();
  expect(await page.evaluate(() => window.editorFixture.documents())).toEqual(external);
  await expect(svg).toHaveAttribute('data-interaction', 'idle');
});
test('UX performance: real pointer preview with 100 points 300 segments and 100 curves', async ({
  page,
  browser,
}) => {
  await setup(page);
  await page.evaluate(() => window.editorFixture.performance());
  const first = page.locator('[data-editor=a]'),
    svg = first.locator('.geo-view svg');
  await expect(first.locator('[data-entity-id]')).toHaveCount(513);
  await first.getByRole('button', { name: '完整展开图', exact: true }).click();
  const p = await at(svg, -28, 20);
  await page.evaluate(() => {
    window.frameSamples = [];
    const svg = document.querySelector('[data-editor=a] .geo-view svg')!;
    svg.addEventListener('pointermove', () => {
      const start = performance.now();
      requestAnimationFrame(() =>
        requestAnimationFrame(() => window.frameSamples.push(performance.now() - start)),
      );
    });
  });
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  for (let i = 1; i <= 30; i++) await page.mouse.move(p.x + i * 0.8, p.y - i * 0.4);
  await page.mouse.up();
  await page.waitForTimeout(100);
  const samples = await page.evaluate(() => window.frameSamples),
    sorted = [...samples].sort((a, b) => a - b);
  expect(samples.length).toBeGreaterThan(10);
  const docs = await page.evaluate(() => window.editorFixture.documents());
  expect(docs[0]?.entities.length).toBeGreaterThan(500);
  mkdirSync('test-results/geometry-ux-v2', { recursive: true });
  writeFileSync(
    'test-results/geometry-ux-v2/performance.json',
    JSON.stringify(
      {
        browser: browser.version(),
        os: platform(),
        cpu: cpus()[0].model,
        rendering:
          'React production fixture, Chrome headless; pointer event to second requestAnimationFrame, includes frame waiting',
        entities: 513,
        points: 110,
        segments: 300,
        circles: 50,
        arcs: 50,
        frames: 3,
        samples: samples.length,
        medianMs: sorted[Math.floor(sorted.length * 0.5)],
        p95Ms: sorted[Math.floor(sorted.length * 0.95)],
        maxMs: Math.max(...samples),
      },
      null,
      2,
    ),
  );
});
