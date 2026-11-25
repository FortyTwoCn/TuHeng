import { test, expect } from '@playwright/test';
import { setup, at } from './editor-fixture';
import { cpus, platform } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
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
  const camera = () =>
    second.locator('.geo-view > svg').evaluate((el) => {
      const svg = el as SVGSVGElement,
        box = svg.viewBox.baseVal;
      return { x: box.x + box.width / 2, y: box.y + box.height / 2, scale: svg.getScreenCTM()!.a };
    });
  const beforeZoom = await camera();
  await svg.focus();
  await page.mouse.move(p.x, p.y);
  await page.mouse.wheel(0, -250);
  await page.waitForTimeout(100);
  const afterZoom = await camera();
  expect(afterZoom.x).toBeCloseTo(beforeZoom.x, 5);
  expect(afterZoom.y).toBeCloseTo(beforeZoom.y, 5);
  expect(afterZoom.scale).toBeCloseTo(beforeZoom.scale, 5);
  const c = await at(second.locator('.geo-view > svg'), -42.5, 35);
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
  await expect(first.locator('[data-measurement-hud]')).toBeVisible();
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
test('UX24/26: pending construction cannot overwrite an external document revision', async ({
  page,
}) => {
  await setup(page);
  const first = page.locator('[data-editor=a]'),
    svg = first.locator('.geo-view svg');
  const r = await at(svg, 0, 25);
  await page.mouse.click(r.x, r.y);
  await first.getByRole('button', { name: '编辑属性', exact: true }).click();
  await first.getByRole('button', { name: '平行线', exact: true }).click();
  const p = await at(svg, -45, 15);
  await page.mouse.click(p.x, p.y);
  const confirm = first.getByRole('button', { name: '确认创建', exact: true });
  await expect(confirm).toBeEnabled();
  await page.evaluate(() => window.editorFixture.echo());
  await expect(confirm).toBeEnabled();
  await page.evaluate(() => window.editorFixture.external());
  const external = await page.evaluate(() => window.editorFixture.documents());
  await expect(confirm).toHaveCount(0);
  await expect(first.getByRole('dialog', { name: '构造与关系' })).toHaveCount(0);
  expect(await page.evaluate(() => window.editorFixture.documents())).toEqual(external);
});

for (const [w, h] of [
  [360, 800],
  [390, 844],
  [768, 1024],
  [1024, 768],
  [1366, 768],
  [1440, 900],
]) {
  test('organization round: editable inspector actions at ' + w + 'x' + h, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await setup(page);
    const first = page.locator('[data-editor=a]');
    await first.evaluate((e, width) => {
      e.setAttribute('style', 'width:' + width + 'px;flex:none');
    }, w - 16);
    const svg = first.locator('.geo-view svg');
    const selectSegment = async () => {
      const pos = await at(svg, -42.5, 35);
      await page.mouse.click(pos.x, pos.y);
      const candidates = first.getByLabel('重叠对象');
      if (await candidates.isVisible()) {
        const segment = candidates.locator('option', { hasText: '线段' }).first();
        await candidates.selectOption((await segment.getAttribute('value'))!);
      }
    };
    await selectSegment();
    const card = first.getByRole('dialog', { name: '对象属性' }),
      heading = card.locator('.geo-card-heading');
    const expand = card.getByRole('button', { name: '编辑属性', exact: true });
    if (await expand.isVisible()) await expand.click();
    const pane = card.locator('.geo-card-details');
    await pane.evaluate((e) => {
      e.scrollTop = e.scrollHeight;
    });
    for (const label of ['复制', '删除']) {
      const btn = heading.getByRole('button', { name: label, exact: true });
      await expect(btn).toBeVisible({ timeout: 2500 });
      expect(
        await btn.evaluate((b) => {
          const r = b.getBoundingClientRect();
          return (
            r.height >= 44 &&
            r.width >= 44 &&
            b.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
          );
        }),
      ).toBe(true);
    }
    mkdirSync('test-results/teaching-organization', { recursive: true });
    await page.screenshot({ path: 'test-results/teaching-organization/inspector-' + w + '.png' });
    const before = await page.evaluate(() => window.editorFixture.documents()[0]!);
    await heading.getByRole('button', { name: '复制', exact: true }).click();
    expect(
      (await page.evaluate(() => window.editorFixture.documents()[0]!)).entities.length,
    ).toBeGreaterThan(before.entities.length);
    await first.getByRole('button', { name: '撤销', exact: true }).click();
    expect((await page.evaluate(() => window.editorFixture.documents()[0]!)).entities).toEqual(
      before.entities,
    );
    if (!(await heading.isVisible())) await selectSegment();
    await heading.getByRole('button', { name: '删除', exact: true }).click();
    expect(
      (await page.evaluate(() => window.editorFixture.documents()[0]!)).entities.length,
    ).toBeLessThan(before.entities.length);
  });
}
