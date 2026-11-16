import { describe, expect, it } from 'vitest';
import { GeometryDocument, type Vec2 } from '@tuheng/contracts';
import {
  addDrawing,
  addProjectionAxis,
  addPenStroke,
  createDocument,
  lineGeometry,
  localToSheet,
  penLinePreview,
  point,
  sub,
  dot,
  unit,
  referenceGeometry,
  sheetDeltaToLocal,
  type PenStrokeStyle,
} from '@tuheng/geometry-core';
import { acceptPrimitive } from '../../packages/geometry-editor/src/primitive-preview';
import { penSample } from '../repair-fixtures';

function stroke(degrees: number, pixels = 4, length = 180, start: Vec2 = { x: 80, y: 80 }) {
  const a = (degrees * Math.PI) / 180;
  return Array.from({ length: 81 }, (_, i) => {
    const t = i / 80,
      x = (t * length) / pixels;
    const noise = (Math.sin(i * 0.8) * Math.sin(t * Math.PI) * 0.35) / pixels;
    return {
      x: start.x + x * Math.cos(a) - noise * Math.sin(a),
      y: start.y + x * Math.sin(a) + noise * Math.cos(a),
      pressure: 0.5,
    };
  });
}
function apply(
  base: GeometryDocument,
  raw: GeometryDocument,
  pixels = 4,
  options: Parameters<typeof penLinePreview>[3] = {},
) {
  const preview = penLinePreview(base, raw, pixels, options);
  expect(preview).toBeDefined();
  return { preview: preview!, next: acceptPrimitive(base, raw, preview!, 'student') };
}

