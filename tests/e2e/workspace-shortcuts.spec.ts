import { expect, test } from '@playwright/test';
import { activateCommand, at, setup } from './editor-fixture';

test.use({ viewport: { width: 1366, height: 900 } });

test('canvas Alt, F3 and the skip button recalculate a stationary endpoint candidate', async ({
  page,
}) => {
  await setup(page);
  const editor = page.locator('[data-editor=a]');
  const svg = editor.locator('.geo-view > svg');
  const snap = editor.locator('[data-snap-feedback=true]');
  const objectSnap = editor.getByRole('button', { name: '对象捕捉', exact: true });
  const docs = () => page.evaluate(() => window.editorFixture.documents());
  const before = (await docs())[0]!;
  await activateCommand(editor, 'point');
  const near = await at(svg, -29, 35);
  await page.mouse.move(near.x, near.y);
  await expect(snap).toBeVisible();
  await page.keyboard.down('Alt');
  await expect(snap).toHaveCount(0);
  await page.keyboard.up('Alt');
  await expect(snap).toBeVisible();
  await page.keyboard.press('F3');
  await expect(objectSnap).toHaveAttribute('aria-pressed', 'false');
  await expect(snap).toHaveCount(0);
  await page.keyboard.press('F3');
  await expect(snap).toBeVisible();
  await editor.getByRole('button', { name: '暂停当前吸附' }).click();
  await page.mouse.click(near.x, near.y);
  const drawn = (await docs())[0]!;
  expect(drawn.entities.length).toBe(before.entities.length + 1);
  const last = drawn.entities.at(-1);
  expect(last?.kind).toBe('point');
  if (last?.kind === 'point') expect(last.position.x).toBeCloseTo(29, 0);
  await expect(objectSnap).toHaveAttribute('aria-pressed', 'true');
});

test('pre-held Alt bypasses point drag snap, with the next gesture returning to normal', async ({
  page,
}) => {
  await setup(page);
  const editor = page.locator('[data-editor=a]');
  const svg = editor.locator('.geo-view > svg');
  const start = await at(svg, -30, 35),
    target = await at(svg, -10, 15);
  await svg.focus();
  await page.keyboard.down('Alt');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(target.x - 5, target.y, { steps: 8 });
  await expect(editor.locator('[data-snap-feedback=true]')).toHaveCount(0);
  await page.mouse.up();
  await page.keyboard.up('Alt');
  const docs = () => page.evaluate(() => window.editorFixture.documents());
  const lines = (await docs())[0]!.entities.filter((e) => e.kind === 'segment');
  expect(lines[0].endPoint).not.toBe(lines[1].startPoint);
  await svg.focus();
  await page.keyboard.press('Control+z');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(target.x - 5, target.y, { steps: 8 });
  await expect(editor.locator('[data-snap-feedback=true]')).toBeVisible();
  await page.mouse.up();
  const connected = (await docs())[0]!.entities.filter((e) => e.kind === 'segment');
  expect(connected[0].endPoint).toBe(connected[1].startPoint);
});

test('snap menu, F8 and F11 share editor-scoped state and leave text input alone', async ({
  page,
}) => {
  await setup(page);
  const first = page.locator('[data-editor=a]'),
    second = page.locator('[data-editor=b]');
  const svg = first.locator('.geo-view > svg');
  const objects = first.getByRole('button', { name: '对象捕捉', exact: true });
  await objects.click({ button: 'right' });
  let menu = first.getByRole('dialog', { name: '对象捕捉类型菜单' });
  await expect(menu.getByRole('checkbox')).toHaveCount(8);
  await menu.getByLabel('中点', { exact: true }).uncheck();
  await page.keyboard.press('Escape');
  await first.getByRole('button', { name: '对象捕捉类型', exact: true }).click();
  menu = first.getByRole('dialog', { name: '对象捕捉类型菜单' });
  await expect(menu.getByLabel('中点', { exact: true })).not.toBeChecked();
  await page.keyboard.press('Escape');
  await activateCommand(first, 'segment');
  const a = await at(svg, -44, 23),
    b = await at(svg, -8, 7);
  await page.mouse.click(a.x, a.y);
  await page.mouse.move(b.x, b.y);
  const angle = first.getByLabel('动态角度', { exact: true });
  await expect(first.getByLabel('动态长度', { exact: true })).not.toHaveValue('0.00');
  const freeAngle = await angle.inputValue();
  await page.keyboard.press('F8');
  await expect(first.getByRole('button', { name: '正交', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(angle).not.toHaveValue(freeAngle);
  await page.keyboard.press('F11');
  await expect(first.getByRole('button', { name: '对象捕捉追踪' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await angle.focus();
  await page.keyboard.press('F8');
  await expect(first.getByRole('button', { name: '正交', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(second.getByRole('button', { name: '正交', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(second.getByRole('button', { name: '对象捕捉追踪' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});

test('F11 applies and releases tracking at the current cursor without a second pointer move', async ({
  page,
}) => {
  await setup(page);
  const first = page.locator('[data-editor=a]');
  const svg = first.locator('.geo-view > svg');
  await activateCommand(first, 'point');
  const endpoint = await at(svg, -30, 35),
    alongside = await at(svg, -19, 35.6);
  await page.mouse.move(endpoint.x, endpoint.y);
  await expect(first.locator('[data-snap-feedback=true]')).toBeVisible();
  // The original drafting gesture acquires a base after hovering for about 400 ms.
  await page.waitForTimeout(450);
  await page.mouse.move(alongside.x, alongside.y);
  await expect(first.locator('[data-snap-feedback=true]')).toHaveCount(0);
  await page.keyboard.press('F11');
  await expect(first.locator('[data-snap-feedback=true]')).toContainText('水平追踪');
  await expect(first.locator('[data-transient=tracking]')).toHaveCount(1);
  await page.keyboard.press('F11');
  await expect(first.locator('[data-transient=tracking]')).toHaveCount(0);
  await expect(first.locator('[data-snap-feedback=true]')).toHaveCount(0);
});

test.describe('touch snap options', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test('opens the snap types by tapping the visible control', async ({ page }) => {
    await setup(page);
    const editor = page.locator('[data-editor=a]');
    const toggle = editor.getByRole('button', { name: '对象捕捉类型', exact: true });
    await toggle.tap();
    const menu = editor.getByRole('dialog', { name: '对象捕捉类型菜单' });
    const types = ['端点', '中点', '中心', '交点', '垂足', '切点', '象限点'];
    for (const type of types) await expect(menu.getByLabel(type, { exact: true })).toBeChecked();
    await menu.getByLabel('端点', { exact: true }).tap();
    await expect(menu.getByLabel('端点', { exact: true })).not.toBeChecked();
    await expect(editor.getByRole('button', { name: '对象捕捉', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
