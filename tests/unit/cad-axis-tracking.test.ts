import { describe, expect, it } from 'vitest';
import type { GeometryDocument, Vec2 } from '@tuheng/contracts';
import {
  addDrawing,
  addProjectionAxis,
  cadStep,
  createDocument,
  cross,
  distance,
  drawingViewAt,
  localToSheet,
  sheetDeltaToLocal,
  sheetToLocal,
  startCadSession,
  sub,
  trackingBase,
  type CadSession,
  type TrackingBase,
} from '@tuheng/geometry-core';
import { locateCadPoint } from '../../packages/geometry-editor/src/cad-pointer';

const v = (x: number, y: number) => ({ x, y });
const front = 'view-0',
  top = 'view-1',
  side = 'view-2';
const baseIn = (doc: GeometryDocument, viewId: string, sheet: Vec2): TrackingBase => ({
  viewId,
  position: sheetToLocal(doc, viewId, sheet),
});

function locate(
  session: CadSession,
  sheet: Vec2,
  tracked: TrackingBase[],
  overrides: Partial<Parameters<typeof locateCadPoint>[1]> & {
    acquire?: boolean;
    paused?: boolean;
  } = {},
) {
  const { baseDocument: document } = session;
  const { acquire, paused = false, ...controls } = overrides;
  return locateCadPoint(
    session,
    {
      document,
      ortho: false,
      snapping: true,
      skipSnap: false,
      direction: true,
      tracking: true,
      objectSnap: true,
      objectTypes: ['endpoint', 'midpoint', 'intersection', 'perpendicular', 'nearest'],
      gridSpacing: 5,
      axes: true,
      axesSnap: true,
      gridSnap: false,
      projectionSnap: false,
      hiddenLayers: [],
      ...controls,
    },
    sheet,
    drawingViewAt(document, sheet, session.viewId),
    [],
    5,
    10,
    paused,
    undefined,
    tracked,
    acquire,
  );
}

const p1 = v(-60, 30),
  p2 = v(-10, 30),
  q1 = v(-60, -25),
  q2 = v(-10, -25);

function addOnSheet(doc: GeometryDocument, viewId: string, ...points: Vec2[]) {
  return addDrawing(
    doc,
    'segment',
    viewId,
    points.map((p) => sheetToLocal(doc, viewId, p)),
    'student',
  );
}

function beginSegment(doc: GeometryDocument, viewId: string, start: Vec2) {
  return cadStep(startCadSession('segment', doc, viewId, 'student'), doc, {
    type: 'point',
    position: sheetToLocal(doc, viewId, start),
  }).session!;
}

