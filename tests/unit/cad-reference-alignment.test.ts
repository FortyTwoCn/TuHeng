import { describe, expect, it } from 'vitest';
import {
  addDrawing,
  cadStep,
  commonTangentCandidates,
  cornerAt,
  createDocument,
  distance,
  exportCadPackage,
  exportSheetSvg,
  hatchStrokes,
  loadGeometryDocument,
  localToSheet,
  nearestDraftingCandidate,
  point,
  readCadPackage,
  resolveReference,
  serializeGeometryDocument,
  sheetToLocal,
  snapCandidates,
  startCadSession,
  trackingCandidate,
  trimInBox,
  transformSelection,
  applyProperties,
  cadDrawing,
  cubicAt,
  curveSegments,
  dimensionValue,
  propertyValues,
  previewCadGrip,
} from '@tuheng/geometry-core';
import type { GeometryDocument } from '@tuheng/contracts';

const v = (x: number, y: number) => ({ x, y });
const view = 'view-0';
const base = () => createDocument('ISOMETRIC');
const line = (doc: GeometryDocument, a: ReturnType<typeof v>, b: ReturnType<typeof v>) =>
  addDrawing(doc, 'segment', doc.views[0].id, [a, b], 'student');
const circle = (doc: GeometryDocument, c: ReturnType<typeof v>, r: number) =>
  addDrawing(doc, 'circle', view, [c, v(c.x + r, c.y)], 'student');