describe('pen direction correction after fitting', () => {
  it.each(['visible', 'hidden', 'construction'] as PenStrokeStyle[])(
    'corrects near-orthogonal %s strokes at every scale and in both directions',
    (style) => {
      for (const pixels of [2, 4, 8])
        for (const length of [20, 180, 600]) {
          for (const degrees of [4, -4, 86, 94, 176, 184, 266, 274]) {
            const base = createDocument('VHW_PROJECTION');
            const samples = stroke(degrees, pixels, length);
            const raw = addPenStroke(base, 'view-0', samples, 'student', {
              cssPixelsPerMm: pixels,
              style,
            });
            const before = structuredClone(raw);
            const { preview, next } = apply(base, raw, pixels);
            const e = next.entities.at(-1)!;
            const d = unit(lineGeometry(next, e).d);
            const horizontal = Math.abs(Math.sin((degrees * Math.PI) / 180)) < 0.5;
            expect(Math.abs(horizontal ? d.y : d.x)).toBeLessThan(1e-12);
            expect(preview.directionLabel).toBe(horizontal ? '水平' : '垂直');
            expect(dot(lineGeometry(raw, raw.entities.at(-1)!).d, d)).toBeGreaterThan(0);
            expect(e).toMatchObject({
              kind: style === 'construction' ? 'line' : 'segment',
              samples,
            });
            expect(raw).toEqual(before);
            expect(GeometryDocument.safeParse(next).success).toBe(true);
          }
        }
    },
  );

  it('preserves oblique intent outside the angular tolerance and explicit ruler directions', () => {
    const base = createDocument('VHW_PROJECTION');
    for (const style of ['visible', 'hidden', 'construction'] as const) {
      for (const degrees of [9, 20, 45, 78]) {
        const raw = addPenStroke(base, 'view-0', stroke(degrees), 'student', {
          cssPixelsPerMm: 4,
          style,
        });
        const { next, preview } = apply(base, raw);
        expect(preview.directionLabel).toBeUndefined();
        expect(unit(lineGeometry(next, next.entities.at(-1)!).d).x).toBeCloseTo(
          unit(lineGeometry(raw, raw.entities.at(-1)!).d).x,
          12,
        );
      }
    }
    for (const options of [{ axes: false }, { direction: false }]) {
      const raw = addPenStroke(base, 'view-0', stroke(4), 'student');
      const { preview, next } = apply(base, raw, 4, options);
      expect(preview.directionLabel).toBeUndefined();
      expect(next).toEqual(raw);
    }
  });

  it('reuses a nearby blue anchor without letting endpoint positioning tilt the corrected line', () => {
    let base = addDrawing(
      createDocument('VHW_PROJECTION'),
      'point',
      'view-0',
      [{ x: 80, y: 80 }],
      'teacher',
    );
    base = addDrawing(base, 'point', 'view-0', [{ x: 125, y: 83.5 }], 'teacher');
    // End is far enough from the second point that it is not an explicit endpoint selection.
    const raw = addPenStroke(base, 'view-0', stroke(4, 4, 160, { x: 80.4, y: 80.2 }), 'student');
    const { next } = apply(base, raw);
    const segment = next.entities.at(-1)!;
    if (segment.kind !== 'segment') throw Error();
    expect(segment.startPoint).toBe(base.entities[0].id);
    expect(point(next, segment.endPoint).y).toBe(80);
    expect(next.entities.slice(0, 2)).toEqual(base.entities);
    expect(next.entities).toHaveLength(4);
    expect(raw.entities).toHaveLength(5); // snap recovery retains independent original endpoints
  });

  it('keeps both explicit targets when their connecting line is deliberately oblique', () => {
    let base = addDrawing(
      createDocument('VHW_PROJECTION'),
      'point',
      'view-0',
      [{ x: 80, y: 80 }],
      'teacher',
    );
    base = addDrawing(base, 'point', 'view-0', [{ x: 120, y: 82.8 }], 'teacher');
    const raw = addPenStroke(base, 'view-0', stroke(4, 4, 160), 'student');
    const { next, preview } = apply(base, raw);
    expect(preview.directionLabel).toBeUndefined();
    expect(next.entities.at(-1)).toMatchObject({
      startPoint: base.entities[0].id,
      endPoint: base.entities[1].id,
    });
    expect(next.entities.slice(0, 2)).toEqual(base.entities);
    expect(next.entities).toHaveLength(3);
  });

  it('uses sheet reference geometry even when the local frame is rotated and translated', () => {
    const base = createDocument('VHW_PROJECTION');
    base.views[0].transform = {
      origin: { x: 25, y: -15 },
      xAxis: { x: Math.SQRT1_2, y: Math.SQRT1_2 },
      yAxis: { x: -Math.SQRT1_2, y: Math.SQRT1_2 },
    };
    const raw = addPenStroke(base, 'view-0', stroke(49), 'student');
    const { next, preview } = apply(base, raw);
    const e = next.entities.at(-1)!;
    if (e.kind !== 'segment') throw Error();
    const delta = sub(
      localToSheet(next, e.viewId, point(next, e.endPoint)),
      localToSheet(next, e.viewId, point(next, e.startPoint)),
    );
    expect(Math.abs(delta.x)).toBeLessThan(1e-10);
    expect(preview.directionLabel).toBe('垂直');
  });

  it('follows the actual axonometric and new projection axes instead of inventing screen-only axes', () => {
    const changed = addProjectionAxis(
      createDocument('VHW_PROJECTION'),
      {
        name: 'X1',
        viewName: 'V1',
        retainedViewId: 'view-1',
        replacedViewId: 'view-0',
        parentId: null,
        method: 'FREE',
        referenceEntityId: null,
        anchor: { x: 12, y: 8 },
        through: { x: 22, y: 18 },
        side: 1,
      },
      'student',
    );
    for (const base of [createDocument('ISOMETRIC'), createDocument('OBLIQUE_DIMETRIC'), changed]) {
      const references = referenceGeometry(base).filter(
        (r) =>
          r.direction &&
          (base === changed ? r.ref.kind === 'projectionAxis' : r.ref.kind === 'baseAxis'),
      );
      for (const r of references) {
        const expected = unit(sheetDeltaToLocal(base, 'view-0', r.direction!));
        const degrees = (Math.atan2(expected.y, expected.x) * 180) / Math.PI + 4;
        const raw = addPenStroke(base, 'view-0', stroke(degrees), 'student');
        const { next } = apply(base, raw);
        const d = unit(lineGeometry(next, next.entities.at(-1)!).d);
        expect(Math.abs(dot(d, expected))).toBeCloseTo(1, 12);
      }
    }
  });

  it('does not join hidden or different-view points during direction correction', () => {
    for (const differentView of [false, true]) {
      const base = addDrawing(
        createDocument('VHW_PROJECTION'),
        'point',
        differentView ? 'view-1' : 'view-0',
        [{ x: 80, y: 80 }],
        'teacher',
      );
      const raw = addPenStroke(base, 'view-0', stroke(4), 'student');
      const { next } = apply(base, raw, 4, differentView ? {} : { hiddenLayers: ['stem'] });
      const e = next.entities.at(-1)!;
      if (e.kind !== 'segment') throw Error();
      expect(e.startPoint).not.toBe(base.entities[0].id);
      expect(next.entities[0]).toEqual(base.entities[0]);
    }
  });

  it('leaves circles, arcs, free curves and unreliable raw strokes in their existing fit paths', () => {
    const base = createDocument('VHW_PROJECTION');
    const inputs = [
      penSample(4, 1),
      penSample(4, 1, 120),
      Array.from({ length: 121 }, (_, i) => ({
        x: 80 + i * 0.4,
        y: 80 + 9 * Math.sin((i * Math.PI * 2) / 120),
        pressure: 0.5,
      })),
      penSample(4, 1, 360, 'eight'),
    ];
    for (const [index, samples] of inputs.entries()) {
      const raw = addPenStroke(base, 'view-0', samples, 'student');
      expect(raw.entities.at(-1)?.kind).toBe(['circle', 'arc', 'curve', 'polyline'][index]);
      expect(penLinePreview(base, raw, 4, {})).toBeUndefined();
    }
  });
});
