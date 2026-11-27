import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { loadGeometryDocument, localToSheet, point } from '@tuheng/geometry-core';
import { dxfFixture, dxfLine } from '../dxf-fixtures';
import { choose, draw } from './editor-controls';
import { at } from './editor-fixture';
import { prepareLogin } from './identity-login';

test.use({ viewport: { width: 1366, height: 900 } });

async function login(page: Page, destination = '/geometry') {
  const email = await prepareLogin(page, 'student', destination);
  await email.fill('student@tuheng.local');
  await page.getByLabel('密码', { exact: true }).fill(process.env.SEED_PASSWORD!);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(destination);
}

async function selectTwoPlane(page: Page) {
  await page.getByLabel('图纸类型').selectOption({ label: '两面投影（V/H，仅 X-O 轴）' });
  await expect(page.locator('.geometry-editor')).toHaveAttribute('data-workspace-ready', 'true');
}

function canvas(page: Page) {
  return page.getByLabel('统一展开图绘图区');
}

async function clickOnSheet(page: Page, x: number, y: number) {
  const position = await at(canvas(page), x, y);
  await page.mouse.click(position.x, position.y);
}

async function download(page: Page, action: string) {
  const downloading = page.waitForEvent('download');
  await choose(page, action);
  return await downloading;
}

async function importDxf(page: Page, contents: string | Buffer, replace = false) {
  await choose(page, '导入 DXF');
  const dialog = page.getByRole('dialog', { name: '导入 DXF', exact: true });
  if (replace) await dialog.getByLabel('导入方式').selectOption({ label: '替换当前可编辑图层' });
  await dialog.getByLabel('选择 DXF 文件').setInputFiles({
    name: 'drawing.dxf',
    mimeType: 'application/dxf',
    buffer: Buffer.from(contents),
  });
  await dialog.getByRole('button', { name: '导入图形', exact: true }).click();
  return dialog;
}

test('两面投影仅显示 X-O 轴并能在上下两面绘制、导出和重载', async ({ page }) => {
  await login(page);
  await selectTwoPlane(page);
  const view = canvas(page);
  const axis = view.locator('[data-reference-id^="axis:"]');
  await expect(axis).toHaveCount(1);
  await expect(axis).toHaveAttribute('data-reference-id', 'axis:X');
  await expect(axis).toContainText('X-O');
  await expect(view.locator('[data-reference-id^="origin:"]')).toContainText('O');
  await expect(view.locator('[data-projection-face]')).toHaveText(['V', 'H']);
  expect(await axis.locator('line').getAttribute('y1')).toEqual(
    await axis.locator('line').getAttribute('y2'),
  );
  for (const [x, y, label] of [
    [11, 24, 'V'],
    [11, -24, 'H'],
  ] as const) {
    await choose(page, '点');
    await clickOnSheet(page, x, y);
    await expect(page.getByLabel('图纸坐标')).toContainText(label + ' · X');
  }
  await expect(view.locator('[data-kind="point"]')).toHaveCount(2);
  const json = await download(page, '导出 JSON');
  const document = loadGeometryDocument(readFileSync(await json.path(), 'utf8'));
  expect(document.editorType).toBe('VH_PROJECTION');
  expect(document.entities.map((entity) => entity.viewId)).toEqual(['view-0', 'view-1']);
  const svg = readFileSync(await (await download(page, '导出展开图 SVG')).path(), 'utf8');
  expect(svg).toContain('data-reference-id="axis:X"');
  expect(svg).not.toMatch(/axis:(Z|Y_W|Y_H|MITER_45)/);
  await page.reload();
  await page.getByLabel('加载几何 JSON').setInputFiles(await json.path());
  await expect(page.getByLabel('图纸类型')).toHaveValue('VH_PROJECTION');
  await expect(view.locator('[data-kind="point"]')).toHaveCount(2);
  await expect(axis).toHaveCount(1);
});

