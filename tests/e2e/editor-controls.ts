import { expect, type Page } from '@playwright/test';
const groups: Record<string, string> = {
  实线: '线工具',
  虚线: '线工具',
  辅助线: '构造',
  连接两点: '关系',
  圆: '圆与圆弧',
  圆弧: '圆与圆弧',
  平行线: '构造',
  垂直线: '构造',
  新增投影轴: '构造',
  平移: '选择与平移',
  '框选（两次点击）': '选择与平移',
  投影关联: '关系',
  调整为平行: '关系',
  调整为垂直: '关系',
  '导出 JSON': '文件',
  '导出展开图 SVG': '文件',
  导出关系描述: '文件',
};
export async function choose(page: Page, name: string) {
  let button = page.getByRole('button', { name, exact: true });
  if (!(await button.first().isVisible())) {
    if (name === '完整展开图') {
      await choose(page, '适应画布');
      await closePanels(page);
      return;
    }
    if (['放大', '缩小', '适应画布', '聚焦当前投影'].includes(name)) await settings(page);
    else if (groups[name] || ['点','电子笔','吸附开关'].includes(name)) {
      const compact=await page.getByRole('button',{name:'绘图',exact:true}).isVisible();
      let group=groups[name];
      if(compact)group=['导出 JSON','导出展开图 SVG','导出关系描述','吸附开关'].includes(name)?'更多':['平行线','垂直线','新增投影轴','投影关联','连接两点','调整为平行','调整为垂直','辅助线'].includes(name)?'构造':'绘图';
      await page.getByRole('button',{name:group,exact:true}).click();
    }
  }
  button = page.getByRole('button', { name, exact: true });
  // A split-tool has both its last-used button and its menu item.
  if ((await button.count()) > 1)
    button = page.locator('.geo-popover').getByRole('button', { name, exact: true });
  await button.click();
}
export async function settings(page: Page) {
  if (!(await page.getByRole('dialog', { name: '视图与设置' }).isVisible()))
    {const button=page.getByRole('button', { name: '视图/设置', exact: true });if(!await button.isVisible())await page.getByRole('button',{name:'更多',exact:true}).click();await button.click();}
}
export async function closePanels(page: Page) {
  const close = page.getByRole('button', { name: '关闭面板', exact: true });
  if (await close.isVisible()) await close.click();
  const file = page.getByRole('button', { name: '文件', exact: true });
  if (await file.count() && (await file.getAttribute('aria-expanded')) === 'true') await file.click();
  const more=page.getByRole('button',{name:'更多',exact:true});if(await more.count()&&(await more.getAttribute('aria-expanded'))==='true')await more.click();
}
export async function properties(page: Page) {
  await choose(page, '选择');
  const edit = page.getByRole('button', { name: '编辑属性', exact: true });
  if (await edit.isVisible()) await edit.click();
  await expect(page.getByRole('dialog', { name: '对象属性', exact: true })).toBeVisible();
}
