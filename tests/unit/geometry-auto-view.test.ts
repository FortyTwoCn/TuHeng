import { describe, expect, it } from 'vitest';
import {
  addDrawing,
  addProjectionAxis,
  createDocument,
  drawingViewAt,
  localToSheet,
} from '@tuheng/geometry-core';

describe('automatic drawing projection on the shared sheet', () => {
  it.each(['VHW_PROJECTION', 'THREE_VIEW'] as const)(
    'uses geometry, not view names or list position in %s',
    (type) => {
      const doc = createDocument(type);
      doc.views.forEach((v, i) => {
        v.id = `imported-${i}`;
        v.name = `custom-${i}`;
      });
      doc.views.reverse();
      expect(drawingViewAt(doc, { x: -30, y: 40 })).toBe('imported-0');
      expect(drawingViewAt(doc, { x: -30, y: -20 })).toBe('imported-1');
      expect(drawingViewAt(doc, { x: 20, y: 40 })).toBe('imported-2');
    },
  );

  it('uses actual transformed regions and keeps the approached side on shared boundaries', () => {
    const doc = createDocument('VHW_PROJECTION');
    for (const v of doc.views) {
      const f = v.transform!;
      f.origin = { x: 50, y: 20 };
      f.xAxis = { x: -f.xAxis.y, y: f.xAxis.x };
      f.yAxis = { x: -f.yAxis.y, y: f.yAxis.x };
    }
    expect(drawingViewAt(doc, localToSheet(doc, 'view-1', { x: 30, y: -20 }))).toBe('view-1');
    const boundary = localToSheet(doc, 'view-1', { x: 30, y: 0 });
    expect(drawingViewAt(doc, boundary, 'view-1')).toBe('view-1');
    expect(drawingViewAt(doc, boundary, 'view-0')).toBe('view-0');
    expect(drawingViewAt(doc, { x: 50, y: 20 }, 'view-2')).toBe('view-2');
  });

  it('assigns the unused lower-right area to the nearest region without changing existing objects', () => {
    let doc = createDocument('VHW_PROJECTION');
    expect(drawingViewAt(doc, { x: 10, y: -40 })).toBe('view-1');
    expect(drawingViewAt(doc, { x: 40, y: -10 })).toBe('view-2');
    doc = addDrawing(doc, 'point', 'view-0', [{ x: -30, y: -20 }], 'student');
    expect(drawingViewAt(doc, { x: 30, y: -20 }, undefined, doc.entities[0].id)).toBe('view-0');
  });

  it('subdivides the retained region by the actual unfold side, including a second level', () => {
    let doc = addProjectionAxis(
      createDocument('VHW_PROJECTION'),
      {
        name: 'X1',
        viewName: 'V1',
        retainedViewId: 'view-1',
        replacedViewId: 'view-0',
        parentId: null,
        method: 'FREE',
        referenceEntityId: null,
        anchor: { x: -50, y: -35 },
        through: { x: -30, y: -35 },
        side: -1,
      },
      'student',
    );
    const first = doc.auxiliarySystems![0];
    expect(drawingViewAt(doc, { x: -30, y: -20 })).toBe('view-1');
    expect(drawingViewAt(doc, { x: -30, y: -45 })).toBe(first.newViewId);
    expect(drawingViewAt(doc, { x: -30, y: 40 })).toBe('view-0');
    doc = addProjectionAxis(
      doc,
      {
        name: 'X2',
        viewName: 'H1',
        retainedViewId: first.newViewId,
        replacedViewId: 'view-1',
        parentId: first.id,
        method: 'FREE',
        referenceEntityId: null,
        anchor: { x: -60, y: -45 },
        through: { x: -60, y: -25 },
        side: 1,
      },
      'student',
    );
    const second = doc.auxiliarySystems![1];
    expect(drawingViewAt(doc, { x: -70, y: -45 })).toBe(second.newViewId);
    expect(drawingViewAt(doc, { x: -40, y: -45 })).toBe(first.newViewId);
    expect(drawingViewAt(doc, { x: -70, y: -20 })).toBe('view-1');
    expect(drawingViewAt(doc, { x: -60, y: -45 }, second.newViewId)).toBe(second.newViewId);
  });

  it.each(['ISOMETRIC', 'OBLIQUE_DIMETRIC'] as const)(
    'keeps the single %s frame at any position',
    (type) => {
      const doc = createDocument(type);
      expect(drawingViewAt(doc, { x: 30, y: -20 })).toBe(doc.views[0].id);
      expect(drawingViewAt(doc, { x: -30, y: 20 })).toBe(doc.views[0].id);
    },
  );
});
