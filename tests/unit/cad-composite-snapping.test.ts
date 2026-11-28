import { describe, expect, it } from 'vitest';
import { GeometryDocument, type Vec2 } from '@tuheng/contracts';
import {
  addDrawing,
  addProjectionAxis,
  angle,
  cadGrips,
  cadStep,
  createDocument,
  cross,
  distance,
  dot,
  gripDraftingTarget,
  localToSheet,
  point,
  previewCadGrip,
  sheetToLocal,
  solveDraftingSnap,
  startCadSession,
  sub,
  trackingBase,
  trackingCandidate,
  type CadSession,
} from '@tuheng/geometry-core';
import { locateCadPoint } from '../../packages/geometry-editor/src/cad-pointer';
import { dragSelection, type Gesture } from '../../packages/geometry-editor/src/selection-gesture';

const v = (x: number, y: number) => ({ x, y });
const view = 'view-0';
const paper = () => createDocument('VHW_PROJECTION');
const add = (doc: GeometryDocument, kind: Parameters<typeof addDrawing>[1], ...points: Vec2[]) =>
  addDrawing(doc, kind, view, points, 'student');
const solve = (
  doc: GeometryDocument,
  p: Vec2,
  origins: Vec2[] = [],
  options: Parameters<typeof solveDraftingSnap>[4] = {},
) => solveDraftingSnap(doc, view, p, 5, { origins, ...options });
const controls = {
  ortho: false,
  snapping: true,
  skipSnap: false,
  direction: true,
  tracking: false,
  objectSnap: true,
  objectTypes: ['endpoint', 'intersection', 'perpendicular', 'tangent', 'nearest'] as const,
  gridSpacing: 5,
  axes: true,
  axesSnap: true,
  gridSnap: false,
  projectionSnap: false,
  hiddenLayers: [],
} satisfies Omit<Parameters<typeof locateCadPoint>[1], 'document'>;
function locate(doc: GeometryDocument, session: CadSession, p: Vec2) {
  return locateCadPoint(
    session,
    { ...controls, document: doc },
    localToSheet(doc, view, p),
    view,
    [],
    5,
    10,
    false,
  );
}
function atOrigin(doc: GeometryDocument, command: string, origin: Vec2, ids: string[] = []) {
  let session = startCadSession(command, doc, view, 'student', ids);
  if (command === 'polygon')
    session = cadStep(session, doc, { type: 'parameters', values: { sides: '5' } }).session!;
  if (session.phase === 'setup') session = cadStep(session, doc, { type: 'confirm' }).session!;
  return cadStep(session, doc, { type: 'point', position: origin }).session!;
}

