import { expect, test, type Locator, type Page } from '@playwright/test';
import { captureCadReconstruction } from './cad-reconstruction-evidence';
import { prepareLogin } from './identity-login';

const button = (scope: Page | Locator, name: string) =>
  scope.getByRole('button', { name, exact: true });

async function openReconstruction(page: Page, example: string) {
  const email = await prepareLogin(page, 'student', '/geometry');
  await email.fill('student@tuheng.local');
  await page.getByLabel('密码', { exact: true }).fill(process.env.SEED_PASSWORD!);
  await button(page, '登录').click();
  await expect(page.locator('.geometry-editor')).toHaveAttribute('data-workspace-ready', 'true');
  await button(page, '切换浅色画布').click();
  await page
    .getByLabel('加载几何 JSON', { exact: true })
    .setInputFiles('docs/geometry-examples/reconstruction/' + example + '.json');
  await button(page, '格式审核').click();
  const audit = page.getByRole('complementary', { name: '格式审核面板' });
  await expect(audit.locator('.geo-audit-heading [data-severity]')).toHaveAttribute(
    'data-severity',
    'PASS',
  );
  await button(audit, '生成三维模型').click();
  const preview = page.getByRole('region', { name: '立体图三维预览' });
  await expect(preview).toBeVisible();
  await expect(audit).toHaveCount(0);
  await button(page, '收起步骤讲解').click();
  await button(page, '收起步骤条').click();
  const divider = page.getByRole('separator', { name: '调整二维与三维分屏宽度' });
  for (let i = 0; i < 3; i++) await divider.press('ArrowLeft');
  return preview;
}

async function painted(canvas: Locator) {
  await expect
    .poll(() =>
      canvas.evaluate((element: HTMLCanvasElement) => {
        const data = element
          .getContext('2d')!
          .getImageData(0, 0, element.width, element.height).data;
        let ink = 0;
        for (let i = 3; i < data.length; i += 4) if (data[i] > 16) ink++;
        return ink;
      }),
    )
    .toBeGreaterThan(4000);
}

test.use({ viewport: { width: 1600, height: 1000 } });

test('3-19 从审核进入画法几何，切换投影射线并双向联动', async ({ page }) => {
  const preview = await openReconstruction(page, '3-19-VH-SPATIAL');
  await expect(preview).toHaveAttribute('data-scene-kind', 'DESCRIPTIVE_GEOMETRY');
  const canvas = preview.getByLabel('画法几何三维画布');
  await expect(canvas).toHaveAttribute('data-spatial-points', '8');
  await expect(canvas).toHaveAttribute('data-spatial-faces', '2');
  await expect(canvas).toHaveAttribute('data-projection-rays', '16');
  await painted(canvas);
  await captureCadReconstruction(page, '09-3-19-spatial');
  await button(preview, '投影射线').click();
  await expect(canvas).toHaveAttribute('data-projection-rays', '0');
  await button(preview, '正视').click();
  const edge = page.getByLabel('统一展开图绘图区').locator('[data-entity-id="v-ab"]');
  await expect(edge).toHaveAttribute('data-model-linked', 'true');
  await button(preview, '轴测').click();
  const midpoint = await edge
    .locator('line')
    .first()
    .evaluate((line: SVGLineElement) => {
      const p = line
        .getPointAtLength(line.getTotalLength() * 0.52)
        .matrixTransform(line.getScreenCTM()!);
      return { x: p.x, y: p.y };
    });
  await page.mouse.move(midpoint.x, midpoint.y);
  await expect(canvas).not.toHaveAttribute('data-highlighted-features', '0');
  await button(preview, '二维-三维联动').click();
  await expect(canvas).toHaveAttribute('data-highlighted-features', '0');
});

test('7-24 的三视图通过审核并绘制实心与半透明模型', async ({ page }) => {
  const preview = await openReconstruction(page, '7-24-THREE-VIEW-COMPLETE');
  await expect(preview).toHaveAttribute('data-scene-kind', 'SOLID');
  const canvas = preview.getByLabel('三维实体画布');
  await expect(preview.locator('summary')).toContainText('88 × 53 × 73 mm');
  expect(Number(await canvas.getAttribute('data-triangle-count'))).toBeGreaterThan(100);
  await painted(canvas);
  await captureCadReconstruction(page, '10-7-24-solid');
  const before = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
  await button(preview, '半透明').click();
  await expect(button(preview, '半透明')).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(() => canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL()))
    .not.toBe(before);
  await captureCadReconstruction(page, '11-7-24-translucent');
});
