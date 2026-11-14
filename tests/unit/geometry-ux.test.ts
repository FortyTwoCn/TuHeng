import { describe, it, expect } from 'vitest';
import { GeometryDocument, GradingRequest } from '@tuheng/contracts';
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
  mergePoints,
  applyProperties,
  propertyValues,
  exportGeometryBundle,
  copyEntities,
  referenceGeometry,
  renameProjectionAxis,
  deleteProjectionAxis,
} from '@tuheng/geometry-core';
import { requestFixture } from '../fixtures';
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
describe('UX version and safety regressions', () => {
  it('keeps a frozen blue anchor including its spatial evidence during precise editing', () => {
    let d = addDrawing(
      createDocument('VHW_PROJECTION'),
      'point',
      'view-0',
      [{ x: 20, y: 30 }],
      'teacher',
    );
    const p = d.entities[0];
    if (p.kind !== 'point') throw Error();
    p.spatial = { x: 20, y: 0, z: 30 };
    d = addDrawing(
      d,
      'segment',
      'view-0',
      [
        { x: 20, y: 30 },
        { x: 40, y: 30 },
      ],
      'student',
      undefined,
      [p.id],
    );
    const line = d.entities.at(-1)!;
    const next = applyProperties(
      d,
      line.id,
      { ...propertyValues(d, line), length: '25' },
      'student',
    );
    expect(next.entities.find((e) => e.id === p.id)).toEqual(p);
  });
  it('rejects forged binding to the stem and cycles, allows only explicit safe references', () => {
    const d = connectionSheet(),
      lines = d.entities.filter((e) => e.kind === 'segment');
    const linked = adjustDirection(
      d,
      lines[1].id,
      { kind: 'entity', entityId: lines[0].id },
      'PERPENDICULAR',
      true,
      'student',
    );
    const cyclic = structuredClone(linked);
    cyclic.referenceRelations!.push({
      ...cyclic.referenceRelations![0],
      id: 'cycle',
      targetId: lines[0].id,
      reference: { kind: 'entity', entityId: lines[1].id },
    });
    expect(GeometryDocument.safeParse(cyclic).success).toBe(false);
    const merged = mergePoints(d, lines[0].endPoint, lines[1].startPoint, 'student');
    expect(() =>
      adjustDirection(
        merged,
        lines[0].id,
        { kind: 'baseAxis', axisId: 'Z' },
        'PARALLEL',
        true,
        'student',
      ),
    ).toThrow(/共享/);
    const frozen = structuredClone(linked);
    for (const e of frozen.entities)
      if (e.id === lines[1].id) {
        e.lineStyle = 'PROBLEM_VISIBLE';
        e.layerId = 'stem';
      }
    expect(GeometryDocument.safeParse(frozen).success).toBe(false);
  });
  it('requires v2.1-aware grading requests while still accepting saved v2.0 jobs', () => {
    const d = connectionSheet(),
      line = d.entities.find((e) => e.kind === 'segment')!;
    const revised = adjustDirection(
      d,
      line.id,
      { kind: 'baseAxis', axisId: 'X' },
      'PARALLEL',
      false,
      'student',
    );
    const request = requestFixture();
    const evidence = (answer: GeometryDocument) => ({
      schemaVersion: answer.schemaVersion,
      editorType: answer.editorType,
      problemDocument: createDocument('VHW_PROJECTION'),
      answerDocument: answer,
      derivedRelations: [],
      narrative: 'test',
    });
    expect(
      GradingRequest.safeParse({
        ...request,
        geometryEvidence: evidence(d),
        promptVersion: 'geometry-review/1.2.0',
      }).success,
    ).toBe(true);
    expect(
      GradingRequest.safeParse({
        ...request,
        geometryEvidence: evidence(revised),
        promptVersion: 'geometry-review/1.2.0',
      }).success,
    ).toBe(false);
    expect(
      GradingRequest.safeParse({
        ...request,
        geometryEvidence: evidence(revised),
        promptVersion: 'geometry-review/1.3.0',
      }).success,
    ).toBe(true);
  });
  it('does not correct a false declared direction while preparing grading evidence', () => {
    const d = connectionSheet(),
      lines = d.entities.filter((e) => e.kind === 'segment');
    const declared = adjustDirection(
      d,
      lines[1].id,
      { kind: 'entity', entityId: lines[0].id },
      'PARALLEL',
      true,
      'student',
    );
    const p = declared.entities.find((e) => e.id === lines[1].endPoint)!;
    if (p.kind !== 'point') throw Error();
    p.position.y += 8;
    const before = structuredClone(declared);
    const bundle = exportGeometryBundle(declared);
    expect(declared).toEqual(before);
    expect(bundle.narrative).toContain('INVALID');
  });
});
describe('UX reference geometry and command edge cases', () => {
  it.each([
    ['X', { x: 22, y: 0.3 }, { x: 22, y: 0 }],
    ['Z', { x: 0.3, y: 22 }, { x: 0, y: 22 }],
    ['Y_H', { x: 0.3, y: -22 }, { x: 0, y: -22 }],
    ['Y_W', { x: -22, y: 0.3 }, { x: -22, y: 0 }],
  ] as const)('snaps an independent point onto %s without a drawing origin', (axisId, p, q) => {
    const candidate = snapCandidates(createDocument('VHW_PROJECTION'), 'view-0', p, 4)[0];
    expect(candidate.kind).toBe('POINT_ON_REFERENCE');
    expect(candidate.reference).toEqual({ kind: 'baseAxis', axisId });
    expect(candidate.position.x).toBeCloseTo(q.x, 12);
    expect(candidate.position.y).toBeCloseTo(q.y, 12);
  });
  it('provides a separate origin for an offset auxiliary frame and renders each shared origin once', () => {
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
        anchor: { x: -40, y: -25 },
        through: { x: -10, y: -10 },
        side: 1,
      },
      'student',
    );
    const origins = referenceGeometry(d).filter((r) => r.extent === 'point');
    expect(origins).toHaveLength(2);
    expect(origins[1].anchor).toEqual({ x: -40, y: -25 });
    expect(origins[1].ref).toEqual({ kind: 'origin', frameId: d.auxiliarySystems![0].newViewId });
  });
  it('tests an arc by its real sweep rather than its complete circle bounds', () => {
    const d = addDrawing(
        createDocument('VHW_PROJECTION'),
        'arc',
        'view-0',
        [
          { x: 20, y: 20 },
          { x: 30, y: 20 },
          { x: 20, y: 30 },
        ],
        'student',
      ),
      a = d.entities.at(-1)!;
    expect(entityInMarquee(d, a, { x: -31, y: 19, width: 12, height: 12 }, 'window')).toBe(true);
    expect(entityInMarquee(d, a, { x: -17, y: 8, width: 8, height: 8 }, 'crossing')).toBe(false);
  });
  it('copies internal reference identities together and refuses silently losing an external binding', () => {
    const d = connectionSheet(),
      lines = d.entities.filter((e) => e.kind === 'segment'),
      bound = adjustDirection(
        d,
        lines[1].id,
        { kind: 'entity', entityId: lines[0].id },
        'PARALLEL',
        true,
        'student',
      );
    expect(() => copyEntities(bound, [lines[1].id], 'student')).toThrow(/外部绑定/);
    const copy = copyEntities(
      bound,
      lines.map((e) => e.id),
      'student',
    );
    expect(copy.referenceRelations).toHaveLength(2);
    const r = copy.referenceRelations![1];
    expect(r.targetId).not.toBe(lines[1].id);
    expect(r.reference).not.toEqual(bound.referenceRelations![0].reference);
    expect(GeometryDocument.safeParse(copy).success).toBe(true);
  });
});
it('protects frozen stem relation declarations and permission-revoked auxiliary axes', () => {
  const stem = addDrawing(
    createDocument('VHW_PROJECTION'),
    'point',
    'view-0',
    [{ x: 0, y: 20 }],
    'teacher',
  );
  const forged = structuredClone(stem);
  forged.schemaVersion = 'tuheng.geometry/2.1.0';
  forged.referenceRelations = [
    {
      id: 'forged-stem-reference',
      kind: 'POINT_ON_REFERENCE',
      targetId: stem.entities[0].id,
      reference: { kind: 'baseAxis', axisId: 'Z' },
      mode: 'POSITION',
      source: 'USER',
      status: 'SATISFIED',
    },
  ];
  expect(GeometryDocument.safeParse(forged).success).toBe(true);
  expect(() => combineAnswer(stem, forged)).toThrow('GEOMETRY_STEM_CHANGED');
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
      anchor: { x: -40, y: -25 },
      through: { x: -10, y: -10 },
      side: 1,
    },
    'student',
  );
  d.sheet!.allowAuxiliaryViews = false;
  expect(() => renameProjectionAxis(d, d.auxiliarySystems![0].id, 'X2', 'V2', 'student')).toThrow(
    /只读/,
  );
  expect(() => deleteProjectionAxis(d, d.auxiliarySystems![0].id, 'student')).toThrow(/只读/);
});
