import { describe, it, expect } from 'vitest';
import { GeometryDocument } from '@tuheng/contracts';
import {
  createDocument,
  addDrawing,
  addProjectionAxis,
  snapCandidates,
  closestReference,
  resolveReference,
  entityInMarquee,
  setSegmentParameters,
  DocumentHistory,
  adjustDirection,
  moveEntities,
  lineGeometry,
  constructLine,
  point,
  previewTransform,
  bindToReference,
  combineAnswer,
} from '@tuheng/geometry-core';
import { connectionSheet } from '../repair-fixtures';
describe('UX references and snapping', () => {
  it.each([2, 4, 8])('snaps by CSS pixels and refreshes the axis foot at %s px/mm', (scale) => {
    const d = createDocument('VHW_PROJECTION');
    const first = snapCandidates(d, 'view-0', { x: 5 / scale, y: 25 }, scale)[0];
    expect(first.reference).toEqual({ kind: 'baseAxis', axisId: 'Z' });
    expect(first.position).toEqual({ x: 0, y: 25 });
    const next = snapCandidates(d, 'view-0', { x: 5 / scale, y: 28 }, scale, undefined, {
      previous: first,
    })[0];
    expect(next.position).toEqual({ x: 0, y: 28 });
    expect(snapCandidates(d, 'view-0', { x: 0.2, y: 0.2 }, scale)[0].kind).toBe('ORIGIN');
    expect(
      snapCandidates(d, 'view-0', { x: 0.2, y: 20 }, scale, undefined, { axes: false }),
    ).toEqual([]);
  });
  it('resolves oblique offset axes and clamps reference rays', () => {
    const d = addProjectionAxis(
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
    const r = resolveReference(d, { kind: 'projectionAxis', systemId: d.auxiliarySystems![0].id });
    expect(closestReference({ x: 17, y: 8 }, r)).toEqual({ x: 14.5, y: 10.5 });
    expect(
      closestReference({ x: 5, y: 4 }, resolveReference(d, { kind: 'baseAxis', axisId: 'X' })),
    ).toEqual({ x: 0, y: 0 });
  });
});
describe('UX exact selection', () => {
  it('separates containment from crossing for circles, arcs and infinite lines', () => {
    let d = addDrawing(
      createDocument('VHW_PROJECTION'),
      'circle',
      'view-0',
      [
        { x: 20, y: 20 },
        { x: 30, y: 20 },
      ],
      'student',
    );
    const circle = d.entities.at(-1)!;
    expect(entityInMarquee(d, circle, { x: -35, y: 5, width: 30, height: 30 }, 'window')).toBe(
      true,
    );
    expect(entityInMarquee(d, circle, { x: -22, y: 18, width: 4, height: 4 }, 'crossing')).toBe(
      false,
    );
    expect(entityInMarquee(d, circle, { x: -31, y: 19, width: 3, height: 3 }, 'crossing')).toBe(
      true,
    );
    d = addDrawing(
      d,
      'line',
      'view-0',
      [
        { x: 0, y: 0 },
        { x: 20, y: 20 },
      ],
      'student',
    );
    expect(
      entityInMarquee(d, d.entities.at(-1)!, { x: -30, y: 0, width: 30, height: 30 }, 'window'),
    ).toBe(false);
    expect(
      entityInMarquee(d, d.entities.at(-1)!, { x: -30, y: 0, width: 30, height: 30 }, 'crossing'),
    ).toBe(true);
  });
});
describe('UX commands and dependencies', () => {
  it('edits precise dimensions with a fixed midpoint in one history and rejects shared endpoints', () => {
    const d = connectionSheet(),
      e = d.entities.find((e) => e.kind === 'segment')!;
    if (e.kind !== 'segment') throw Error();
    const history = new DocumentHistory(d),
      next = setSegmentParameters(d, e.id, 40, 90, 'midpoint', 'student');
    history.commit(next);
    expect(point(next, e.startPoint)).toEqual({ x: 42.5, y: 15 });
    expect(history.undo()).toEqual(d);
    expect(() => setSegmentParameters(d, e.id, -1, 90, 'start', 'student')).toThrow();
  });
  it('constructs on a read-only axis, reuses a point and maintains an explicit directed relation', () => {
    let d = addDrawing(
      createDocument('VHW_PROJECTION'),
      'point',
      'view-0',
      [{ x: 15, y: 15 }],
      'student',
    );
    const p = d.entities[0];
    d = constructLine(
      d,
      'view-0',
      { kind: 'baseAxis', axisId: 'X' },
      { x: 15, y: 15 },
      p.id,
      {
        directionMode: 'PARALLEL',
        geometryExtent: 'segment',
        semanticStyle: 'visible',
        length: 10,
      },
      'student',
    );
    const line = d.entities.at(-1)!;
    expect(line).toMatchObject({ kind: 'segment', startPoint: p.id });
    expect(d.schemaVersion).toBe('tuheng.geometry/2.1.0');
    expect(GeometryDocument.parse(d)).toEqual(d);
    const bound = bindToReference(d, p.id, { kind: 'baseAxis', axisId: 'Z' }, 'student');
    expect(point(previewTransform(bound, [p.id], { x: 9, y: 4 }, 'student'), p.id)).toEqual({
      x: 0,
      y: 19,
    });
    expect(combineAnswer(createDocument('VHW_PROJECTION'), d)).toEqual(d);
  });
  it('keeps reference geometry fixed, propagates directed parallelism and rejects cyclic or missing references', () => {
    const d = connectionSheet(),
      lines = d.entities.filter((e) => e.kind === 'segment');
    const related = adjustDirection(
      d,
      lines[1].id,
      { kind: 'entity', entityId: lines[0].id },
      'PARALLEL',
      true,
      'student',
    );
    expect(related.entities.find((e) => e.id === lines[0].id)).toEqual(lines[0]);
    const moved = moveEntities(related, [lines[0].endPoint], { x: 0, y: 10 }, 'student');
    const a = lineGeometry(moved, lines[0]).d,
      b = lineGeometry(moved, lines[1]).d;
    expect(a.x * b.y - a.y * b.x).toBeCloseTo(0);
    const bad = structuredClone(related);
    bad.referenceRelations![0].reference = { kind: 'projectionAxis', systemId: 'missing' };
    expect(GeometryDocument.safeParse(bad).success).toBe(false);
  });
});