describe('point feature acquisition during a CAD command', () => {
  const reference = () => addOnSheet(createDocument('VH_PROJECTION'), front, p1, p2);

  it('acquires P1 in V after picking Q2 in H and solves the exact tracked crossing', () => {
    const doc = reference();
    const session = startCadSession('segment', doc, front, 'student');
    const right = locate(session, p2, [], { acquire: true }).hover!;
    expect(right).toMatchObject({ viewId: front, snap: { kind: 'COINCIDENT' } });
    const bases = [trackingBase(doc, right.viewId, right.snap)];
    const first = locate(session, v(q2.x + 0.4, q2.y), bases);
    const drawing = cadStep(session, doc, first.pick).session!;
    expect(drawing.viewId).toBe(top);
    expect(localToSheet(doc, top, drawing.points[0])).toEqual(q2);

    const { hover, pick } = locate(drawing, p1, bases, { acquire: true, gridSnap: true });
    expect(pick.viewId).toBe(top);
    expect(hover).toMatchObject({
      viewId: front,
      snap: { kind: 'COINCIDENT', position: sheetToLocal(doc, front, p1) },
    });
    bases.push(trackingBase(doc, hover!.viewId, hover!.snap));
    const end = locate(drawing, v(q1.x + 0.4, q1.y - 0.3), bases);
    expect(localToSheet(doc, end.pick.viewId, end.pick.position)).toEqual(q1);
    expect(end.candidate).toMatchObject({
      equalLength: { sourceId: doc.entities.at(-1)!.id, length: 50 },
      tracks: expect.arrayContaining([
        expect.objectContaining({
          point: sheetToLocal(doc, top, p1),
          direction: v(0, 1),
        }),
      ]),
    });
  });

  it.each([
    [front, v(-10, 13)],
    [top, q2],
  ] as const)(
    'acquires an endpoint off the orthogonal axis while drawing in %s',
    (viewId, origin) => {
      const doc = reference();
      const drawing = beginSegment(doc, viewId, origin);
      const { hover, pick } = locate(drawing, p1, [], { ortho: true, acquire: true });
      expect(hover).toMatchObject({
        viewId: front,
        snap: { kind: 'COINCIDENT', position: sheetToLocal(doc, front, p1) },
      });
      const projected = localToSheet(doc, viewId, pick.position);
      expect(projected.x === origin.x || projected.y === origin.y).toBe(true);
      expect(projected).not.toEqual(p1);
      const base = trackingBase(doc, hover!.viewId, hover!.snap);
      const end = locate(drawing, v(p1.x + 0.4, origin.y - 0.3), [base], { ortho: true });
      expect(localToSheet(doc, viewId, end.pick.position)).toEqual(v(p1.x, origin.y));
      expect(
        end.candidate?.tracks?.some((t) => distance(localToSheet(doc, viewId, t.point), p1) < 1e-7),
      ).toBe(true);
    },
  );

  it('respects the object types, layer visibility, pause and acquisition switches', () => {
    const doc = reference();
    const drawing = beginSegment(doc, top, q2);
    const unavailable: NonNullable<Parameters<typeof locate>[3]>[] = [
      { acquire: false },
      { paused: true },
      { skipSnap: true },
      { tracking: false },
      { snapping: false },
      { objectSnap: false },
      { hiddenLayers: ['answer'] },
      { objectTypes: ['midpoint'] },
    ];
    for (const controls of unavailable)
      expect(locate(drawing, p1, [], { acquire: true, ...controls }).hover).toBeUndefined();
    expect(locate(drawing, v(p1.x - 2.01, p1.y), [], { acquire: true }).hover).toBeUndefined();
    const fromP1 = beginSegment(doc, front, p1);
    expect(locate(fromP1, p1, [], { acquire: true }).hover).toBeUndefined();
  });

  it('copies a V segment length from P2 alone along H drafting directions', () => {
    const source = reference();
    const doc = addOnSheet(source, top, v(-80, -42), v(-77, -46));
    const drawing = beginSegment(doc, top, q2);
    const base = baseIn(doc, front, p2);
    for (const [near, exact] of [
      [v(-59.5, -25.4), q1],
      [v(-9.6, -74.5), v(-10, -75)],
      [v(19.7, -64.5), v(20, -65)],
    ]) {
      const end = locate(drawing, near, [base]);
      expect(end.candidate?.equalLength).toEqual({
        sourceId: source.entities.at(-1)!.id,
        length: 50,
      });
      expect(distance(localToSheet(doc, top, end.pick.position), exact)).toBeLessThan(1e-7);
    }
  });

  it('requires a visible segment attached to an endpoint in the base’s own view', () => {
    const doc = reference();
    const drawing = beginSegment(doc, top, q2);
    const near = v(-59.5, -25.4);
    for (const bases of [[], [baseIn(doc, front, v(-35, 30))], [baseIn(doc, top, p2)]])
      expect(locate(drawing, near, bases).candidate?.equalLength).toBeUndefined();
    expect(
      locate(drawing, near, [baseIn(doc, front, p2)], { hiddenLayers: ['answer'] }).candidate
        ?.equalLength,
    ).toBeUndefined();

    const unrelated = addOnSheet(createDocument('VH_PROJECTION'), top, p1, p2);
    const sameSheetPosition = baseIn(unrelated, front, p2);
    expect(
      locate(beginSegment(unrelated, top, q2), near, [sameSheetPosition]).candidate?.equalLength,
    ).toBeUndefined();
  });
});

