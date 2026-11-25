import { expect, test, type Locator, type Page } from '@playwright/test';
import { point } from '@tuheng/geometry-core';
import { at, setup } from './editor-fixture';

async function tapControl(page: Page, control: Locator) {
  await control.scrollIntoViewIfNeeded();
  await expect(control).toBeEnabled();
  const box = (await control.boundingBox())!;
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1024, height: 768 },
]) {
  test.describe(`touch-only chain at ${viewport.width}×${viewport.height}`, () => {
    test.use({ hasTouch: true, viewport });
    test('taps four points, finishes from the status bar, then undoes and redoes the third segment', async ({
      page,
    }) => {
      await setup(page);
      const editor = page.locator('[data-editor=a]');
      await editor.evaluate((el) => {
        el.style.width = '100%';
        (el.nextElementSibling as HTMLElement).hidden = true;
      });
      const read = () => page.evaluate(() => window.editorFixture.documents()[0]!);
      const before = await read();
      const existing = new Set(before.entities.map((e) => e.id));
      await tapControl(page, editor.getByRole('button', { name: '直线', exact: true }));
      const canvas = editor.locator('.geo-view > svg');
      await canvas.scrollIntoViewIfNeeded();
      const box = (await canvas.boundingBox())!;
      const origin = await at(canvas, 0, 0);
      // This fixture has a clear area in the top-view quadrant (left of and below O).
      // Keep enough screen space between points at both scales for finger pick radii.
      const left = box.x + (origin.x - box.x) * 0.17;
      const right = box.x + (origin.x - box.x) * 0.81;
      const top = origin.y + (box.y + box.height - origin.y) * 0.22;
      const bottom = origin.y + (box.y + box.height - origin.y) * 0.68;
      const corners = [
        [left, top],
        [right, top],
        [right, bottom],
        [left, bottom],
      ];
      for (const [i, [x, y]] of corners.entries()) {
        expect(
          await canvas.evaluate((svg, p) => svg.contains(document.elementFromPoint(p.x, p.y)), {
            x,
            y,
          }),
        ).toBe(true);
        await page.touchscreen.tap(x, y);
        await expect
          .poll(
            async () =>
              (await read()).entities.filter((e) => e.kind === 'segment' && !existing.has(e.id))
                .length,
          )
          .toBe(i);
      }
      await tapControl(
        page,
        editor.locator('footer').getByRole('button', { name: '完成', exact: true }),
      );
      await expect(editor.locator('[data-transient="rubber-band"]')).toHaveCount(0);
      const saved = await read();
      const created = saved.entities.filter((e) => !existing.has(e.id));
      const segments = created.filter((e) => e.kind === 'segment');
      expect(segments).toHaveLength(3);
      expect(created.filter((e) => e.kind === 'point')).toHaveLength(4);
      expect(segments[1].startPoint).toBe(segments[0].endPoint);
      expect(segments[2].startPoint).toBe(segments[1].endPoint);
      expect(saved.entities.filter((e) => existing.has(e.id))).toEqual(before.entities);
      for (const edge of segments)
        expect(point(saved, edge.startPoint)).not.toEqual(point(saved, edge.endPoint));

      await tapControl(page, editor.getByRole('button', { name: '撤销', exact: true }));
      const afterUndo = (await read()).entities.filter((e) => !existing.has(e.id));
      expect(afterUndo.filter((e) => e.kind === 'segment')).toEqual(segments.slice(0, 2));
      expect(afterUndo.filter((e) => e.kind === 'point')).toHaveLength(3);
      await tapControl(page, editor.getByRole('button', { name: '恢复', exact: true }));
      expect(await read()).toEqual(saved);
    });
  });
}
