import { describe, expect, it } from 'vitest';
import {
  addDrawing,
  createDocument,
  cornerAt,
  trimAt,
  extendAt,
  transformSelection,
  point,
  snapCandidates,
  lineGeometry,
} from '@tuheng/geometry-core';
import type { GeometryDocument, Vec2 } from '@tuheng/contracts';

const view = 'view-0';
const xy = (x: number, y: number) => ({ x, y });
const addSegment = (doc: GeometryDocument, a: Vec2, b: Vec2) =>
  addDrawing(doc, 'segment', view, [a, b], 'student');
const lines = (doc: GeometryDocument) => doc.entities.filter((e) => e.kind === 'segment');

describe('CAD modification commands', () => {
  it('retains both original outer nodes when trimming the middle of a segment', () => {
    let doc = addSegment(createDocument('ISOMETRIC'), xy(0, 0), xy(20, 0));
    doc = addSegment(doc, xy(4, -3), xy(4, 3));
    doc = addSegment(doc, xy(16, -3), xy(16, 3));
    const [a, b, c] = lines(doc);
    const out = trimAt(doc, [b.id, c.id], a.id, xy(10, 0), 'student');
    expect(lines(out)).toHaveLength(4);
    const left = lines(out).find((e) => e.startPoint === a.startPoint)!;
    const right = lines(out).find((e) => e.endPoint === a.endPoint)!;
    expect(point(out, left.endPoint)).toEqual(xy(4, 0));
    expect(point(out, right.startPoint)).toEqual(xy(16, 0));
    expect(point(doc, a.endPoint)).toEqual(xy(20, 0));
  });
  it('extends to the nearest forward circle crossing, and rejects circles behind the picked end', () => {
    let doc = addSegment(createDocument('ISOMETRIC'), xy(0, 10), xy(2, 10));
    doc = addDrawing(doc, 'circle', view, [xy(10, 10), xy(12, 10)], 'teacher');
    const a = lines(doc)[0],
      circle = doc.entities.at(-1)!;
    const out = extendAt(doc, [circle.id], a.id, xy(2, 10), 'student');
    expect(point(out, a.endPoint).x).toBeCloseTo(8, 8);
    expect(() => extendAt(doc, [circle.id], a.id, xy(0, 10), 'student')).toThrow();
  });
  it('rounds a selected right-angle region with a tangent arc in one document', () => {
    let doc = addSegment(createDocument('ISOMETRIC'), xy(0, 0), xy(12, 0));
    doc = addSegment(doc, xy(0, 0), xy(0, 14));
    const [a, b] = lines(doc);
    const out = cornerAt(
      doc,
      a.id,
      b.id,
      xy(10, 0),
      xy(0, 10),
      { kind: 'fillet', radius: 2 },
      'student',
    );
    const arc = out.entities.find((e) => e.kind === 'arc')!;
    expect(arc.radius).toBe(2);
    expect(point(out, arc.center).x).toBeCloseTo(2);
    expect(point(out, arc.center).y).toBeCloseTo(2);
    expect(lineGeometry(out, lines(out)[0]).a.x).toBeCloseTo(2);
    expect(() =>
      cornerAt(doc, a.id, b.id, xy(10, 0), xy(0, 10), { kind: 'fillet', radius: 15 }, 'student'),
    ).toThrow();
  });
  it('reflects an arc orientation and keeps original IDs and geometry when copying', () => {
    const doc = addDrawing(
      createDocument('ISOMETRIC'),
      'arc',
      view,
      [xy(4, 4), xy(6, 4), xy(4, 6)],
      'student',
    );
    const arc = doc.entities.find((e) => e.kind === 'arc')!;
    const out = transformSelection(
      doc,
      [arc.id],
      { kind: 'mirror', a: xy(0, 0), b: xy(0, 4), keepSource: true },
      'student',
    );
    const copy = out.entities.find((e) => e.kind === 'arc' && e.id !== arc.id);
    expect(copy?.kind).toBe('arc');
    if (copy?.kind === 'arc') {
      expect(copy.sweep).toBe(-arc.sweep);
      expect(point(out, copy.center)).toEqual(xy(-4, 4));
    }
    expect(doc.entities).toHaveLength(2);
  });
  it('previews bound followers at the committed coordinates without mutating the base', () => {
    let doc = addSegment(createDocument('ISOMETRIC'), xy(0, 0), xy(10, 0));
    doc = addSegment(doc, xy(0, 4), xy(6, 4));
    const [reference, follower] = lines(doc);
    doc.referenceRelations = [
      {
        id: 'parallel',
        targetId: follower.id,
        reference: { kind: 'entity', entityId: reference.id },
        kind: 'PARALLEL',
        mode: 'BINDING',
        source: 'USER',
      },
    ];
    const original = structuredClone(doc);
    const rotation = { kind: 'rotate' as const, center: xy(0, 0), degrees: 60 };
    const preview = transformSelection(doc, [reference.id], rotation, 'student', true);
    const committed = transformSelection(doc, [reference.id], rotation, 'student');
    expect(point(preview, follower.endPoint)).toEqual(point(committed, follower.endPoint));
    expect(point(preview, follower.endPoint)).not.toEqual(point(original, follower.endPoint));
    expect(preview.referenceRelations).toEqual(committed.referenceRelations);
    expect(doc).toEqual(original);
  });
  it('offers a true tangent from a point and an exact quadrant with independent switches', () => {
    const doc = addDrawing(
      createDocument('ISOMETRIC'),
      'circle',
      view,
      [xy(10, 10), xy(15, 10)],
      'student',
    );
    const x = 12.5,
      y = 10 + Math.sqrt(18.75);
    const candidate = snapCandidates(doc, view, xy(x, y), 8, xy(20, 10), {
      axes: false,
      objectTypes: ['tangent'],
      direction: false,
    })[0];
    expect(candidate.kind).toBe('TANGENT');
    expect(candidate.position.x).toBeCloseTo(x, 8);
    expect(candidate.position.y).toBeCloseTo(y, 8);
    expect(
      snapCandidates(doc, view, xy(10.01, 15), 8, undefined, {
        axes: false,
        objectTypes: ['quadrant'],
      })[0].kind,
    ).toBe('QUADRANT');
  });
});