describe('tracking on the unfolded sheet', () => {
  it.each([
    ['VHW_PROJECTION', front, v(-28, 43), v(-27.6, -0.8), v(-28, 0), 'X', 'X 轴'],
    ['VHW_PROJECTION', front, v(-32, 28), v(0.75, 28.5), v(0, 28), 'Z', 'Z 轴'],
    ['VHW_PROJECTION', top, v(-30, -37), v(0.6, -36.5), v(0, -37), 'Y_H', 'Y_H 轴'],
    ['VHW_PROJECTION', side, v(36, 26), v(36.4, -0.7), v(36, 0), 'Y_W', 'Y_W 轴'],
    ['VHW_PROJECTION', top, v(-30, -37), v(37.5, -36.5), v(37, -37), 'MITER_45', '45° 传宽线'],
    ['VH_PROJECTION', front, v(29, 33), v(28.5, -0.6), v(29, 0), 'X', 'X-O 轴'],
  ] as const)(
    'intersects %s guides from %s at %s × %s',
    (type, source, origin, pointer, end, axisId, label) => {
      const doc = createDocument(type);
      const session = startCadSession('point', doc, source, 'student');
      const base = baseIn(doc, source, origin);
      expect(locate(session, pointer, [base], { tracking: false }).candidate?.kind).toBe(
        'POINT_ON_REFERENCE',
      );
      const { candidate, pick } = locate(session, pointer, [base], { objectTypes: ['endpoint'] });
      expect(candidate).toMatchObject({
        kind: 'TRACKING',
        label: `追踪交点 · ${label}`,
        reference: { kind: 'baseAxis', axisId },
      });
      expect(candidate?.tracks).toHaveLength(1);
      expect(localToSheet(doc, pick.viewId, candidate!.tracks![0].point)).toEqual(origin);
      expect(localToSheet(doc, pick.viewId, pick.position)).toEqual(end);
    },
  );

  it.each([
    [top, v(-32.6, -27), v(-32, -27), '垂直追踪'],
    [side, v(26, 36.6), v(26, 36), '水平追踪'],
  ] as const)('continues a V guide into %s beyond an axis', (target, pointer, end, label) => {
    const doc = createDocument('VHW_PROJECTION');
    const origin = v(-32, 36);
    const { candidate, pick } = locate(startCadSession('point', doc, front, 'student'), pointer, [
      baseIn(doc, front, origin),
    ]);
    expect(pick.viewId).toBe(target);
    expect(candidate).toMatchObject({ kind: 'TRACKING', label });
    expect(localToSheet(doc, target, candidate!.tracks![0].point)).toEqual(origin);
    expect(localToSheet(doc, target, pick.position)).toEqual(end);
  });

  it('keeps paper directions through a rotated auxiliary view and intersects its axis', () => {
    const doc = addProjectionAxis(
      createDocument('VHW_PROJECTION'),
      {
        name: 'X1',
        viewName: 'H1',
        retainedViewId: front,
        replacedViewId: top,
        parentId: null,
        method: 'FREE',
        referenceEntityId: null,
        anchor: v(-42, 30),
        through: v(-32, 40),
        side: -1,
      },
      'student',
    );
    const axis = doc.auxiliarySystems![0];
    const session = startCadSession('point', doc, front, 'student');
    const origin = v(-32, 53);
    const direction = v(2, -1);
    const base = {
      ...baseIn(doc, front, origin),
      direction: sheetDeltaToLocal(doc, front, direction),
    };
    const crossing = locate(session, v(-31.5, 39.5), [base]);
    expect(crossing.pick.viewId).toBe(axis.newViewId);
    expect(crossing.candidate).toMatchObject({
      label: '追踪交点 · X1',
      reference: { kind: 'projectionAxis', systemId: axis.id },
    });
    expect(
      distance(localToSheet(doc, axis.newViewId, crossing.pick.position), v(-32, 40)),
    ).toBeLessThan(1e-8);

    const extended = locate(session, v(-11.8, 43.27), [base, base]);
    expect(extended.pick.viewId).toBe(axis.newViewId);
    expect(extended.candidate?.label).toBe('延长线追踪');
    expect(extended.candidate?.tracks).toHaveLength(1);
    const [guide] = extended.candidate!.tracks!;
    expect(Math.hypot(guide.direction.x, guide.direction.y)).toBeCloseTo(1, 10);
    expect(distance(localToSheet(doc, axis.newViewId, guide.point), origin)).toBeLessThan(1e-8);
    const end = localToSheet(doc, axis.newViewId, extended.pick.position);
    expect(cross(direction, sub(end, origin))).toBeCloseTo(0, 10);
  });

  it('takes the exact edge intersection over an unaligned foot and yields to a directly hit point', () => {
    const d = createDocument('VHW_PROJECTION');
    const add = (doc: GeometryDocument, kind: 'segment' | 'point', ...pts: Vec2[]) =>
      addDrawing(
        doc,
        kind,
        front,
        pts.map((p) => sheetToLocal(doc, front, p)),
        'student',
      );
    const doc = add(d, 'segment', v(-64, 25), v(-10, 25));
    const bases = [baseIn(doc, top, v(-27.2, -34))];
    const near = v(-26.8, 25.5);
    const session = startCadSession('point', doc, front, 'student');
    expect(locate(session, near, bases, { tracking: false }).candidate?.kind).toBe('FOOT');
    expect(locate(session, near, bases).candidate).toMatchObject({
      kind: 'TRACKING',
      label: '追踪交点',
      position: v(27.2, 25),
      entityIds: [doc.entities.at(-1)!.id],
    });

    const withPoint = add(doc, 'point', near);
    expect(
      locate(startCadSession('point', withPoint, front, 'student'), near, bases).candidate,
    ).toMatchObject({ kind: 'COINCIDENT', position: sheetToLocal(doc, front, near) });
  });

  it.each([
    [v(-29, 36), v(-28.5, -0.7), v(-29, 0), v(-28.5, -29), v(-29, -29), 'X'],
    [v(-29, 36), v(0.7, 35.5), v(0, 36), v(29, 35.5), v(29, 36), 'Z'],
  ] as const)(
    'tracks to and beyond the axis from an in-progress segment at %s',
    (start, near, on, beyond, end, axisId) => {
      const doc = createDocument('VHW_PROJECTION');
      const session = cadStep(startCadSession('segment', doc, front, 'student'), doc, {
        type: 'point',
        viewId: front,
        position: sheetToLocal(doc, front, start),
      }).session!;
      const hit = locate(session, near, [], { ortho: true });
      expect(hit.candidate?.reference).toEqual({ kind: 'baseAxis', axisId });
      expect(localToSheet(doc, front, hit.pick.position)).toEqual(on);
      const next = locate(session, beyond, [], { ortho: true });
      expect(next.pick.viewId).toBe(front);
      expect(next.candidate?.tracks).toHaveLength(1);
      expect(localToSheet(doc, front, next.pick.position)).toEqual(end);
    },
  );

  it('uses an across-view guide on a parallel drafting direction', () => {
    const empty = createDocument('VHW_PROJECTION');
    const doc = addDrawing(empty, 'segment', front, [v(60, 10), v(55, 15)], 'student');
    const session = cadStep(startCadSession('segment', doc, front, 'student'), doc, {
      type: 'point',
      position: v(63, 36),
    }).session!;
    const origin = v(-33, -31);
    const { candidate, pick } = locate(session, v(-33.3, 65.7), [baseIn(doc, top, origin)]);
    expect(candidate).toMatchObject({ label: '追踪交点', guide: { kind: 'parallel' } });
    expect(localToSheet(doc, front, candidate!.tracks![0].point)).toEqual(origin);
    expect(distance(localToSheet(doc, front, pick.position), v(-33, 66))).toBeLessThan(1e-8);
  });
});