test('真实作图的直线、圆和点通过 DXF 恢复并可撤销', async ({ page }) => {
  await login(page);
  await selectTwoPlane(page);
  const view = canvas(page);
  await draw(page, '实线', 210, 120);
  await expect(view.locator('[data-kind="segment"]')).toHaveCount(1);
  await choose(page, '圆');
  await clickOnSheet(page, -31, -17);
  await clickOnSheet(page, -23, -17);
  await choose(page, '点');
  await clickOnSheet(page, -8, -30);
  await expect(view.locator('[data-kind="segment"]')).toHaveCount(1);
  await expect(view.locator('[data-kind="circle"]')).toHaveCount(1);
  await expect(view.locator('[data-kind="point"]')).toHaveCount(4);
  const exported = await download(page, '导出 DXF');
  expect(exported.suggestedFilename()).toBe('tuheng.dxf');
  await page.getByRole('button', { name: '清空可编辑图形', exact: true }).click();
  await page
    .getByRole('region', { name: 'CAD 命令' })
    .getByRole('button', { name: '完成', exact: true })
    .click();
  await expect(view.locator('[data-entity-id]')).toHaveCount(0);
  const dialog = await importDxf(page, readFileSync(await exported.path()));
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.cad-step-message')).toContainText('已导入 6 个 DXF 对象');
  await expect(view.locator('[data-kind="segment"]')).toHaveCount(1);
  await expect(view.locator('[data-kind="circle"]')).toHaveCount(1);
  await expect(view.locator('[data-kind="point"]')).toHaveCount(4);
  await expect(view.locator('[data-reference-id^="axis:"]')).toHaveCount(1);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(view.locator('[data-entity-id]')).toHaveCount(0);
  await page.getByRole('button', { name: '恢复', exact: true }).click();
  await expect(view.locator('[data-entity-id]')).toHaveCount(6);

  const far = dxfFixture(dxfLine({ x: 3900, y: 2400 }, { x: 3925, y: 2412 }));
  await expect(await importDxf(page, far, true)).not.toBeVisible();
  const fitted = view.locator('[data-kind="segment"] line');
  await expect(fitted).toBeVisible();
  expect((await fitted.boundingBox())!.width).toBeGreaterThan(50);
  const saved = loadGeometryDocument(
    readFileSync(await (await download(page, '导出 JSON')).path(), 'utf8'),
  );
  const segment = saved.entities.find((entity) => entity.kind === 'segment')!;
  expect(localToSheet(saved, segment.viewId, point(saved, segment.startPoint))).toEqual({
    x: 3900,
    y: 2400,
  });
});

test('自测两面投影锁住题干，作答导入显示忽略明细，快照只开放 DXF 导出', async ({ page }) => {
  await login(page, '/student/selftests/new');
  const title = '两面投影自测 ' + Date.now();
  await page.getByLabel('题目名称').fill(title);
  await page.getByLabel('题目要求').fill('补全 H 面，保持长对正。');
  await page.getByLabel('作答方式').selectOption('VH_PROJECTION');
  const stemFile = dxfFixture(dxfLine({ x: -28, y: 16 }, { x: -10, y: 26 }));
  await expect(await importDxf(page, stemFile)).not.toBeVisible();
  await expect(
    canvas(page).locator('[data-kind="segment"][data-style="PROBLEM_VISIBLE"]'),
  ).toHaveCount(1);
  await page.getByLabel('参考作图与关键步骤').fill('V/H 两面沿 X-O 轴展开。');
  await page.getByRole('button', { name: '保存私人题集', exact: true }).click();
  await expect(page).toHaveURL('/student/selftests');
  await page.getByRole('link', { name: new RegExp(title) }).click();
  const stem = canvas(page).locator('[data-kind="segment"][data-style="PROBLEM_VISIBLE"]');
  await expect(stem).toHaveCount(1);
  const stemId = await stem.getAttribute('data-entity-id');
  const file = dxfFixture([
    ...dxfLine({ x: -28, y: -16 }, { x: -10, y: -26 }, 'TH_PROBLEM_STEM'),
    [0, '3DSOLID'],
  ]);
  const dialog = await importDxf(page, file, true);
  await expect(dialog.getByRole('status')).toContainText('忽略 1 个对象');
  await expect(dialog.getByText('3DSOLID × 1，不支持的实体')).toBeVisible();
  await dialog.getByRole('button', { name: '完成', exact: true }).click();
  await expect(stem).toHaveAttribute('data-entity-id', stemId!);
  await expect(
    canvas(page).locator('[data-kind="segment"][data-style="ANSWER_VISIBLE"]'),
  ).toHaveCount(1);
  page.once('dialog', (confirmation) => confirmation.accept());
  await page.getByRole('button', { name: '正式提交并排队批改', exact: true }).click();
  await expect(page).toHaveURL(/\/student\/results\//);
  await expect(canvas(page).locator('[data-projection-face]')).toHaveText(['V', 'H']);
  await page.getByRole('button', { name: '文件', exact: true }).click();
  await expect(page.getByRole('button', { name: '导入 DXF', exact: true })).toHaveCount(0);
  const exported = await download(page, '导出 DXF');
  expect(exported.suggestedFilename()).toBe('tuheng.dxf');
});
