import { describe, expect, it } from 'vitest';
import { GeometryDocument } from '@tuheng/contracts';
import {
  createDocument,
  addDrawing,
  addCurve,
  curveSegments,
  curvePath,
  point,
  snapCandidates,
  confirmSnap,
  moveEntities,
  mergePoints,
  copyEntities,
  deleteEntities,
  exportSheetSvg,
  exportGeometryNarrative,
  serializeGeometryDocument,
  loadGeometryDocument,
  combineAnswer,
  fitStroke,
  addPenStroke,
  snapPenCurve,
} from '@tuheng/geometry-core';

import {
  curveClick,
  commitCurve,
  type CurveDraft,
} from '../../packages/geometry-editor/src/curve-session';

const knots = [
  { x: 10, y: 10 },
  { x: 20, y: 25 },
  { x: 40, y: 10 },
];
const sStroke = () =>
  Array.from({ length: 121 }, (_, i) => ({
    x: 10 + i * 0.4,
    y: 25 + 9 * Math.sin((i * Math.PI * 2) / 120),
    pressure: 0.5,
  }));

describe('interpolating curves and common reference snapping', () => {
  it('keeps endpoint/through-point selection as a draft, accepts either finish endpoint and refuses cross-view endpoints', () => {
    let base = addDrawing(
      createDocument('VHW_PROJECTION'),
      'point',
      'view-0',
      [knots[0]],
      'teacher',
    );
    base = addDrawing(base, 'point', 'view-1', [knots[2]], 'student');
    const original = structuredClone(base);
    let draft: CurveDraft | null = curveClick(
      base,
      null,
      'view-0',
      knots[0],
      base.entities[0].id,
      4,
      true,
      {},
    );
    expect(() =>
      curveClick(base, draft, 'view-0', knots[2], base.entities[1].id, 4, true, {}),
    ).toThrow('同一投影面');
    draft = curveClick(base, draft, 'view-0', knots[2], undefined, 4, false, {});
    expect(() => commitCurve(base, draft!, 'student')).toThrow('先点击任意端点');
    draft = curveClick(base, draft, 'view-0', knots[1], undefined, 4, false, {});
    expect(base).toEqual(original);
    for (const endpoint of [knots[0], knots[2]]) {
      const complete = curveClick(base, draft, 'view-0', endpoint, undefined, 4, false, {});
      const { next } = commitCurve(base, complete, 'student');
      const curve = next.entities.at(-1)!;
      if (curve.kind !== 'curve') throw Error();
      expect(curve.pointIds.map((id) => point(next, id))).toEqual(
        endpoint === knots[0] ? [...knots].reverse() : knots,
      );
      expect(next.entities[0]).toEqual(base.entities[0]);
      expect(next.entities.filter((e) => e.kind === 'point' && e.viewId === 'view-0')).toHaveLength(
        3,
      );
    }
    expect(base).toEqual(original);
  });

  it.each(['VHW_PROJECTION', 'THREE_VIEW', 'ISOMETRIC', 'OBLIQUE_DIMETRIC'] as const)(
    'stores ordered v2.2 references and interpolates every knot in %s',
    (editorType) => {
      const doc = addCurve(createDocument(editorType), 'view-0', knots, 'student');
      const c = doc.entities.at(-1)!;
      expect(c.kind).toBe('curve');
      if (c.kind !== 'curve') throw Error();
      expect(doc.schemaVersion).toBe('tuheng.geometry/2.2.0');
      const segments = curveSegments(c.pointIds.map((id) => point(doc, id)));
      expect(segments.map((s) => s.end)).toEqual(knots.slice(1));
      expect(curvePath(knots)).toContain('C');
      expect(exportSheetSvg(doc)).toContain('C');
      expect(exportGeometryNarrative(doc)).toContain('插值曲线');
      expect(loadGeometryDocument(serializeGeometryDocument(doc))).toEqual(doc);
      expect(
        GeometryDocument.safeParse({ ...doc, schemaVersion: 'tuheng.geometry/2.1.0' }).success,
      ).toBe(false);
    },
  );

  it('reuses immutable teacher anchors and propagates moves, copy, merge and deletion through references', () => {
    const stem = addDrawing(
      createDocument('VHW_PROJECTION'),
      'point',
      'view-0',
      [knots[0]],
      'teacher',
    );
    const doc = addCurve(stem, 'view-0', knots, 'student', [stem.entities[0].id]);
    const c = doc.entities.at(-1)!;
    if (c.kind !== 'curve') throw Error();
    expect(c.pointIds[0]).toBe(stem.entities[0].id);
    expect(combineAnswer(stem, doc)).toEqual(doc);
    expect(() => moveEntities(doc, [c.id], { x: 1, y: 1 }, 'student')).toThrow();
    const plain = addCurve(createDocument('VHW_PROJECTION'), 'view-0', knots, 'student');
    const curve = plain.entities.at(-1)!;
    if (curve.kind !== 'curve') throw Error();
    const moved = moveEntities(plain, [curve.pointIds[1]], { x: 0, y: 5 }, 'student');
    expect(point(moved, curve.pointIds[1]).y).toBe(30);
    const copied = copyEntities(moved, [curve.id], 'student');
    expect(copied.entities.filter((e) => e.kind === 'curve')).toHaveLength(2);
    expect(() => mergePoints(moved, curve.pointIds[1], curve.pointIds[0], 'student')).toThrow();
    const external = addDrawing(moved, 'point', 'view-0', [knots[0]], 'student');
    const targetId = external.entities.at(-1)!.id;
    const merged = mergePoints(external, curve.pointIds[0], targetId, 'student');
    expect(merged.entities.find((e) => e.id === curve.id)).toMatchObject({
      pointIds: [targetId, ...curve.pointIds.slice(1)],
    });
    expect(merged.entities.some((e) => e.id === curve.pointIds[0])).toBe(false);
    expect(
      deleteEntities(moved, [curve.pointIds[1]], 'student').entities.some((e) => e.id === curve.id),
    ).toBe(false);
  });

  it('offers actual line-axis intersections, respecting ray direction, hidden layers and zoom', () => {
    const doc = addDrawing(
      createDocument('VHW_PROJECTION'),
      'line',
      'view-0',
      [
        { x: 20, y: -5 },
        { x: 20, y: 5 },
      ],
      'student',
    );
    for (const pixels of [2, 4, 8]) {
      const c = snapCandidates(doc, 'view-0', { x: 20 + 3 / pixels, y: 3 / pixels }, pixels).find(
        (c) => c.kind === 'INTERSECTION',
      );
      expect(c?.position).toEqual({ x: 20, y: 0 });
      expect(c?.references).toHaveLength(2);
      const placed = addDrawing(doc, 'point', 'view-0', [{ x: 20, y: 0 }], 'student');
      const accepted = confirmSnap(doc, placed, c!, placed.entities.at(-1)!.id, 'student');
      expect(accepted.referenceRelations).toHaveLength(2);
      expect(accepted.referenceRelations?.map((r) => r.status)).toEqual(['SATISFIED', 'SATISFIED']);
      expect(
        snapCandidates(doc, 'view-0', { x: 20, y: 0 }, pixels, undefined, { axes: false }).some(
          (c) => c.kind === 'INTERSECTION',
        ),
      ).toBe(false);
      expect(
        snapCandidates(doc, 'view-0', { x: 20, y: 0 }, pixels, undefined, {
          hiddenLayers: ['construction'],
        }).some((c) => c.kind === 'INTERSECTION'),
      ).toBe(false);
    }
  });

  it('automatically fits an open S stroke to a curve while retaining the original samples', () => {
    for (const cssPixelsPerMm of [2, 4, 8]) {
      for (const samples of [
        sStroke(),
        [...sStroke()].reverse(),
        sStroke().map((p) => ({ ...p, x: -p.y, y: p.x })),
      ])
        expect(fitStroke(samples, { cssPixelsPerMm }).kind).toBe('curve');
    }
    const d = addPenStroke(createDocument('VHW_PROJECTION'), 'view-0', sStroke(), 'student');
    expect(d.entities.at(-1)).toMatchObject({ kind: 'curve', samples: sStroke() });
  });

  it('snaps interior pen knots to intersections and keeps raw geometry available separately', () => {
    let base = createDocument('VHW_PROJECTION');
    base = addDrawing(
      base,
      'line',
      'view-0',
      [
        { x: 34, y: 5 },
        { x: 34, y: 45 },
      ],
      'student',
    );
    base = addDrawing(
      base,
      'line',
      'view-0',
      [
        { x: 10, y: 26 },
        { x: 50, y: 26 },
      ],
      'student',
    );
    const raw = addPenStroke(base, 'view-0', sStroke(), 'student');
    const adjusted = snapPenCurve(base, raw, 'student', 4, {});
    const c = adjusted.entities.at(-1)!;
    if (c.kind !== 'curve') throw Error();
    expect(c.pointIds.map((id) => point(adjusted, id))).toContainEqual({ x: 34, y: 26 });
    expect(raw).not.toEqual(adjusted);
    expect(GeometryDocument.safeParse(adjusted).success).toBe(true);
  });
});