describe('composite CAD snapping', () => {
  const origin = v(20, 36);
  const departure = () => add(paper(), 'segment', v(65, 36), origin);
  it('lands exactly on X with a vertical segment and records the positional reference', () => {
    const doc = departure();
    const session = atOrigin(doc, 'segment', origin);
    const { candidate, pick } = locate(doc, session, v(20.48, 0.25));
    expect(candidate).toMatchObject({
      label: '垂直 ∩ X 轴',
      guide: { kind: 'perpendicular' },
      reference: { kind: 'baseAxis', axisId: 'X' },
    });
    const delta = sub(pick.position, origin);
    expect(pick.position).toEqual(v(20, 0));
    expect(dot(delta, v(45, 0))).toBe(0);
    expect(angle(delta)).toBe(-90);
    const saved = cadStep(session, doc, pick).document!;
    const segment = saved.entities.at(-1)!;
    expect(segment.kind).toBe('segment');
    if (segment.kind !== 'segment') throw Error('Missing segment');
    expect(point(saved, segment.endPoint)).toEqual(v(20, 0));
    expect(saved.referenceRelations).toContainEqual(
      expect.objectContaining({
        targetId: segment.endPoint,
        reference: { kind: 'baseAxis', axisId: 'X' },
        mode: 'POSITION',
        status: 'SATISFIED',
      }),
    );
  });

  it.each([
    'line',
    'move',
    'copy',
    'circle',
    'arc',
    'arc3',
    'ellipse',
    'spline',
    'polygon',
    'linearDimension',
    'alignedDimension',
    'direction',
    'compass',
  ])('uses the same direction and axis intersection for %s', (command) => {
    const doc = departure();
    const selected = command === 'move' || command === 'copy' ? [doc.entities.at(-1)!.id] : [];
    const session = atOrigin(doc, command, origin, selected);
    const { pick, candidate } = locate(doc, session, v(20.48, 0.25));
    expect(pick.position).toEqual(v(20, 0));
    expect(candidate).toMatchObject({
      guide: { kind: 'perpendicular' },
      reference: { kind: 'baseAxis', axisId: 'X' },
    });
  });

  it('intersects an oblique normal with a finite target segment and works for a rectangle diagonal', () => {
    const a = v(18, 28);
    const ab = add(paper(), 'segment', a, v(28, 38));
    const doc = add(ab, 'segment', v(30, 4), v(50, 14));
    const target = doc.entities.at(-1)!;
    const p = v(38.38, 8.24);
    for (const command of ['segment', 'rectangle']) {
      const { pick, candidate } = locate(doc, atOrigin(doc, command, a), p);
      expect(candidate).toMatchObject({ label: '垂直 ∩ 线段', entityIds: [target.id] });
      expect(Math.abs(dot(v(10, 10), sub(pick.position, a)))).toBeLessThan(1e-8);
      expect(Math.abs(cross(v(20, 10), sub(pick.position, v(30, 4))))).toBeLessThan(1e-8);
      expect(distance(pick.position, v(38, 8))).toBeLessThan(1e-8);
    }
  });

  it('preserves the parallel direction and a circle placement through save and reload', () => {
    const a = v(14, 22),
      center = v(42, 36),
      radius = Math.sqrt(20);
    const line = add(paper(), 'segment', v(5, 6), v(17, 12));
    const doc = add(line, 'circle', center, v(center.x + radius, center.y));
    const target = doc.entities.at(-1)!;
    const session = atOrigin(doc, 'segment', a);
    const { pick, candidate } = locate(doc, session, v(38.28, 33.78));
    expect(candidate).toMatchObject({
      label: '平行 ∩ 圆',
      entityIds: [target.id],
      guide: { kind: 'parallel' },
    });
    expect(Math.abs(cross(v(2, 1), sub(pick.position, a)))).toBeLessThan(1e-8);
    expect(distance(pick.position, center)).toBeCloseTo(radius, 9);
    const saved = GeometryDocument.parse(cadStep(session, doc, pick).document);
    const relation = saved.referenceRelations!.at(-1)!;
    expect(relation).toMatchObject({
      reference: { kind: 'entity', entityId: target.id },
      mode: 'POSITION',
      status: 'SATISFIED',
    });
    expect(
      GeometryDocument.safeParse({
        ...saved,
        referenceRelations: [{ ...relation, mode: 'BINDING' }],
      }).success,
    ).toBe(false);
  });

  it('intersects the departing tangent with a different straight entity', () => {
    const a = v(31, 28);
    const circle = add(paper(), 'circle', v(31, 22), a);
    const doc = add(circle, 'line', v(52, 15), v(54, 31));
    const { position, candidate } = solve(doc, v(53.92, 28.2), [a]);
    expect(candidate).toMatchObject({
      label: '相切 ∩ 辅助线',
      guide: { kind: 'tangent', contact: a },
      entityIds: [doc.entities.at(-1)!.id],
    });
    expect(position.y).toBe(28);
    expect(Math.abs(cross(v(2, 16), sub(position, v(52, 15))))).toBeLessThan(1e-8);
  });

  it('uses only visible arc spans, ellipse boundaries and the actual spline profile', () => {
    const a = v(14, 20),
      p = v(44, 20);
    const arc = add(paper(), 'arc', v(44, 26), p, v(50, 26));
    const ellipse = atOrigin(paper(), 'ellipse', v(44, 28));
    const ellipseAxis = cadStep(ellipse, ellipse.baseDocument, {
      type: 'point',
      position: v(54, 28),
    }).session!;
    const conic = cadStep(ellipseAxis, ellipse.baseDocument, {
      type: 'point',
      position: p,
    }).document!;
    const spline = add(paper(), 'curve', v(36, 10), p, v(50, 31));
    for (const [doc, label] of [
      [arc, '圆弧'],
      [conic, '椭圆'],
      [spline, '样条'],
    ] as const) {
      const result = solve(doc, v(44.36, 20.24), [a], { objectTypes: ['intersection'] });
      expect(result.candidate?.label).toBe(`水平 ∩ ${label}`);
      expect(distance(result.position, p)).toBeLessThan(1e-8);
    }
    expect(
      solve(arc, v(44.3, 32.2), [v(14, 32)], { objectTypes: ['intersection'] }).candidate
        ?.composite,
    ).toBeUndefined();
  });

  it('solves projection alignment and retained tracking with an independent normal', () => {
    const a = v(18, 28),
      end = v(38, 8),
      source = v(38, 31);
    const line = add(paper(), 'segment', a, v(28, 38));
    const doc = addDrawing(line, 'point', 'view-1', [source], 'student');
    const near = v(38.27, 7.97);
    const aligned = solve(doc, near, [a], { projection: true });
    expect(aligned.candidate).toMatchObject({
      kind: 'PROJECTION_ALIGNMENT',
      label: '垂直 ∩ V-H 长对正',
      guide: { kind: 'perpendicular' },
    });
    expect(aligned.candidate?.tracks).toHaveLength(2);
    expect(distance(aligned.position, end)).toBeLessThan(1e-8);
    const tracked = solve(doc, near, [a], {
      trackingBases: [{ position: source, viewId: 'view-1' }],
    });
    expect(tracked.candidate).toMatchObject({
      label: '追踪交点',
      guide: { kind: 'perpendicular' },
    });
    expect(tracked.candidate?.tracks).toHaveLength(2);
    expect(distance(tracked.position, end)).toBeLessThan(1e-8);
  });

  it('combines independent rays from both fixed ends of a shared node', () => {
    const a = v(10, 10),
      b = v(30, 10),
      end = v(20, 20);
    const doc = add(paper(), 'segment', v(44, 30), v(50, 36));
    const { position, candidate } = solve(doc, v(20.28, 20.33), [a, b], { axes: false });
    expect(candidate?.label).toBe('平行 ∩ 垂直');
    expect(distance(position, end)).toBeLessThan(1e-8);
    expect(candidate?.tracks?.map((track) => track.point)).toEqual([b, a]);
  });

  it('honors a forced axis and prioritizes directly hit features with accurate guides', () => {
    const empty = paper();
    expect(
      solve(empty, v(31, 0.3), [origin], { ortho: true, objects: false, direction: false })
        .position,
    ).toEqual(v(20, 0));
    const doc = departure();
    const off = add(doc, 'point', v(20.6, 0.36));
    const hit = solve(off, v(20.57, 0.29), [origin]).candidate;
    expect(hit?.kind).toBe('COINCIDENT');
    expect(hit?.guide).toBeUndefined();
    const on = add(doc, 'point', v(20, 0));
    expect(solve(on, v(20.3, 0.31), [origin]).candidate).toMatchObject({
      kind: 'COINCIDENT',
      guide: { kind: 'perpendicular' },
    });
    expect(
      solve(doc, v(20.45, 0.3), [origin], { axes: false }).candidate?.reference,
    ).toBeUndefined();
    expect(solve(doc, v(20.45, 0.3), [origin], { enabled: false }).candidate).toBeUndefined();
  });

  it('accepts a valid short radius even inside the center snap radius', () => {
    const doc = add(paper(), 'point', origin);
    const session = atOrigin(doc, 'circle', origin);
    const { pick } = locate(doc, session, v(20.6, 36));
    const circle = cadStep(session, doc, pick).document!.entities.at(-1)!;
    expect(circle.kind).toBe('circle');
    if (circle.kind === 'circle') expect(circle.radius).toBeCloseTo(0.6, 8);
  });

  it('intersects horizontal direction with the 45° reference and an auxiliary projection axis', () => {
    const doc = paper();
    const miter = solve(doc, v(-32.3, -31.8), [v(15, -32)]);
    expect(miter.candidate).toMatchObject({
      label: '水平 ∩ 45° 传宽线',
      reference: { kind: 'baseAxis', axisId: 'MITER_45' },
    });
    expect(miter.position).toEqual(v(-32, -32));
    const derived = addProjectionAxis(
      doc,
      {
        name: 'X1',
        viewName: 'H1',
        retainedViewId: view,
        replacedViewId: 'view-1',
        parentId: null,
        method: 'FREE',
        referenceEntityId: null,
        anchor: v(-42, 30),
        through: v(-32, 40),
        side: -1,
      },
      'student',
    );
    const crossAxis = solve(derived, v(32.2, 40.3), [v(55, 40)]);
    expect(crossAxis.candidate).toMatchObject({
      label: '水平 ∩ X1',
      reference: { kind: 'projectionAxis' },
    });
    expect(distance(crossAxis.position, v(32, 40))).toBeLessThan(1e-8);
  });
});