describe('geometry of cut fragments and snap targets', () => {
  const base = () => createDocument('ISOMETRIC');
  function ellipse(
    doc: GeometryDocument,
    center: Vec2,
    majorRadius: number,
    minorRadius: number,
    angle = 0,
  ) {
    const d = addDrawing(doc, 'point', view, [center], 'student');
    const p = d.entities.at(-1)!;
    if (p.kind !== 'point') throw Error();
    d.entities.push({
      kind: 'ellipse',
      id: 'ellipse',
      layerId: p.layerId,
      lineStyle: p.lineStyle,
      viewId: p.viewId,
      center: p.id,
      majorRadius,
      minorRadius,
      angle,
      startAngle: 0,
      sweep: 360,
    });
    return d;
  }
  it('cuts a circle into the complementary arc and refuses tangent-only and coincident boundaries', () => {
    let d = addDrawing(base(), 'circle', view, [xy(0, 0), xy(5, 0)], 'student');
    const circle = d.entities.at(-1)!;
    d = addSegment(d, xy(0, -10), xy(0, 10));
    const cut = trimAt(d, [lines(d)[0].id], circle.id, xy(5, 0), 'student');
    const arc = cut.entities.find((e) => e.kind === 'arc')!;
    expect(arc.center).toBe(circle.kind === 'circle' ? circle.center : null);
    expect(arc.startAngle).toBeCloseTo(90);
    expect(arc.sweep).toBeCloseTo(180);
    d = addSegment(d, xy(5, -10), xy(5, 10));
    expect(() => trimAt(d, [lines(d)[1].id], circle.id, xy(-5, 0), 'student')).toThrow(/交点/);
    d = addDrawing(d, 'circle', view, [xy(0, 0), xy(5, 0)], 'student');
    expect(() => trimAt(d, [d.entities.at(-1)!.id], circle.id, xy(5, 0), 'student')).toThrow();
  });
  it('cuts an ellipse along its rotated minor axis while preserving the conic', () => {
    let d = ellipse(base(), xy(0, 0), 8, 3, 30);
    d = addSegment(d, xy(-5, 5 * Math.sqrt(3)), xy(5, -5 * Math.sqrt(3)));
    const cut = trimAt(d, [lines(d)[0].id], 'ellipse', xy(4 * Math.sqrt(3), 4), 'student');
    const e = cut.entities.find((e) => e.kind === 'ellipse')!;
    expect(e.majorRadius).toBe(8);
    expect(e.angle).toBe(30);
    expect(e.startAngle).toBeCloseTo(90);
    expect(e.sweep).toBeCloseTo(180);
  });
  it('trims an actual Hermite curve by restricting the parameter range without refitting its knots', () => {
    let d = addDrawing(base(), 'curve', view, [xy(0, 0), xy(3, 5), xy(6, 0)], 'student');
    const curve = d.entities.at(-1)!;
    if (curve.kind !== 'curve') throw Error();
    d = addSegment(d, xy(3, -10), xy(3, 10));
    const out = trimAt(d, [lines(d)[0].id], curve.id, xy(1, 2), 'student');
    const after = out.entities.find((e) => e.kind === 'curve')!;
    expect(after.pointIds).toEqual(curve.pointIds);
    expect(after.parameterRange![0]).toBeCloseTo(0.5, 7);
    expect(after.parameterRange![1]).toBe(1);
  });
  it('extends to the actual ellipse, spline or clockwise arc within its visible span', () => {
    let d = addSegment(base(), xy(-4, 5), xy(-2, 5));
    const target = lines(d)[0].id;
    d = ellipse(d, xy(4, 5), 4, 2, 0);
    d = addDrawing(d, 'curve', view, [xy(4, 0), xy(2, 5), xy(4, 8)], 'teacher');
    const spline = d.entities.at(-1)!.id;
    for (const [boundary, x] of [
      ['ellipse', 0],
      [spline, 2],
    ] as const) {
      const out = extendAt(d, [boundary], target, xy(-2, 5), 'student'),
        edge = lines(out)[0];
      expect(point(out, edge.endPoint).x).toBeCloseTo(x, 7);
    }
    d = addDrawing(d, 'arc', view, [xy(6, 5), xy(8, 5), xy(6, 3)], 'teacher');
    const out = extendAt(d, [d.entities.at(-1)!.id], target, xy(-2, 5), 'student');
    expect(point(out, lines(out)[0].endPoint).x).toBeCloseTo(8, 7);
  });
  it('finds true curve intersections, excludes off-arc crossings and hidden layers', () => {
    let d = ellipse(base(), xy(4, 4), 3, 2);
    d = addSegment(d, xy(-8, 4), xy(12, 4));
    const get = (p: Vec2) =>
      snapCandidates(d, view, p, 50, undefined, { axes: false, objectTypes: ['intersection'] });
    expect(get(xy(1, 4))[0].position).toEqual(xy(1, 4));
    expect(get(xy(7, 4))[0].position.x).toBeCloseTo(7);
    expect(
      snapCandidates(d, view, xy(7, 4), 50, undefined, {
        axes: false,
        objectTypes: ['intersection'],
        hiddenLayers: ['answer'],
      }),
    ).toEqual([]);
    d = addDrawing(d, 'arc', view, [xy(4, 4), xy(6, 4), xy(4, 2)], 'student');
    expect(get(xy(6, 4))[0].position.x).toBeCloseTo(6);
    expect(get(xy(2, 4))).toEqual([]);
  });
  it('resolves intersecting Hermite splines and honors a previous trim on the next cut', () => {
    let d = addDrawing(base(), 'curve', view, [xy(-4, -4), xy(0, 0), xy(4, 4)], 'student');
    const a = d.entities.at(-1)!;
    d = addDrawing(d, 'curve', view, [xy(-4, 4), xy(0, 0), xy(4, -4)], 'student');
    const b = d.entities.at(-1)!;
    const cut = trimAt(d, [b.id], a.id, xy(-3, -3), 'student');
    const kept = cut.entities.find((e) => e.kind === 'curve' && e.id === a.id);
    if (kept?.kind !== 'curve') throw Error();
    expect(kept.parameterRange?.[0]).toBeCloseTo(0.5, 10);
    expect(kept.parameterRange?.[1]).toBe(1);
    expect(() => trimAt(cut, [b.id], a.id, xy(3, 3), 'student')).toThrow(/交点/);
  });
  it('chamfers a shared corner into two real shared tangent-point nodes without leaving the old corner', () => {
    let d = addSegment(base(), xy(0, 0), xy(10, 0));
    const a = lines(d)[0];
    d = addDrawing(d, 'segment', view, [xy(0, 0), xy(0, 10)], 'student', undefined, [a.startPoint]);
    const b = lines(d)[1];
    const out = cornerAt(
      d,
      a.id,
      b.id,
      xy(8, 0),
      xy(0, 8),
      { kind: 'chamfer', distanceA: 2, distanceB: 3 },
      'student',
    );
    const [l, r, bevel] = lines(out);
    expect([l.startPoint, r.startPoint]).toEqual([bevel.startPoint, bevel.endPoint]);
    expect(point(out, l.startPoint)).toEqual(xy(2, 0));
    expect(point(out, r.startPoint)).toEqual(xy(0, 3));
    expect(out.entities.some((e) => e.id === a.startPoint)).toBe(false);
  });
  it('blocks transformations and extensions that would rewrite a protected stem node', () => {
    let d = addDrawing(base(), 'point', view, [xy(5, 2)], 'teacher');
    const locked = d.entities[0].id;
    d = addDrawing(d, 'segment', view, [xy(5, 2), xy(10, 2)], 'student', undefined, [locked]);
    const a = lines(d)[0];
    d = addSegment(d, xy(2, 0), xy(2, 6));
    expect(() => extendAt(d, [lines(d)[1].id], a.id, xy(5, 2), 'student')).toThrow(/只读/);
    expect(() =>
      transformSelection(d, [a.id], { kind: 'rotate', center: xy(0, 0), degrees: 90 }, 'student'),
    ).toThrow(/只读/);
    expect(point(d, locked)).toEqual(xy(5, 2));
  });
  it('previews and commits the same non-destructive mirrored ellipse and restricts candidates by type', () => {
    const d = ellipse(base(), xy(2, 8), 8, 3, 37);
    const mirror = { kind: 'mirror' as const, a: xy(0, 0), b: xy(0, 10), keepSource: false };
    const p = transformSelection(d, ['ellipse'], mirror, 'student', true);
    const out = transformSelection(d, ['ellipse'], mirror, 'student');
    expect(p.entities).toEqual(out.entities);
    expect(out.entities.at(-1)).toMatchObject({ kind: 'ellipse', angle: 143, sweep: -360 });
    expect(d.entities.at(-1)).toMatchObject({ kind: 'ellipse', angle: 37, sweep: 360 });
    expect(
      snapCandidates(d, view, xy(2.01, 8), 10, undefined, {
        objectTypes: ['center'],
        axes: false,
      })[0].kind,
    ).toBe('CENTER');
    expect(
      snapCandidates(d, view, xy(2.01, 8), 10, undefined, { objects: false, axes: false }),
    ).toEqual([]);
  });
  it('perpendicular foot lies inside a finite target and neither endpoint extensions nor off-axis translations create crossings', () => {
    const d = addSegment(base(), xy(5, 10), xy(10, 10));
    const opt = { axes: false, objectTypes: ['perpendicular'] as const, direction: false };
    const p = xy(7.001, 10),
      snap = snapCandidates(d, view, p, 10, xy(7, 4), opt)[0];
    expect(snap).toMatchObject({ kind: 'FOOT', position: xy(7, 10) });
    expect(snapCandidates(d, view, xy(12, 10), 10, xy(12, 4), opt)).toEqual([]);
  });
});

