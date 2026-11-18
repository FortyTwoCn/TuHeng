import { describe, expect, it } from 'vitest';
import { GeometryDocument } from '@tuheng/contracts';
import { readFileSync, readdirSync } from 'node:fs';
import { performanceDocument } from '../geometry-fixtures';
import {
  availableLineStyles,
  applyProperties,
  propertyValues,
  copyEntities,
  confirmSnap,
  clipLine,
  intersectsBox,
  parallel,
  perpendicular,
  planeFromPoints,
  relatedPlane,
  transact,
  arcSvgPath,
  setLineStyle,
  lineGeometry,
  spatialTranslation,
} from '@tuheng/geometry-core';
import {
  addDrawing,
  analyzeGeometryDocument,
  combineAnswer,
  createDocument,
  DocumentHistory,
  exportGeometryNarrative,
  fitStroke,
  intersect,
  linkProjection,
  loadGeometryDocument,
  minorArc,
  moveEntities,
  projectPoint,
  serializeGeometryDocument,
  snapCandidates,
} from '@tuheng/geometry-core';
describe('versioned geometry kernel', () => {
  it('moves spatial planes by the requested projected displacement in all views', () => {
    for (const type of ['VHW_PROJECTION', 'THREE_VIEW', 'ISOMETRIC', 'OBLIQUE_DIMETRIC'] as const) {
      const doc = createDocument(type);
      for (const view of doc.views) {
        const delta = { x: 7, y: -3 };
        const shift = spatialTranslation(doc, view.id, delta);
        expect(projectPoint(doc, shift, view.id).x).toBeCloseTo(delta.x, 8);
        expect(projectPoint(doc, shift, view.id).y).toBeCloseTo(delta.y, 8);
      }
    }
    const invalid = createDocument('ISOMETRIC');
    Object.values(invalid.projectionConfig.axes).forEach((a) => {
      a.angle = 0;
    });
    expect(GeometryDocument.safeParse(invalid).success).toBe(false);
    const duplicateAxes = createDocument('VHW_PROJECTION');
    duplicateAxes.views[0].mapping = ['x', 'x'];
    expect(GeometryDocument.safeParse(duplicateAxes).success).toBe(false);
  });
  it('keeps teacher and student selections on permissible layers and treats unchanged properties as a no-op', () => {
    const empty = createDocument('ISOMETRIC'),
      view = empty.views[0].id;
    const doc = addDrawing(
      empty,
      'segment',
      view,
      [
        { x: 0, y: 0 },
        { x: 10, y: 2 },
      ],
      'teacher',
    );
    const ids = doc.entities.map((e) => e.id);
    expect(availableLineStyles(doc, ids, 'teacher')).toEqual(['PROBLEM_VISIBLE', 'PROBLEM_HIDDEN']);
    expect(availableLineStyles(doc, ids, 'student')).toEqual([]);
    expect(() => setLineStyle(doc, ids.at(-1)!, 'ANSWER_HIDDEN', 'teacher')).toThrow();
    const e = doc.entities.at(-1)!;
    expect(applyProperties(doc, e.id, propertyValues(doc, e), 'teacher')).toBe(doc);
    const styled = ids.reduce((d, id) => setLineStyle(d, id, 'PROBLEM_HIDDEN', 'teacher'), doc);
    expect(
      styled.entities.every(
        (e) => e.lineStyle === 'PROBLEM_HIDDEN' && e.layerId === doc.entities[0].layerId,
      ),
    ).toBe(true);
    const history = new DocumentHistory(doc);
    history.commit(styled);
    expect(history.undo()).toEqual(doc);
  });
  it('copies shared geometry once and remaps both segment references together', () => {
    const base = createDocument('ISOMETRIC'),
      view = base.views[0].id;
    const one = addDrawing(
      base,
      'segment',
      view,
      [
        { x: 0, y: 0 },
        { x: 10, y: 2 },
      ],
      'student',
    );
    const first = one.entities.find((e) => e.kind === 'segment')!;
    const doc = addDrawing(
      one,
      'segment',
      view,
      [
        { x: 10, y: 2 },
        { x: 20, y: 8 },
      ],
      'student',
      undefined,
      [first.endPoint],
    );
    const ids = doc.entities.filter((e) => e.kind === 'segment').map((e) => e.id);
    const copied = copyEntities(doc, ids, 'student'),
      added = copied.entities.filter((e) => !doc.entities.some((o) => o.id === e.id));
    expect(added.filter((e) => e.kind === 'point')).toHaveLength(3);
    const segments = added.filter((e) => e.kind === 'segment');
    expect(segments[0].endPoint).toBe(segments[1].startPoint);
    expect(GeometryDocument.safeParse(copied).success).toBe(true);
  });
  it('changes line semantics while preserving IDs and renders complete signed arcs', () => {
    const doc = addDrawing(
      createDocument('ISOMETRIC'),
      'segment',
      'view-0',
      [{ x: 0, y: 0 }],
      'student',
    );
    const id = doc.entities.at(-1)!.id;
    const construction = setLineStyle(doc, id, 'CONSTRUCTION', 'student');
    const line = construction.entities.find((e) => e.id === id)!;
    expect(line.kind).toBe('line');
    expect(lineGeometry(construction, line).finite).toBe(false);
    const answer = setLineStyle(construction, id, 'ANSWER_HIDDEN', 'student');
    expect(answer.entities.find((e) => e.id === id)).toMatchObject({
      kind: 'segment',
      lineStyle: 'ANSWER_HIDDEN',
      layerId: 'answer',
    });
    expect(arcSvgPath({ x: 0, y: 0 }, 5, 0, 360).match(/ A /g)).toHaveLength(2);
    expect(arcSvgPath({ x: 0, y: 0 }, 5, 0, -360).match(/ A /g)).toHaveLength(2);
    expect(arcSvgPath({ x: 0, y: 0 }, 5, 0, 90).match(/ A /g)).toHaveLength(1);
  });
  it('does not confuse a segment endpoint touching a circle with a tangent', () => {
    let d = addDrawing(
      createDocument('VHW_PROJECTION'),
      'segment',
      'view-0',
      [
        { x: 5, y: 0 },
        { x: 10, y: 0 },
      ],
      'student',
    );
    d = addDrawing(
      d,
      'circle',
      'view-0',
      [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
      ],
      'student',
    );
    expect(analyzeGeometryDocument(d).some((r) => r.kind === 'TANGENT')).toBe(false);
  });
  it('loads all four supplied JSON examples through the real schema', () => {
    const files = readdirSync('docs/geometry-examples').filter((f) => f.endsWith('.json'));
    expect(files).toHaveLength(4);
    for (const file of files)
      expect(
        loadGeometryDocument(readFileSync(`docs/geometry-examples/${file}`, 'utf8')).entities
          .length,
      ).toBeGreaterThan(0);
  });
  it('rejects cyclic references, invalid constraints and oversized documents', () => {
    let d = addDrawing(
      createDocument('VHW_PROJECTION'),
      'line',
      'view-0',
      [{ x: 0, y: 0 }],
      'student',
    );
    d = addDrawing(d, 'line', 'view-0', [{ x: 10, y: 0 }], 'student');
    if (d.entities[0].kind === 'line' && d.entities[1].kind === 'line') {
      d.entities[0].referenceEntityId = d.entities[1].id;
      d.entities[1].referenceEntityId = d.entities[0].id;
    }
    expect(GeometryDocument.safeParse(d).success).toBe(false);
    expect(() => loadGeometryDocument(' '.repeat(2_000_001))).toThrow('2MB');
    d = addDrawing(
      createDocument('VHW_PROJECTION'),
      'segment',
      'view-0',
      [{ x: 0, y: 0 }],
      'student',
    );
    d.constraints.push({
      id: 'wrong',
      kind: 'PARALLEL',
      entityIds: [d.entities[0].id, d.entities[1].id],
      source: 'USER',
    });
    expect(GeometryDocument.safeParse(d).success).toBe(false);
  });
  it('confirms snapping provenance and preserves raw coordinates when not accepted', () => {
    const before = addDrawing(
      createDocument('VHW_PROJECTION'),
      'point',
      'view-0',
      [{ x: 4, y: 4 }],
      'student',
    );
    const raw = addDrawing(before, 'point', 'view-0', [{ x: 4.1, y: 4.1 }], 'student');
    const candidate = snapCandidates(before, 'view-0', { x: 4.1, y: 4.1 }, 4)[0];
    const snapped = confirmSnap(
      before,
      addDrawing(before, 'point', 'view-0', [candidate.position], 'student'),
      candidate,
    );
    expect(snapped.entities.filter((e) => e.kind === 'point')).toHaveLength(1);
    expect(snapped.entities[0]).toMatchObject({ mergedFrom: expect.any(Array) });
    expect(raw.constraints).toHaveLength(0);
    expect(raw.entities.at(-1)).toMatchObject({ position: { x: 4.1, y: 4.1 } });
  });
  it('handles finite selections and independent planes without assuming a unique perpendicular plane', () => {
    expect(parallel({ x: 2, y: 0 }, { x: -1, y: 0 })).toBe(true);
    expect(perpendicular({ x: 1, y: 0 }, { x: 0, y: 1 })).toBe(true);
    expect(
      clipLine(
        { a: { x: 0, y: 0 }, d: { x: 1, y: 0 }, finite: false },
        { x: -5, y: -5, width: 10, height: 10 },
      ),
    ).toEqual([
      { x: -5, y: 0 },
      { x: 5, y: 0 },
    ]);
    const d = addDrawing(
      createDocument('VHW_PROJECTION'),
      'segment',
      'view-0',
      [
        { x: -20, y: 0 },
        { x: 20, y: 0 },
      ],
      'student',
    );
    expect(intersectsBox(d, d.entities.at(-1)!, { x: -1, y: -1, width: 2, height: 2 })).toBe(true);
    expect(() =>
      planeFromPoints({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }),
    ).toThrow();
    const plane = planeFromPoints({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    const withPlane = transact(d, (draft) =>
      draft.entities.push({
        id: 'plane',
        kind: 'plane',
        viewId: 'view-0',
        layerId: 'construction',
        lineStyle: 'CONSTRUCTION',
        ...plane,
        referencePlaneId: null,
        relation: 'ARBITRARY',
      }),
    );
    expect(() =>
      relatedPlane(withPlane, 'plane', 'PERPENDICULAR', 0, { x: 0, y: 0, z: 1 }, 'student'),
    ).toThrow();
    expect(
      relatedPlane(withPlane, 'plane', 'PARALLEL', 5, { x: 1, y: 0, z: 0 }, 'student').entities.at(
        -1,
      ),
    ).toMatchObject({ origin: { x: 0, y: 0, z: 5 } });
  });
  it('analyzes the required multi-object fixture within a bounded runtime', () => {
    const d = GeometryDocument.parse(performanceDocument());
    const start = performance.now();
    const narrative = exportGeometryNarrative(d);
    const elapsed = performance.now() - start;
    expect(narrative.length).toBeLessThan(1_000_000);
    expect(elapsed).toBeLessThan(2000);
    console.log(
      `Geometry fixture ${d.entities.length} entities, analysis ${elapsed.toFixed(1)} ms`,
    );
  });
  it('maps all four projections with explicit axes and signs', () => {
    const p = { x: 10, y: 20, z: 30 };
    for (const type of ['VHW_PROJECTION', 'THREE_VIEW'] as const) {
      const d = createDocument(type);
      expect(projectPoint(d, p, 'view-0')).toEqual({ x: 10, y: 30 });
      expect(projectPoint(d, p, 'view-1')).toEqual({ x: 10, y: -20 });
      expect(projectPoint(d, p, 'view-2')).toEqual({ x: 20, y: 30 });
    }
    expect(projectPoint(createDocument('ISOMETRIC'), { x: 1, y: 0, z: 0 }, 'view-0').x).toBeCloseTo(
      -Math.sqrt(3) / 2,
    );
    const oblique = projectPoint(createDocument('OBLIQUE_DIMETRIC'), p, 'view-0');
    expect(oblique.x).toBeCloseTo(10 - 10 / Math.sqrt(2));
    expect(oblique.y).toBeCloseTo(30 - 10 / Math.sqrt(2));
  });
  it('validates dangling references, versions, finite numbers and duplicate IDs', () => {
    const d = addDrawing(
      createDocument('VHW_PROJECTION'),
      'segment',
      'view-0',
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      'student',
    );
    expect(loadGeometryDocument(serializeGeometryDocument(d))).toEqual(d);
    expect(GeometryDocument.safeParse({ ...d, schemaVersion: 'future' }).success).toBe(false);
    expect(GeometryDocument.safeParse({ ...d, entities: d.entities.slice(1) }).success).toBe(false);
    expect(
      GeometryDocument.safeParse({ ...d, entities: [...d.entities, d.entities[0]] }).success,
    ).toBe(false);
    const bad = structuredClone(d);
    if (bad.entities[0].kind === 'point') bad.entities[0].position.x = Infinity;
    expect(GeometryDocument.safeParse(bad).success).toBe(false);
  });
  it('links projections without correcting student errors and exports measured deviation', () => {
    let d = addDrawing(
      createDocument('VHW_PROJECTION'),
      'point',
      'view-0',
      [{ x: 10, y: 5 }],
      'student',
    );
    d = addDrawing(d, 'point', 'view-1', [{ x: 12, y: 4 }], 'student');
    const before = structuredClone(d.entities);
    d = linkProjection(
      d,
      d.entities.map((e) => e.id),
    );
    expect(d.entities).toEqual(before);
    expect(analyzeGeometryDocument(d)[0].deviation).toBe(2);
    expect(exportGeometryNarrative(d)).toContain('2.000 mm');
    const history = new DocumentHistory(d);
    history.commit(moveEntities(d, [d.entities[1].id], { x: 3, y: 0 }, 'student'));
    expect(history.undo()).toEqual(d);
    expect(history.redo()).not.toEqual(d);
  });
  it('rejects altered or deleted teacher entities and accepts independent answers', () => {
    const stem = addDrawing(
      createDocument('THREE_VIEW'),
      'segment',
      'view-0',
      [{ x: 0, y: 0 }],
      'teacher',
    );
    const answer = addDrawing(stem, 'hidden', 'view-0', [{ x: 10, y: 10 }], 'student');
    expect(combineAnswer(stem, answer).entities).toHaveLength(6);
    const reordered = {
      ...stem,
      entities: stem.entities.map((e) => Object.fromEntries(Object.entries(e).reverse())),
    } as GeometryDocument;
    expect(combineAnswer(reordered, answer)).toEqual(answer);
    expect(() => combineAnswer(stem, { ...answer, entities: answer.entities.slice(1) })).toThrow();
    expect(() => moveEntities(answer, [stem.entities[0].id], { x: 1, y: 0 }, 'student')).toThrow();
  });
  it('clips finite intersections and picks a minor arc', () => {
    expect(
      intersect(
        { a: { x: 0, y: 0 }, d: { x: 10, y: 0 }, finite: true },
        { a: { x: 5, y: -5 }, d: { x: 0, y: 10 }, finite: true },
      ),
    ).toEqual({ x: 5, y: 0 });
    expect(minorArc({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }).sweep).toBe(-90);
    const d = addDrawing(
      createDocument('VHW_PROJECTION'),
      'point',
      'view-0',
      [{ x: 2, y: 2 }],
      'student',
    );
    expect(snapCandidates(d, 'view-0', { x: 2.1, y: 2.1 }, 5)[0].kind).toBe('COINCIDENT');
    expect(snapCandidates(d, 'view-0', { x: 2.1, y: 2.1 }, 1000)).toHaveLength(0);
  });
});
describe('deterministic pen fitting', () => {
  it('recognizes straight strokes, circles and arcs', () => {
    expect(
      fitStroke(Array.from({ length: 30 }, (_, i) => ({ x: i, y: 0.1 * Math.sin(i) }))).kind,
    ).toBe('segment');
    const arc = (sweep: number) =>
      Array.from({ length: 80 }, (_, i) => ({
        x: 20 * Math.cos((sweep * i) / 79),
        y: 20 * Math.sin((sweep * i) / 79),
      }));
    expect(fitStroke(arc(Math.PI * 2)).kind).toBe('circle');
    expect(fitStroke(arc(Math.PI)).kind).toBe('arc');
  });
  it('preserves short, noisy, curved and retraced strokes', () => {
    for (const points of [
      [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
      Array.from({ length: 40 }, (_, i) => ({ x: i, y: 5 * Math.sin(i) })),
      Array.from({ length: 40 }, (_, i) => ({ x: i < 20 ? i : 40 - i, y: 0 })),
    ])
      expect(fitStroke(points)).toEqual({ kind: 'polyline', points });
  });
});
