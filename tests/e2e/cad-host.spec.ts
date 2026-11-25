import { expect, test, type Page } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { GeometryDocument } from '@tuheng/contracts';
import { prepareLogin } from './identity-login';

const evidence = 'docs/evidence/cad-workspace';
const screens = [
  [1440, 900],
  [1280, 800],
  [1024, 768],
  [768, 1024],
  [390, 844],
] as const;

async function capture(page: Page, size: string, state: string) {
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: `${evidence}/${size}-${state}.png`, animations: 'disabled' });
}

for (const [width, height] of screens) {
  test(`official geometry page at ${width}×${height} supports precision and continuous drafting`, async ({
    page,
  }) => {
    const size = `${width}x${height}`;
    await page.setViewportSize({ width, height });
    const login = await prepareLogin(page, 'student', '/geometry');
    await login.fill('student@tuheng.local');
    await page.getByLabel('密码', { exact: true }).fill(process.env.SEED_PASSWORD!);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL('/geometry');
    const editor = page.getByRole('main', { name: '独立几何作图' }),
      canvas = editor.getByLabel('统一展开图绘图区');
    await expect(editor.locator('[data-workspace-ready=true]')).toBeVisible();
    await expect(canvas).toBeVisible();
    const extent = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    }));
    expect(extent.width).toBeLessThanOrEqual(width);
    expect(extent.height).toBeLessThanOrEqual(height + 1);
    await expect(page.locator('.site-footer')).toBeHidden();
    await expect(editor.locator('[data-kind=segment]')).toHaveCount(0);
    await capture(page, size, 'empty');

    const bounds = (await canvas.boundingBox())!;
    const at = (x: number, y: number) => ({
      x: bounds.x + bounds.width * x,
      y: bounds.y + bounds.height * y,
    });
    async function click(x: number, y: number) {
      const p = at(x, y);
      await page.mouse.click(p.x, p.y);
    }
    async function move(x: number, y: number) {
      const p = at(x, y);
      await page.mouse.move(p.x, p.y, { steps: 4 });
    }
    await editor.locator('[data-command=segment]:visible').click();
    await click(0.31, 0.61);
    await move(0.61, 0.61);
    const rubberBand = editor.locator('[data-transient="rubber-band"]');
    // A horizontal SVG line paints a stroke while its CSS bounding box has zero height.
    await expect
      .poll(() => rubberBand.evaluate((el) => (el as SVGLineElement).getTotalLength()))
      .toBeGreaterThan(1);
    await expect(editor.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
    await page.keyboard.type('24');
    const length = editor.getByRole('textbox', { name: '动态长度', exact: true });
    await expect(length).toBeFocused();
    await expect(length).toHaveValue('24');
    await capture(page, size, 'length');
    await length.press('Enter');
    await expect(editor.getByRole('button', { name: '撤销', exact: true })).toBeEnabled();
    await click(0.62, 0.32);
    await click(0.35, 0.32);
    await move(0.26, 0.51);
    await expect
      .poll(() => rubberBand.evaluate((el) => (el as SVGLineElement).getTotalLength()))
      .toBeGreaterThan(1);
    await capture(page, size, 'continuous');
    await editor
      .getByRole('region', { name: 'CAD 命令' })
      .getByRole('button', { name: '完成', exact: true })
      .click();
    await expect(editor.locator('[data-kind=segment]')).toHaveCount(3);

    await editor.locator('[data-command=select]:visible').click();
    const mid = await editor
      .locator('[data-kind=segment] > line')
      .last()
      .evaluate((element) => {
        const line = element as SVGLineElement;
        const p = new DOMPoint(
          (line.x1.baseVal.value + line.x2.baseVal.value) / 2,
          (line.y1.baseVal.value + line.y2.baseVal.value) / 2,
        ).matrixTransform(line.getScreenCTM()!);
        return { x: p.x, y: p.y };
      });
    await page.mouse.click(mid.x, mid.y);
    const card = editor.getByRole('dialog', { name: '对象属性' });
    await expect(card.getByRole('button', { name: '复制', exact: true })).toBeVisible();
    await expect(card.getByRole('button', { name: '删除', exact: true })).toBeVisible();
    await expect(card).not.toContainText('-0.0°');
    if (width === 1440) {
      await expect(card.getByRole('textbox', { name: '局部角度 (°)' })).toHaveValue('0');
    }
    await capture(page, size, 'selected');
    await editor.getByRole('button', { name: '文件', exact: true }).click();
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出 JSON', exact: true }).click();
    const result = GeometryDocument.parse(
      JSON.parse(await readFile((await (await pending).path())!, 'utf8')),
    );
    const segments = result.entities.filter((e) => e.kind === 'segment');
    expect(segments).toHaveLength(3);
    expect(segments[0].endPoint).toBe(segments[1].startPoint);
    expect(segments[1].endPoint).toBe(segments[2].startPoint);
    const points = result.entities.filter((e) => e.kind === 'point');
    const a = points.find((e) => e.id === segments[0].startPoint)!.position;
    const b = points.find((e) => e.id === segments[0].endPoint)!.position;
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(24, 7);
  });
}
