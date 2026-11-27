import { expect, type Page } from '@playwright/test';
const groups: Record<string, string> = {
  无限辅助线: '构造',
  圆心圆弧: '圆弧工具',
  三点圆弧: '圆弧工具',
  新增投影轴: '构造',
  连接两点: '关系',
  投影关联: '关系',
  调整为平行: '关系',
  调整为垂直: '关系',
  平移: '选择方式',
  '框选（两次点击）': '选择方式',
  加选: '选择方式',
  减选: '选择方式',
  基准符号: '工程符号',
  表面粗糙度: '工程符号',
  形位公差: '工程符号',
  公差文本: '工程符号',
  '打开 JSON 或图纸包 ZIP': '文件',
  '导出 JSON': '文件',
  '下载图纸 JSON Schema': '文件',
  '导出展开图 SVG': '文件',
  导出关系描述: '文件',
};
export async function choose(page: Page, name: string) {
  if (name === '虚线') {
    // The line command uses the drawing pattern selected in the top bar.
    const close = page.getByRole('button', { name: '关闭对象属性', exact: true });
    if (await close.isVisible()) await close.click();
    await page.getByLabel('绘图线型', { exact: true }).selectOption('DASHED');
  }
  const names: Record<string, string> = {
    实线: '直线',
    虚线: '直线',
    辅助线: '无限辅助线',
    圆弧: '圆心圆弧',
  };
  const label = names[name] ?? name;
  const button = page.getByRole('button', { name: label, exact: true });
  if (!(await button.first().isVisible())) {
    if (label === '平行线' || label === '垂直线') await properties(page);
    else if (groups[label])
      await page.getByRole('button', { name: groups[label], exact: true }).click();
    else if (['放大', '缩小', '适应画布', '聚焦当前投影'].includes(label)) await settings(page);
  }
  await button.click();
}
export async function draw(page: Page, tool: string, x = 150, y = 130) {
  await choose(page, tool);
  const svg = page.locator('.geo-active svg');
  const segmentsBefore = await svg.locator('[data-kind=segment]').count();
  await svg.click({ position: { x, y } });
  if (tool === '实线' || tool === '虚线') {
    // A pre-existing problem stem can already contain segments in an answer document.
    await expect(svg.locator('[data-kind=segment]')).toHaveCount(segmentsBefore);
    await svg.click({ position: { x: x + 47, y: y + 19 } });
    await page
      .getByRole('region', { name: 'CAD 命令' })
      .getByRole('button', { name: '完成', exact: true })
      .click();
  }
  if (tool === '辅助线') await svg.click({ position: { x: x + 40, y: y + 18 } });
}
export async function settings(page: Page) {
  if (!(await page.getByRole('dialog', { name: '视图与设置' }).isVisible()))
    await page.getByRole('button', { name: '视图/设置', exact: true }).click();
}
export async function closePanels(page: Page) {
  const close = page.getByRole('button', { name: '关闭面板', exact: true });
  if (await close.isVisible()) await close.click();
  const file = page.getByRole('button', { name: '文件', exact: true });
  if ((await file.count()) && (await file.getAttribute('aria-expanded')) === 'true')
    await file.click();
}
export async function properties(page: Page) {
  await choose(page, '选择');
  const edit = page.getByRole('button', { name: '编辑属性', exact: true });
  if (await edit.isVisible()) await edit.click();
  await expect(page.getByRole('dialog', { name: '对象属性', exact: true })).toBeVisible();
}