it('mirrors associated linear dimensions in the same metric basis and leaves the source and display override intact', () => {
  const d = addSegment(createDocument('ISOMETRIC'), xy(2, 4), xy(8, 12));
  const seg = lines(d)[0];
  d.entities.push({
    kind: 'dimension',
    id: 'dim',
    layerId: seg.layerId,
    lineStyle: seg.lineStyle,
    viewId: seg.viewId,
    dimensionType: 'LINEAR',
    linearAxis: 'X',
    referenceIds: [seg.startPoint, seg.endPoint],
    position: xy(4, 15),
    precision: 2,
    textOverride: '100',
    textSize: 2,
    arrowStyle: 'CLOSED',
  });
  const mirrored = transformSelection(
    d,
    [seg.id, 'dim'],
    { kind: 'mirror', a: xy(0, 0), b: xy(10, 10), keepSource: true },
    'student',
  );
  const m = mirrored.entities.find((e) => e.kind === 'dimension' && e.id !== 'dim')!;
  if (m.kind !== 'dimension') throw Error();
  expect(m.referenceIds).not.toEqual([seg.startPoint, seg.endPoint]);
  expect(m.textOverride).toBe('100');
  expect(m.linearAngle).toBeCloseTo(90, 9);
  const [a, b] = m.referenceIds.map((id) => point(mirrored, id));
  expect(Math.abs(b.y - a.y)).toBeCloseTo(6, 8);
  expect(m.position.x).toBeCloseTo(15, 8);
  expect(m.position.y).toBeCloseTo(4, 8);
  expect(d.entities).toHaveLength(4);
});
