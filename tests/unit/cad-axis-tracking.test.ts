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
  overrides: Partial<Parameters<typeof locateCadPoint>[1]> = {},
) {
  const { baseDocument: document } = session;
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
      ...overrides,
    },
    sheet,
    drawingViewAt(document, sheet, session.viewId),
    [],
    5,
    10,
    false,
    undefined,
    tracked,
  );
}

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