function selected(doc: GeometryDocument, id: string) {
  const e = doc.entities.find((e) => e.id === id)!;
  if (e.kind !== 'segment') throw Error('测试线段缺失');
  return [point(doc, e.startPoint), point(doc, e.endPoint)];
}
const opts = { axes: false, objects: true };
describe('参考作图的几何落点', () => {
  it('renders and snaps to the 45-degree transfer ray strictly on its positive side', () => {
    let doc = createDocument('THREE_VIEW');
    const id = doc.views[0].id;
    const local = (x: number, y: number) => sheetToLocal(doc, id, v(x, y));
    doc = line(doc, local(30, -50), local(70, -50));
    const ref = { kind: 'baseAxis', axisId: 'MITER_45' } as const;
    expect(resolveReference(doc, ref).name).toContain('传宽线');
    const hit = snapCandidates(doc, id, local(50.3, -50), 4, undefined, {
      objectTypes: ['intersection'],
    }).find((s) => s.references?.some((r) => r.kind === 'baseAxis' && r.axisId === 'MITER_45'))!;
    expect(localToSheet(doc, id, hit.position)).toEqual(v(50, -50));
    expect(exportSheetSvg(doc)).toContain('axis:MITER_45');
    expect(() => resolveReference(base(), ref)).toThrow();
  });
  it('retains different tracking bases, including an oblique extension, and uses their intersections', () => {
    const doc = base();
    const bases = [{ position: v(22, 42) }, { position: v(56, 10) }];
    const ortho = trackingCandidate(doc, view, v(55.7, 41.6), bases, 1, opts)!;
    expect(ortho.position).toEqual(v(56, 42));
    const diag = trackingCandidate(
      doc,
      view,
      v(55.9, 41.8),
      [{ position: v(24, 10), direction: v(Math.SQRT1_2, Math.SQRT1_2) }, { position: v(56, 12) }],
      1,
      opts,
    )!;
    expect(diag.position.x).toBeCloseTo(56, 8);
    expect(diag.position.y).toBeCloseTo(42, 8);
    expect(diag.tracks).toHaveLength(2);
  });
  it('lands at an ordinary position on a circle and finds an exact first common tangent point', () => {
    const doc = circle(circle(base(), v(0, 0), 20), v(70, 0), 10);
    const near = nearestDraftingCandidate(doc, view, v(18, 10), 1, opts, () => true)!;
    expect(near.kind).toBe('NEAREST');
    expect(distance(near.position, v(0, 0))).toBeCloseTo(20, 8);
    const normal = v(1 / 7, Math.sqrt(48) / 7);
    const a = v(normal.x * 20, normal.y * 20),
      b = v(70 + normal.x * 10, normal.y * 10);
    const hits = commonTangentCandidates(doc, view, v(a.x + 0.2, a.y), 1, opts);
    expect(distance(hits[0].position, a)).toBeLessThan(1e-8);
    expect(hits[0].pairedTangent?.sourceId).toBe(doc.entities.at(-1)?.id);
    expect(distance(hits[0].pairedTangent!.contact, b)).toBeLessThan(1e-8);
    const end = snapCandidates(doc, view, b, 4, hits[0].position, {
      ...opts,
      lineRelations: true,
      objectTypes: ['tangent'],
    })[0];
    expect(end.guide?.kind).toBe('tangent');
    expect(distance(end.position, b)).toBeLessThan(1e-7);
  });
});
describe('参考修改命令的正式事务', () => {
  it('trims the two box-selected intervals with the same boundaries and continues the command', () => {
    let d = base();
    for (const y of [0, 10]) d = line(d, v(-30, y), v(30, y));
    for (const x of [-10, 10]) d = line(d, v(x, -30), v(x, 30));
    const ids = d.entities.filter((e) => e.kind === 'segment').map((e) => e.id);
    const trimmed = trimInBox(d, ids.slice(2), view, v(-4, -2), v(4, 12), 'student');
    const horizontal = trimmed.entities
      .filter((e) => e.kind === 'segment')
      .map((e) => selected(trimmed, e.id))
      .filter(([a, b]) => a.y === b.y);
    expect(horizontal).toHaveLength(4);
    expect(
      horizontal.every(([a, b]) => (a.x <= -10 && b.x <= -10) || (a.x >= 10 && b.x >= 10)),
    ).toBe(true);
    let op = startCadSession('trim', d, view, 'student', ids.slice(2));
    op = cadStep(op, d, { type: 'point', position: v(0, 0), entityId: ids[0] }).session!;
    const step = cadStep(op, d, { type: 'confirm' });
    expect(step.session?.ids).toEqual(ids.slice(2));
    expect(step.session?.baseDocument).toBe(step.document);
    expect(step.session?.points).toHaveLength(0);
  });
  it('connects parallel ends with a true semicircle and joins distant lines with a 0-mm sharp corner', () => {
    const d = line(line(base(), v(-30, 0), v(30, 0)), v(-30, 40), v(30, 40));
    const ids = d.entities.filter((e) => e.kind === 'segment').map((e) => e.id);
    const joined = cornerAt(d, ids[0], ids[1], v(12, 0), v(12, 40), { kind: 'fillet' }, 'student');
    const arc = joined.entities.find((e) => e.kind === 'arc')!;
    expect(arc).toMatchObject({ radius: 20, sweep: 180 });
    expect(point(joined, arc.center)).toEqual(v(30, 20));
    const gap = line(line(base(), v(10, 0), v(35, 0)), v(0, 10), v(0, 35));
    const [a, b] = gap.entities.filter((e) => e.kind === 'segment');
    const closed = cornerAt(
      gap,
      a.id,
      b.id,
      v(15, 0),
      v(0, 15),
      { kind: 'chamfer', distanceA: 0, distanceB: 0 },
      'student',
    );
    const edges = closed.entities.filter((e) => e.kind === 'segment');
    expect(edges[0].startPoint).toBe(edges[1].startPoint);
    expect(point(closed, edges[0].startPoint)).toEqual(v(0, 0));
  });
  it('stores and reloads the actual half circle hatch face and mirrors its trimmed circle parameters', () => {
    const d = line(circle(base(), v(0, 0), 24), v(-36, 0), v(36, 0));
    const op = startCadSession('hatch', d, view, 'student');
    const ready = cadStep(op, d, { type: 'point', position: v(0, 10) }).session!;
    expect(ready.phase).toBe('confirm');
    const filled = cadStep(ready, d, { type: 'confirm' }).document!;
    const reload = loadGeometryDocument(serializeGeometryDocument(filled));
    const hatch = reload.entities.find((e) => e.kind === 'hatch')!;
    const strokes = hatchStrokes(reload, hatch);
    expect(strokes.length).toBeGreaterThan(5);
    expect(strokes.flat().every((p) => p.y >= -1e-7)).toBe(true);
    expect(hatch.spans?.[0]).toHaveLength(2);
    const flipped = transformSelection(
      reload,
      [hatch.id],
      { kind: 'mirror', a: v(-10, 0), b: v(10, 0), keepSource: false },
      'student',
    );
    const reflected = flipped.entities.find((e) => e.kind === 'hatch')!;
    expect(
      hatchStrokes(flipped, reflected)
        .flat()
        .every((p) => p.y <= 1e-7),
    ).toBe(true);
  });
  it('reads back a graphically identical document from the file menu package', async () => {
    const doc = line(base(), v(1, 2), v(90, 27));
    const zip = await exportCadPackage(doc);
    expect(loadGeometryDocument(await readCadPackage(await zip.arrayBuffer()))).toEqual(doc);
  });
});

