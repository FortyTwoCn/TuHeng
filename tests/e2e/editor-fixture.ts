import { expect, type Page, type Locator } from '@playwright/test';
import { build } from 'esbuild';
let script = '',
  css = '';
async function bundleFixture() {
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
}
export async function setup(page: Page) {
  if (!script) await bundleFixture();
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
export async function at(svg: Locator, x: number, y: number) {
  return svg.evaluate(
    (e, p) => {
      const q = new DOMPoint(p.x, -p.y).matrixTransform((e as SVGSVGElement).getScreenCTM()!);
      return { x: q.x, y: q.y };
    },
    { x, y },
  );
}

export async function activateCommand(editor: Locator, id: string, touch = false) {
  const action = (button: Locator) => (touch ? button.tap() : button.click());
  const groups: Record<string, string> = {
    leftDirection: '向视符号',
    rightDirection: '向视符号',
    datum: '工程符号',
    roughness: '工程符号',
    toleranceFrame: '工程符号',
    toleranceText: '工程符号',
    arc3: '圆弧工具',
    line: '构造',
    connect: '关系',
    box: '选择方式',
    pan: '选择方式',
  };
  const control =
    id === 'clear'
      ? editor.getByRole('button', { name: '清空可编辑图形' })
      : editor.locator('[data-command="' + id + '"]:visible').first();
  if (!(await control.count()) && groups[id])
    await action(editor.getByRole('button', { name: groups[id], exact: true }));
  await action(control);
}
export async function openParameters(editor: Locator) {
  const menu = editor.getByRole('dialog', { name: '精确输入与参数菜单' });
  if (!(await menu.isVisible()))
    await editor.getByRole('button', { name: '精确输入与参数', exact: true }).click();
  return menu;
}
