import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { GeometryDocument } from '@tuheng/contracts';
import {
  createDocument,
  projectPoint,
  localToSheet,
  sheetToLocal,
  upgradeGeometryDocument,
  addProjectionAxis,
  changedPlaneProjection,
  deleteProjectionAxis,
  serializeGeometryDocument,
  loadGeometryDocument,
  combineAnswer,
  addDrawing,
  mergePoints,
  moveEntities,
  DocumentHistory,
  disconnectEndpoint,
  snapCandidates,
  fitStroke,
  addPenStroke,
  exportGeometryNarrative,
  transact,
  appendStrokeSample,
  importPenStroke,
  exportSheetSvg,
} from '@tuheng/geometry-core';
import { connectionSheet, penSample } from '../repair-fixtures';
import { dragDocument } from '../../packages/geometry-editor/src/interaction-controller';
const spec = {
  name: 'X1',
  viewName: 'V1',
  retainedViewId: 'view-1',
  replacedViewId: 'view-0',
  parentId: null,
  method: 'FREE' as const,
  referenceEntityId: null,
  anchor: { x: -50, y: 0 },
  through: { x: -50, y: 20 },
  side: 1 as const,
};
describe('unfolded sheet and versioned systems', () => {
  it.each(['VHW_PROJECTION', 'THREE_VIEW'] as const)(
    'maps %s through one invertible millimetre sheet',
    (type) => {
      const doc = createDocument(type),
        positions = [
          { x: -30, y: 40 },
          { x: -30, y: -20 },
          { x: 20, y: 40 },
        ];
      doc.views.forEach((v, i) => {
        const local = projectPoint(doc, { x: 30, y: 20, z: 40 }, v.id);
        expect(localToSheet(doc, v.id, local)).toEqual(positions[i]);
        expect(sheetToLocal(doc, v.id, positions[i])).toEqual(local);
      });
    },
  );
  it('reads old JSON without changing its snapshot and explicitly upgrades a new draft', () => {
    const old = JSON.parse(readFileSync('docs/geometry-examples/VHW_PROJECTION.json', 'utf8'));
    const before = JSON.stringify(old);
    const parsed = loadGeometryDocument(JSON.stringify(old));
    expect(parsed.schemaVersion).toBe('tuheng.geometry/1.0.0');
    const upgraded = upgradeGeometryDocument(parsed);
    expect(upgraded.schemaVersion).toBe('tuheng.geometry/2.0.0');
    expect(JSON.stringify(old)).toBe(before);
    for (const e of parsed.entities)
      if (e.kind === 'point') expect(upgraded.entities.find((p) => p.id === e.id)).toEqual(e);
    expect(combineAnswer(parsed, upgraded)).toEqual(upgraded);
  });
  it('saves a new answer to a legacy stem with constraints and recalculates untrusted status', () => {
    const old = GeometryDocument.parse(
      JSON.parse(readFileSync('docs/geometry-examples/VHW_PROJECTION.json', 'utf8')),
    );
    const line = old.entities.find((e) => e.kind === 'segment')!;
    if (line.kind !== 'segment') throw Error();
    old.constraints.push({
      id: 'legacy-on-line',
      kind: 'POINT_ON_LINE',
      entityIds: [line.startPoint, line.id],
      source: 'USER',
    });
    const snapshot = JSON.stringify(old);
    const answer = addDrawing(
      upgradeGeometryDocument(old),
      'point',
      'view-1',
      [{ x: 75, y: 25 }],
      'student',
    );
    answer.constraints[0].status = 'INVALID';
    expect(combineAnswer(old, answer).constraints[0].status).toBe('SATISFIED');
    expect(JSON.stringify(old)).toBe(snapshot);
    const forged = structuredClone(answer);
    forged.constraints[0].kind = 'MIDPOINT';
    expect(() => combineAnswer(old, forged)).toThrow('GEOMETRY_STEM_CHANGED');
  });
  it('changes planes using signed distance, supports two levels, reload, undo, and rejects cycles', () => {
    const base = createDocument('VHW_PROJECTION'),
      first = addProjectionAxis(base, spec, 'student'),
      a = first.auxiliarySystems![0];
    expect(first.entities).toEqual([]);
    expect(changedPlaneProjection({ x: -30, y: -20 }, { x: -30, y: 40 }, a)).toEqual({
      x: -90,
      y: -20,
    });
    expect(changedPlaneProjection({ x: -30, y: -20 }, { x: -30, y: -40 }, a)).toEqual({
      x: -10,
      y: -20,
    });
    const second = addProjectionAxis(
      first,
      {
        ...spec,
        name: 'X2',
        viewName: 'H1',
        parentId: a.id,
        retainedViewId: a.newViewId,
        replacedViewId: a.retainedViewId,
        anchor: { x: -70, y: -10 },
        through: { x: -50, y: -10 },
      },
      'student',
    );
    expect(loadGeometryDocument(serializeGeometryDocument(second))).toEqual(second);
    const history = new DocumentHistory(base);
    history.commit(first);
    history.commit(second);
    expect(history.undo()).toEqual(first);
    expect(history.redo()).toEqual(second);
    expect(() => deleteProjectionAxis(second, a.id, 'student')).toThrow('依赖');
    const bad = structuredClone(second);
    bad.auxiliarySystems![0].parentId = bad.auxiliarySystems![1].id;
    expect(GeometryDocument.safeParse(bad).success).toBe(false);
  });
  it('allows permitted student axes but protects original systems and reference ownership', () => {
    const stem = addProjectionAxis(createDocument('VHW_PROJECTION'), spec, 'teacher');
    const a = stem.auxiliarySystems![0];
    const answer = addProjectionAxis(
      stem,
      {
        ...spec,
        name: 'X2',
        viewName: 'H1',
        parentId: a.id,
        retainedViewId: a.newViewId,
        replacedViewId: a.retainedViewId,
      },
      'student',
    );
    expect(combineAnswer(stem, answer)).toEqual(answer);
    const forged = structuredClone(answer);
    forged.views[0].transform!.origin.x = 2;
    expect(() => combineAnswer(stem, forged)).toThrow('GEOMETRY_STEM_CHANGED');
    const denied = structuredClone(stem);
    denied.sheet!.allowAuxiliaryViews = false;
    expect(() => addProjectionAxis(denied, { ...spec, name: 'X2' }, 'student')).toThrow('不允许');
  });
});
describe('topological dragging and history', () => {
  it('merges references, moves shared nodes once, cancels snapping without undoing the drag', () => {
    const base = connectionSheet(),
      lines = base.entities.filter((e) => e.kind === 'segment'),
      source = lines[0].endPoint,
      target = lines[1].startPoint;
    const p = base.entities.find((e) => e.id === target)!;
    if (p.kind !== 'point') throw Error();
    const raw = moveEntities(base, [source], { x: -18, y: -19 }, 'student');
    const merged = mergePoints(raw, source, target, 'student');
    expect(merged.entities.filter((e) => e.kind === 'point')).toHaveLength(3);
    expect(merged.entities.find((e) => e.id === lines[0].id)).toMatchObject({ endPoint: target });
    const moved = dragDocument(
      merged,
      lines.map((e) => e.id),
      { x: 4, y: 3 },
      'student',
    );
    expect(moved.entities.find((e) => e.id === target)).toMatchObject({
      position: { x: p.position.x - 4, y: p.position.y + 3 },
    });
    const h = new DocumentHistory(base);
    h.commit(merged);
    h.replaceCurrent(raw);
    expect(h.undo()).toEqual(base);
    expect(h.redo()).toEqual(raw);
    expect(loadGeometryDocument(serializeGeometryDocument(merged))).toEqual(merged);
  });
  it('rejects zero length and cross-frame merge; anchors to stem without altering it', () => {
    let doc = connectionSheet();
    const line = doc.entities.find((e) => e.kind === 'segment')!;
    if (line.kind !== 'segment') throw Error();
    expect(() => mergePoints(doc, line.startPoint, line.endPoint, 'student')).toThrow();
    doc = addDrawing(doc, 'point', 'view-1', [{ x: 0, y: 0 }], 'student');
    expect(() => mergePoints(doc, line.startPoint, doc.entities.at(-1)!.id, 'student')).toThrow(
      '同一投影',
    );
    doc = addDrawing(doc, 'point', 'view-0', [{ x: 20, y: 20 }], 'teacher');
    const stem = doc.entities.at(-1)!;
    const joined = mergePoints(doc, line.endPoint, stem.id, 'student');
    expect(joined.entities.find((e) => e.id === stem.id)).toEqual(stem);
    expect(() => moveEntities(joined, [line.id], { x: 1, y: 0 }, 'student')).toThrow('只读');
    expect(disconnectEndpoint(joined, line.id, stem.id, 'student').entities).toHaveLength(
      joined.entities.length + 1,
    );
  });
  it('prioritizes endpoints over grid, ignores hidden/self points and recomputes constraint validity', () => {
    const doc = connectionSheet(),
      p = doc.entities.find((e) => e.kind === 'point')!;
    if (p.kind !== 'point') throw Error();
    expect(
      snapCandidates(doc, p.viewId, { x: p.position.x + 0.1, y: p.position.y }, 4, undefined, {
        grid: true,
      })[0].kind,
    ).toBe('COINCIDENT');
    expect(
      snapCandidates(doc, p.viewId, p.position, 4, undefined, { hiddenLayers: ['answer'] }),
    ).toEqual([]);
    const lines = doc.entities.filter((e) => e.kind === 'segment');
    const declared = transact(doc, (d) =>
      d.constraints.push({
        id: 'declared',
        kind: 'PARALLEL',
        entityIds: lines.map((e) => e.id),
        source: 'USER',
      }),
    );
    expect(exportGeometryNarrative(declared)).toContain('INVALID');
  });
});
describe('scale-aware pen fitting', () => {
  it.each([3, 12])('robust to speed, jitter, direction and a 3px outlier at %s px/mm', (scale) => {
    for (const direction of [1, -1])
      for (const sweep of [360, 230]) {
        const points = penSample(scale, direction, sweep),
          fit = fitStroke(points, { cssPixelsPerMm: scale });
        expect(fit.kind).toBe(sweep === 360 ? 'circle' : 'arc');
        if (fit.kind === 'arc') expect(Math.sign(fit.sweep)).toBe(direction);
        const d = addPenStroke(createDocument('VHW_PROJECTION'), 'view-0', points, 'student', {
          cssPixelsPerMm: scale,
        });
        expect(d.entities.at(-1)!.kind).toBe(fit.kind);
      }
  });
  it.each(['ellipse', 'eight'])('keeps %s as raw geometry', (shape) => {
    expect(fitStroke(penSample(3, 1, 360, shape), { cssPixelsPerMm: 3 }).kind).toBe('polyline');
  });
  it('retains irregular scribbles and degenerate input', () => {
    expect(fitStroke([{ x: 0, y: 0 }])).toMatchObject({ kind: 'polyline' });
    expect(
      fitStroke(
        Array.from({ length: 100 }, (_, i) => ({
          x: Math.sin(i * 1.3) * 20,
          y: Math.cos(i * 2.9) * 20,
        })),
      ),
    ).toMatchObject({ kind: 'polyline' });
  });
});

