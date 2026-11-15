import { describe, it, expect } from 'vitest';
import { GeometryDocument } from '@tuheng/contracts';
import {
  addPenStroke,
  createDocument,
  projectionAxes,
  fitStroke,
  loadGeometryDocument,
  serializeGeometryDocument,
  moveEntities,
} from '@tuheng/geometry-core';
import { finishDrawing } from '../../packages/geometry-editor/src/drawing-session';
import { penSample } from '../repair-fixtures';
describe('oblique axes and pen regressions', () => {
  it('uses a left-down half-scale depth axis for new engineering oblique drawings', () => {
    const d = createDocument('OBLIQUE_DIMETRIC'),
      a = projectionAxes(d);
    expect(a.x).toEqual({ x: 1, y: 0 });
    expect(a.z).toEqual({ x: 0, y: 1 });
    expect(a.y.x).toBeCloseTo(-Math.SQRT1_2 / 2);
    expect(a.y.y).toBeCloseTo(-Math.SQRT1_2 / 2);
  });
  it('preserves explicit historical oblique configuration on loading', () => {
    const d = createDocument('OBLIQUE_DIMETRIC');
    d.projectionConfig.depthAngle = 45;
    expect(loadGeometryDocument(serializeGeometryDocument(d))).toEqual(d);
  });
  it.each([2, 3, 5])(
    'fits a short %s-sample straight stroke instead of requiring six events',
    (count) => {
      const pts = Array.from({ length: count }, (_, i) => ({ x: (i * 3) / (count - 1), y: 0 }));
      expect(fitStroke(pts, { cssPixelsPerMm: 4 }).kind).toBe('segment');
    },
  );
  it('fits a nearly straight dense stroke with subpixel hand tremor', () => {
    const pts = Array.from({ length: 160 }, (_, i) => ({
      x: i * 0.1,
      y: Math.sin(i * 1.7) * 0.15,
    }));
    expect(fitStroke(pts, { cssPixelsPerMm: 4 }).kind).toBe('segment');
  });
  it('keeps the recovery snapshot identical to an unfitted stroke including sampling evidence', () => {
    const samples = penSample(4, 1, 360, 'ellipse'),
      doc = createDocument('VHW_PROJECTION');
    const result = finishDrawing(doc, {
      tool: 'pen',
      viewId: 'view-0',
      role: 'student',
      start: samples[0],
      end: samples.at(-1)!,
      steps: [],
      samples,
      scale: 4,
    });
    expect(result.kind).toBe('document');
    if (result.kind !== 'document') throw Error();
    expect(result.document.entities.at(-1)?.kind).toBe('polyline');
    expect(result.rawStroke).toEqual(result.document);
    expect(GeometryDocument.safeParse(result.document).success).toBe(true);
  });
});
describe('pen styles share fitting, evidence and permissions', () => {
  for (const style of ['visible', 'hidden', 'construction'] as const) {
    for (const kind of ['segment', 'circle', 'arc', 'polyline'] as const) {
      it(`creates ${kind} in ${style} style and restores the same styled raw stroke`, () => {
        const samples =
          kind === 'segment'
            ? [
                { x: 20, y: 25, pressure: 0.5 },
                { x: 23, y: 25, pressure: 0.5 },
              ]
            : penSample(
                4,
                -1,
                kind === 'arc' ? 160 : 360,
                kind === 'polyline' ? 'eight' : 'circle',
              );
        const result = finishDrawing(createDocument('OBLIQUE_DIMETRIC'), {
          tool: 'pen',
          viewId: 'view-0',
          role: 'student',
          start: samples[0],
          end: samples.at(-1)!,
          steps: [],
          samples,
          scale: 4,
          penStyle: style,
        });
        if (result.kind !== 'document') throw Error('expected a finished stroke');
        const entity = result.document.entities.at(-1)!;
        const expectedKind = style === 'construction' && kind === 'segment' ? 'line' : kind;
        const lineStyle =
          style === 'construction'
            ? 'CONSTRUCTION'
            : style === 'hidden'
              ? 'ANSWER_HIDDEN'
              : 'ANSWER_VISIBLE';
        expect(entity).toMatchObject({
          kind: expectedKind,
          lineStyle,
          samples,
          sampling: { cssPixelsPerMm: 4 },
        });
        expect(result.rawStroke?.entities.at(-1)).toMatchObject({
          kind: 'polyline',
          lineStyle,
          samples,
        });
        const serialized = serializeGeometryDocument(result.document);
        expect(serializeGeometryDocument(loadGeometryDocument(serialized))).toBe(serialized);
        if (entity.kind === 'line') {
          expect(Math.hypot(entity.direction.x, entity.direction.y)).toBeCloseTo(1);
          expect(result.document.entities).toHaveLength(1);
        }
      });
    }
  }
  it.each(['visible', 'hidden', 'construction'] as const)(
    'keeps teacher %s pen geometry on the protected stem layer',
    (style) => {
      const samples = [
        { x: 20, y: 25, pressure: 0.5 },
        { x: 24, y: 25, pressure: 0.5 },
      ];
      const doc = addPenStroke(createDocument('VHW_PROJECTION'), 'view-0', samples, 'teacher', {
        cssPixelsPerMm: 4,
        style,
      });
      expect(
        doc.entities.every((e) => e.layerId === 'stem' && e.lineStyle.startsWith('PROBLEM')),
      ).toBe(true);
      expect(() =>
        moveEntities(doc, [doc.entities.at(-1)!.id], { x: 2, y: 3 }, 'student'),
      ).toThrow();
    },
  );
  it.each([2, 4, 8])('fits the same 12 CSS pixel sparse stroke at %s px/mm', (scale) => {
    expect(
      fitStroke(
        [
          { x: 0, y: 0 },
          { x: 12 / scale, y: 0.1 / scale },
        ],
        { cssPixelsPerMm: scale },
      ).kind,
    ).toBe('segment');
    expect(
      fitStroke(
        [
          { x: 0, y: 0 },
          { x: 3 / scale, y: 0 },
        ],
        { cssPixelsPerMm: scale },
      ).kind,
    ).toBe('polyline');
  });
  it('rejects a straight-looking backtracking scribble', () => {
    const samples = [0, 10, 3, 12, 1, 15].map((x) => ({ x, y: 0 }));
    expect(fitStroke(samples, { cssPixelsPerMm: 4 }).kind).toBe('polyline');
  });
});
