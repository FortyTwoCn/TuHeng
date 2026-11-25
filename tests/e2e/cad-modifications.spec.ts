import { expect, test, type Locator } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { GeometryDocument } from '@tuheng/contracts';
import { addDrawing, createDocument, cubicAt, curveSegments, point } from '@tuheng/geometry-core';
import { at, setup, activateCommand as command } from './editor-fixture';

function fixture() {
  let d = createDocument('VHW_PROJECTION');
  for (const [x1, y1, x2, y2] of [
    [10, 25, 50, 25],
    [20, 15, 20, 36],
    [40, 15, 40, 36],
  ])
    d = addDrawing(
      d,
      'segment',
      'view-0',
      [
        { x: x1, y: y1 },
        { x: x2, y: y2 },
      ],
      'student',
    );
  return d;
}
for (const [width, height, touch] of [
  [1366, 768, false],
  [390, 844, true],
  [1024, 768, true],
] as const) {
  test.describe('CAD 区段修剪 ' + width, () => {
    test.use({ hasTouch: touch, viewport: { width, height } });
    test('选择两条边界、预览并确认修剪，检查导出的节点和单步撤销', async ({ page }) => {
      await setup(page);
      const e = page.locator('[data-editor=a]');
      await e.evaluate((el) => {
        (el as HTMLElement).style.width = '100%';
        (el.nextElementSibling as HTMLElement).style.display = 'none';
      });
      const source = fixture();
      await e.getByLabel('加载几何 JSON').setInputFiles({
        name: 'trim.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(source)),
      });
      const doc = () => page.evaluate(() => window.editorFixture.documents()[0]!);
      await expect.poll(async () => (await doc()).entities).toHaveLength(9);
      const svg = e.locator('.geo-view svg');
      const hit = async (x: number, y: number) => {
        const p = await at(svg, x, y);
        if (touch) await page.touchscreen.tap(p.x, p.y);
        else await page.mouse.click(p.x, p.y);
      };
      const activate = (l: Locator) => (touch ? l.tap() : l.click());
      await command(e, 'trim', touch);
      await hit(-20, 19);
      await hit(-40, 19);
      await activate(e.getByRole('button', { name: '完成', exact: true }));
      await hit(-30, 25);
      expect(await doc()).toEqual(source);
      await expect(svg.locator('[data-kind="segment"]')).toHaveCount(4);
      mkdirSync('docs/evidence/cad', { recursive: true });
      await e.screenshot({
        path: 'docs/evidence/cad/trim-preview-' + width + '.png',
        animations: 'disabled',
      });
      await activate(e.getByRole('button', { name: '完成', exact: true }));
      const committed = await doc();
      const segments = committed.entities.filter((o) => o.kind === 'segment');
      expect(segments).toHaveLength(4);
      const outer = segments.filter((l) => point(committed, l.startPoint).y === 25);
      expect(
        outer
          .map((l) => [point(committed, l.startPoint).x, point(committed, l.endPoint).x])
          .sort((a, b) => a[0] - b[0]),
      ).toEqual([
        [10, 20],
        [40, 50],
      ]);
      const more = e.getByRole('button', { name: '更多', exact: true }),
        file = e.getByRole('button', { name: '文件', exact: true });
      await activate((await file.isVisible()) ? file : more);
      const downloaded = page.waitForEvent('download');
      await activate(e.getByRole('button', { name: '导出 JSON', exact: true }));
      const saved = GeometryDocument.parse(
        JSON.parse(readFileSync((await (await downloaded).path())!, 'utf8')),
      );
      expect(saved).toEqual(committed);
      await activate(e.getByRole('button', { name: '撤销', exact: true }));
      expect(await doc()).toEqual(source);
      await activate(e.getByRole('button', { name: '恢复', exact: true }));
      expect(await doc()).toEqual(saved);
    });
  });
}

for (const targetKind of ['circle', 'arc', 'ellipse', 'curve'] as const) {
  test('选取直线边界并修剪 ' + targetKind + '，重新加载保留精确区间', async ({ page }) => {
    await setup(page);
    const editor = page.locator('[data-editor=a]');
    await editor.evaluate((el) => {
      (el as HTMLElement).style.width = '100%';
    });
    const view = 'view-0';
    const marks = [
      { x: 15, y: 24 },
      { x: 30, y: 30 },
      { x: 45, y: 24 },
    ];
    const center = { x: 30, y: 25 };
    let source = addDrawing(
      createDocument('VHW_PROJECTION'),
      'segment',
      view,
      [
        { x: 30, y: 6 },
        { x: 30, y: 45 },
      ],
      'student',
    );
    let picked = { x: 40, y: 25 };
    if (targetKind === 'curve') {
      const pointIds: string[] = [];
      for (const m of marks) {
        source = addDrawing(source, 'point', view, [m], 'student');
        pointIds.push(source.entities.at(-1)!.id);
      }
      source.entities.push({
        kind: 'curve',
        id: 'target',
        viewId: view,
        lineStyle: 'ANSWER_VISIBLE',
        layerId: 'answer',
        pointIds,
        interpolation: 'CUBIC_HERMITE',
      });
      picked = cubicAt(curveSegments(marks)[1], 0.55);
    } else {
      source = addDrawing(source, 'point', view, [center], 'student');
      const base = {
        id: 'target',
        viewId: view,
        layerId: 'answer',
        lineStyle: 'ANSWER_VISIBLE' as const,
        center: source.entities.at(-1)!.id,
      };
      if (targetKind === 'ellipse') {
        source.entities.push({
          ...base,
          kind: 'ellipse',
          majorRadius: 13,
          minorRadius: 8,
          angle: 0,
          startAngle: 0,
          sweep: 360,
        });
        picked = { x: 43, y: 25 };
      } else if (targetKind === 'arc') {
        source.entities.push({ ...base, kind: 'arc', radius: 10, startAngle: 0, sweep: 180 });
        picked = { x: 30 + Math.sqrt(50), y: 25 + Math.sqrt(50) };
      } else source.entities.push({ ...base, kind: 'circle', radius: 10 });
    }
    const load = (drawing: GeometryDocument) =>
      editor.getByLabel('加载几何 JSON').setInputFiles({
        name: 'fragment.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(drawing)),
      });
    const doc = () => page.evaluate(() => window.editorFixture.documents()[0]!);
    await load(source);
    await expect.poll(doc).toEqual(source);
    await command(editor, 'trim', false);
    const click = async (p: { x: number; y: number }) => {
      const q = await at(editor.locator('.geo-view svg'), -p.x, p.y);
      await page.mouse.click(q.x, q.y);
    };
    const finish = editor.getByRole('button', { name: '完成', exact: true });
    await click({ x: 30, y: 11 });
    await finish.click();
    await click(picked);
    expect(await doc()).toEqual(source);
    await finish.click();
    const saved = await doc();
    const fragment = saved.entities.find((e) => e.id === 'target')!;
    if (targetKind === 'curve') {
      expect(fragment).toMatchObject({
        kind: 'curve',
        interpolation: 'CUBIC_HERMITE',
        parameterRange: [0, expect.closeTo(0.5, 6)],
      });
    } else
      expect(fragment).toMatchObject({
        kind: targetKind === 'ellipse' ? 'ellipse' : 'arc',
        startAngle: expect.closeTo(90, 6),
        sweep: expect.closeTo(targetKind === 'arc' ? 90 : 180, 6),
      });
    await editor.getByRole('button', { name: '撤销', exact: true }).click();
    await expect.poll(doc).toEqual(source);
    await load(saved);
    await expect.poll(doc).toEqual(saved);
  });
}