describe('dependency and import boundaries', () => {
  it('recomputes explicit intersection bindings and marks missing intersections invalid', () => {
    let d = addDrawing(
      createDocument('VHW_PROJECTION'),
      'segment',
      'view-0',
      [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
      ],
      'student',
    );
    d = addDrawing(
      d,
      'segment',
      'view-0',
      [
        { x: 10, y: -10 },
        { x: 10, y: 10 },
      ],
      'student',
    );
    d = addDrawing(d, 'point', 'view-0', [{ x: 10, y: 0 }], 'student');
    const lines = d.entities.filter((e) => e.kind === 'segment'),
      p = d.entities.at(-1)!;
    d = transact(d, (draft) =>
      draft.constraints.push({
        id: 'bound',
        kind: 'INTERSECTION',
        entityIds: [p.id, ...lines.map((e) => e.id)],
        source: 'USER',
        mode: 'BINDING',
      }),
    );
    d = moveEntities(d, [lines[1].id], { x: 5, y: 0 }, 'student');
    expect(d.entities.at(-1)).toMatchObject({ position: { x: 15, y: 0 } });
    d = moveEntities(d, [lines[1].id], { x: 0, y: 50 }, 'student');
    expect(d.constraints[0].status).toBe('INVALID');
    expect(d.entities.at(-1)).toMatchObject({ position: { x: 15, y: 0 } });
    const cycle = structuredClone(d);
    cycle.constraints[0].entityIds[0] = lines[0].startPoint;
    expect(GeometryDocument.safeParse(cycle).success).toBe(false);
  });
  it('reports submitted binding errors without correcting the submitted point during analysis', () => {
    let d = connectionSheet();
    const lines = d.entities.filter((e) => e.kind === 'segment');
    // Make the two finite segments intersect at local (10,35).
    const left = d.entities.find((e) => e.id === lines[0].endPoint)!;
    if (left.kind !== 'point') throw Error();
    left.position.x = 0;
    d = addDrawing(d, 'point', 'view-0', [{ x: 10, y: 35 }], 'student');
    d.constraints.push({
      id: 'submitted-binding',
      kind: 'INTERSECTION',
      mode: 'BINDING',
      status: 'SATISFIED',
      source: 'USER',
      entityIds: [d.entities.at(-1)!.id, ...lines.map((e) => e.id)],
    });
    const p = d.entities.at(-1)!;
    if (p.kind !== 'point') throw Error();
    p.position = { x: 12, y: 38 };
    const snapshot = JSON.stringify(d);
    expect(exportGeometryNarrative(d)).toContain('INVALID');
    expect(JSON.stringify(d)).toBe(snapshot);
  });
  it('uses a versioned portable stroke input and exports the complete sheet independently of camera', () => {
    const doc = importPenStroke(
      createDocument('VHW_PROJECTION'),
      {
        schemaVersion: 'tuheng.stroke/1.0.0',
        coordinateSpace: 'VIEW_LOCAL_MM',
        viewId: 'view-0',
        cssPixelsPerMm: 3,
        pointerType: 'pen',
        samples: penSample(3),
      },
      'view-0',
      'student',
    );
    expect(doc.entities.at(-1)).toMatchObject({ kind: 'circle', sampling: { cssPixelsPerMm: 3 } });
    const svg = exportSheetSvg(addProjectionAxis(doc, spec, 'student'));
    expect(svg).toContain('data-axis-id');
    expect(svg).not.toContain('data-transient');
    expect(svg).toContain(doc.entities.at(-1)!.id);
    expect(() => importPenStroke(doc, { schemaVersion: 'unknown' }, 'view-0', 'student')).toThrow();
  });
  it('rewrites circle centres and refuses to pretend a cross-projection coincidence is a merge', () => {
    let doc = addDrawing(
      createDocument('VHW_PROJECTION'),
      'circle',
      'view-0',
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      'student',
    );
    const circle = doc.entities.at(-1)!;
    if (circle.kind !== 'circle') throw Error();
    doc = addDrawing(doc, 'point', 'view-0', [{ x: 3, y: 4 }], 'student');
    const target = doc.entities.at(-1)!.id;
    const merged = mergePoints(doc, circle.center, target, 'student');
    expect(merged.entities.find((e) => e.id === circle.id)).toMatchObject({ center: target });
    expect(merged.entities.some((e) => e.id === circle.center)).toBe(false);
    const h = addDrawing(merged, 'point', 'view-1', [{ x: 3, y: 4 }], 'student');
    expect(() => mergePoints(h, target, h.entities.at(-1)!.id, 'student')).toThrow('同一投影');
  });
});

it('keeps the final pen position when the bounded sample buffer is full', () => {
  const samples = Array.from({ length: 4096 }, (_, i) => ({ x: i, y: 0, pressure: 0.5 }));
  appendStrokeSample(samples, { x: 5000, y: 3, pressure: 0 }, 0.01);
  expect(samples).toHaveLength(4096);
  expect(samples.at(-1)).toEqual({ x: 5000, y: 3, pressure: 0 });
});