describe('尺寸、公差与样条的保存表达', () => {
  it('keeps the dimension tolerance display independent of the measured geometry', () => {
    const d = base();
    let op = startCadSession('linearDimension', d, view, 'student');
    op = cadStep(op, d, {
      type: 'parameters',
      values: { toleranceCode: 'H7', toleranceUpper: '+0.12', toleranceLower: '−0.08' },
    }).session!;
    for (const p of [v(4, 4), v(24, 18)])
      op = cadStep(op, d, { type: 'point', position: p }).session!;
    const result = cadStep(op, d, { type: 'point', position: v(31, 11) }).document!;
    const dim = result.entities.find((e) => e.kind === 'dimension')!;
    expect(dimensionValue(result, dim)).toBe(14);
    expect(cadDrawing(result, dim).labels.map((x) => x.text)).toEqual([
      '14.00 mm',
      'H7',
      '+0.12',
      '−0.08',
    ]);
    const hidden = applyProperties(
      result,
      dim.id,
      { ...propertyValues(result, dim), textOverride: '100', showToleranceDeviation: 'false' },
      'student',
    );
    const edited = hidden.entities.find((e) => e.kind === 'dimension')!;
    expect(dimensionValue(hidden, edited)).toBe(14);
    expect(cadDrawing(hidden, edited).labels.map((x) => x.text)).toEqual(['100', 'H7']);
  });
  it('persists a direction letter and lets its grip move independently of the arrow', () => {
    const d = base();
    let op = startCadSession('direction', d, view, 'student');
    op = cadStep(op, d, { type: 'parameters', values: { label: 'B' } }).session!;
    op = cadStep(op, d, { type: 'point', position: v(2, 2) }).session!;
    const result = cadStep(op, d, { type: 'point', position: v(2, 12) }).document!;
    const arrow = result.entities.find((e) => e.kind === 'symbol')!;
    expect(arrow).toMatchObject({ arrowLength: 10, angle: 90, label: 'B' });
    const preview = previewCadGrip(
      result,
      { entityId: arrow.id, key: 'label', position: v(1, 1), label: '字母' },
      v(-4, 4),
      'student',
    );
    const moved = preview.entities.find((e) => e.kind === 'symbol')!;
    expect(cadDrawing(preview, moved).labels).toContainEqual({
      at: v(-4, 4),
      text: 'B',
      size: 3.5,
      angle: 0,
    });
    expect(moved.position).toEqual(v(2, 2));
  });
  it('uses a quadratic fitting curve for three spline points and a segment for two', () => {
    const d = base();
    let op = startCadSession('spline', d, view, 'student');
    for (const p of [v(0, 0), v(5, 5)])
      op = cadStep(op, d, { type: 'point', position: p }).session!;
    expect(cadStep(op, d, { type: 'confirm' }).document?.entities.at(-1)?.kind).toBe('segment');
    op = cadStep(op, d, { type: 'point', position: v(10, 0) }).session!;
    const result = cadStep(op, d, { type: 'confirm' }).document!;
    const curve = result.entities.find((e) => e.kind === 'curve')!;
    expect(curve.interpolation).toBe('QUADRATIC_BSPLINE');
    const [span] = curveSegments(
      curve.pointIds.map((id) => point(result, id)),
      curve.interpolation,
    );
    expect(cubicAt(span, 0.5)).toEqual(v(5, 5));
  });
  it('persists an engineering leader and a second six-cell tolerance row', () => {
    const d = line(base(), v(-10, 0), v(26, 0));
    const id = d.entities.find((e) => e.kind === 'segment')!.id;
    let op = startCadSession('toleranceFrame', d, view, 'student');
    op = cadStep(op, d, { type: 'point', position: v(3, 0.2), entityId: id }).session!;
    const result = cadStep(op, d, { type: 'point', position: v(12, 9) }).document!;
    const mark = result.entities.find((e) => e.kind === 'engineeringAnnotation')!;
    expect(mark.leader).toEqual(v(3, 0));
    const edited = applyProperties(
      result,
      mark.id,
      {
        ...propertyValues(result, mark),
        toleranceRows: JSON.stringify([
          ['∥', '0.1', '', 'A', '', ''],
          ['⌖', '⌀0.2', '', 'A', 'B', 'C'],
        ]),
      },
      'student',
    );
    const persisted = loadGeometryDocument(serializeGeometryDocument(edited));
    const full = persisted.entities.find((e) => e.kind === 'engineeringAnnotation')!;
    expect(full.toleranceRows?.[1]).toEqual(['⌖', '⌀0.2', '', 'A', 'B', 'C']);
    expect(cadDrawing(persisted, full).labels.map((x) => x.text)).toContain('⌀0.2');
  });
});