describe('extension snaps in picks and editing', () => {
  const end = v(42, 24),
    p = v(42.38, 24.12);
  const first = (doc = paper()) => add(doc, 'segment', v(14, 10), v(26, 16));
  const extensions = (doc = first()) => add(doc, 'segment', v(64, 2), v(54, 12));
  it('finds both carrier extensions immediately for point and line picks with tracking off', () => {
    const doc = extensions();
    const entities = doc.entities.filter((e) => e.kind === 'segment');
    for (const session of [
      startCadSession('point', doc, view, 'student'),
      startCadSession('line', doc, view, 'student'),
      atOrigin(doc, 'line', v(30, 48)),
    ]) {
      const { pick, candidate } = locate(doc, session, p);
      expect(pick.position).toEqual(end);
      expect(candidate).toMatchObject({
        label: '延长线交点',
        composite: 'extension',
        positionOnly: true,
        entityIds: entities.map((e) => e.id),
      });
      expect(candidate?.tracks?.map((track) => track.point)).toEqual([v(26, 16), v(54, 12)]);
      if (session.points.length) expect(candidate?.guide?.kind).toBe('perpendicular');
    }
  });

  it('respects the intersection switch, visibility, shared endpoints and parallel carriers', () => {
    const doc = extensions();
    expect(solve(doc, p, [], { objectTypes: ['endpoint'] }).candidate).toBeUndefined();
    expect(solve(doc, p, [], { exclude: [doc.entities.at(-1)!.id] }).candidate).toBeUndefined();
    const parallel = add(first(), 'segment', v(54, 26), v(64, 31));
    expect(solve(parallel, p).candidate).toBeUndefined();
    const shared = add(add(paper(), 'segment', v(14, 10), end), 'segment', v(64, 2), end);
    const endpoint = solve(shared, p).candidate;
    expect(endpoint?.kind).toBe('COINCIDENT');
    expect(endpoint?.composite).toBeUndefined();
    const crossed = add(add(doc, 'segment', v(33, 24), v(50, 24)), 'segment', v(42, 16), v(42, 34));
    const actual = solve(crossed, v(42.98, 24.36)).candidate;
    expect(actual).toMatchObject({ kind: 'INTERSECTION', position: end });
    expect(actual?.composite).toBeUndefined();
    const onAxis = add(paper(), 'segment', v(18, 28), v(22, 20));
    expect(solve(onAxis, v(32.35, 0.22)).candidate).toMatchObject({
      label: '延长线交点 · X 轴',
      reference: { kind: 'baseAxis', axisId: 'X' },
      position: v(32, 0),
      tracks: [{ point: v(22, 20) }],
    });
    const base = paper();
    const fromH = addDrawing(
      base,
      'segment',
      'view-1',
      [v(-10, -32), v(-18, -32)].map((p) => sheetToLocal(base, 'view-1', p)),
      'student',
    );
    expect(solve(fromH, v(-32.36, -32.24)).candidate).toMatchObject({
      label: '延长线交点 · 45° 传宽线',
      position: v(-32, -32),
      reference: { kind: 'baseAxis', axisId: 'MITER_45' },
    });
  });

  it('retains every oblique direction connected to one tracking base', () => {
    const doc = add(add(paper(), 'segment', end, v(26, 16)), 'segment', end, v(54, 12));
    const source = solve(doc, end).candidate!;
    const base = trackingBase(doc, view, source);
    expect(base.directions).toHaveLength(2);
    for (const [near, exact] of [
      [v(57.8, 32.3), v(58, 32)],
      [v(32.2, 34.2), v(32, 34)],
    ]) {
      const tracked = trackingCandidate(doc, view, near, [base], 0.5, {
        axes: false,
        objects: false,
      });
      expect(tracked?.label).toBe('延长线追踪');
      expect(tracked?.tracks).toHaveLength(1);
      expect(distance(tracked!.position, exact)).toBeLessThan(0.4);
      expect(Math.abs(cross(sub(exact, end), sub(tracked!.position, end)))).toBeLessThan(1e-8);
    }
  });

  it('limits distant virtual crossings on touch while keeping nearby ones available', () => {
    const edges = add(
      add(paper(), 'segment', v(55, 35), v(30, 35)),
      'segment',
      v(10, 15),
      v(10, 45),
    );
    const options = { threshold: 16, objectTypes: ['intersection'] as const };
    expect(
      solveDraftingSnap(edges, view, v(32, 22), 0.47, options).candidate?.composite,
    ).toBeUndefined();
    expect(solveDraftingSnap(edges, view, v(14, 32), 0.47, options).candidate).toMatchObject({
      composite: 'extension',
      position: v(10, 35),
    });
  });

  it.each([false, true])('moves an existing endpoint exactly (extension=%s)', (extension) => {
    const fixed = extension ? v(30, 48) : v(22, 35);
    const moving = v(27, 14);
    const doc = add(
      extension ? extensions() : add(paper(), 'segment', v(16, 35), v(50, 35)),
      'segment',
      fixed,
      moving,
    );
    const segment = doc.entities.at(-1)!;
    if (segment.kind !== 'segment') throw Error('Missing segment');
    const gesture = {
      base: doc,
      ids: [segment.endPoint],
      start: localToSheet(doc, view, moving),
      viewId: view,
      scale: 5,
      snapPixels: 10,
    } as Gesture;
    const cursor = extension ? p : v(22.47, 0.2);
    const done = dragSelection(
      gesture,
      localToSheet(doc, view, cursor),
      { ...controls, objectTypes: [...controls.objectTypes], role: 'student' },
      null,
    );
    const expected = extension ? end : v(22, 0);
    expect(distance(point(done, segment.endPoint), expected)).toBeLessThan(1e-8);
    expect(point(done, segment.startPoint)).toEqual(fixed);
    expect(gesture.candidate).toMatchObject({
      label: extension ? '延长线交点' : '垂直 ∩ X 轴',
      guide: { kind: 'perpendicular' },
    });
    expect(gesture.candidate?.tracks).toHaveLength(extension ? 2 : 1);
  });

  it('uses a circle center as the radius grip anchor', () => {
    const center = v(22, 36);
    const doc = add(add(paper(), 'segment', v(14, 36), v(50, 36)), 'circle', center, v(31, 36));
    const circle = doc.entities.at(-1)!;
    const [grip] = cadGrips(doc, circle, 'student');
    const { origins } = gripDraftingTarget(doc, grip, [])!;
    const { position, candidate } = solve(doc, v(22.4, 0.3), origins, { exclude: [circle.id] });
    expect(candidate).toMatchObject({ label: '垂直 ∩ X 轴', anchor: center });
    expect(previewCadGrip(doc, grip, position, 'student').entities.at(-1)).toMatchObject({
      radius: 36,
    });
  });
});
