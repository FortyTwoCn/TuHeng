import { describe, it, expect } from 'vitest';
import {
  GeometryDocument,
  GeometryEvidence,
  GEOMETRY_EVIDENCE_NARRATIVE_LIMIT,
  type GeometryEntity,
  type CadEntity,
} from '@tuheng/contracts';
import {
  createDocument,
  dimensionValue,
  exportGeometryBundle,
  exportGeometryNarrative,
  exportSheetSvg,
  cadDrawing,
  entityInMarquee,
  hitDistance,
  propertyValues,
  applyProperties,
  visibleCurveSegments,
  cubicAt,
  curveSegments,
  combineAnswer,
  loadGeometryDocument,
  serializeGeometryDocument,
  hatchStrokes,
  transact,
  ellipseAt,
  sheetBounds,
} from '@tuheng/geometry-core';

const common = { viewId: 'view-0', layerId: 'answer', lineStyle: 'ANSWER_VISIBLE' } as const;
const ellipse: Extract<CadEntity, { kind: 'ellipse' }> = {
  ...common,
  kind: 'ellipse',
  id: 'oval',
  center: 'p0',
  majorRadius: 12,
  minorRadius: 8,
  angle: 30,
  startAngle: 0,
  sweep: 360,
};
const label: Extract<CadEntity, { kind: 'text' }> = {
  ...common,
  kind: 'text',
  id: 'label',
  position: { x: 10, y: 20 },
  angle: 0,
  size: 4,
  content: '轴孔 <A>',
};
const dim: Extract<CadEntity, { kind: 'dimension' }> = {
  ...common,
  kind: 'dimension',
  id: 'dim',
  dimensionType: 'ALIGNED',
  referenceIds: ['p0', 'p1'],
  position: { x: 0, y: 9 },
  textSize: 2.5,
  textOverride: '100',
  precision: 2,
  arrowStyle: 'OPEN',
};
const hatch: Extract<CadEntity, { kind: 'hatch' }> = {
  ...common,
  kind: 'hatch',
  id: 'fill',
  loops: [['oval'], ['hole']],
  origin: { x: 0, y: 0 },
  angle: 0,
  spacing: 2,
};
function fixture() {
  const doc = createDocument('ISOMETRIC');
  const points: GeometryEntity[] = [
    { x: 0, y: 0 },
    { x: 3, y: 4 },
    { x: -4, y: 3 },
  ].map((p, i) => ({
    ...common,
    id: 'p' + i,
    kind: 'point',
    position: p,
    name: '',
    labelVisible: false,
    spatial: null,
  }));
  doc.entities = [
    ...points,
    ellipse,
    label,
    dim,
    { ...common, kind: 'circle', center: 'p0', radius: 3, id: 'hole' },
    hatch,
    {
      ...common,
      id: 'arrow',
      kind: 'symbol',
      position: { x: 9, y: 0 },
      angle: 45,
      size: 4,
      symbolType: 'LEFT_ROTATION',
    },
    {
      ...common,
      id: 'datum',
      kind: 'engineeringAnnotation',
      position: { x: 15, y: 5 },
      angle: 30,
      size: 2,
      annotationType: 'GEOMETRIC_TOLERANCE',
      fields: ['∥', '0.02', 'A'],
    },
  ];
  return GeometryDocument.parse(doc);
}
describe('CAD drawing primitives in formal geometry evidence', () => {
  it('keeps a legal near-limit text drawing gradable and manual narrative complete', () => {
    const problem = createDocument('ISOMETRIC');
    const answer = GeometryDocument.parse({
      ...problem,
      entities: Array.from({ length: 2000 }, (_, i) => ({
        ...label,
        id: 'tag.' + String(i).padStart(96, '0'),
        content: 'a'.repeat(400),
      })),
    });
    const full = exportGeometryNarrative(answer);
    expect(full.length).toBeGreaterThan(GEOMETRY_EVIDENCE_NARRATIVE_LIMIT);
    expect(full).toContain(answer.entities.at(-1)!.id);
    const bundle = exportGeometryBundle(answer);
    expect(bundle.narrative).toContain('评分用文字叙述已节选');
    expect(bundle.document.entities).toEqual(answer.entities);
    expect(
      GeometryEvidence.safeParse({
        editorType: answer.editorType,
        schemaVersion: answer.schemaVersion,
        problemDocument: problem,
        answerDocument: bundle.document,
        derivedRelations: bundle.derivedRelations,
        narrative: bundle.narrative,
      }).success,
    ).toBe(true);
  });
  it('distinguishes relation participants whose IDs contain dots', () => {
    const doc = createDocument('ISOMETRIC');
    doc.entities = ['a.b', 'c', 'a', 'b.c'].map((id, y) => ({
      ...common,
      kind: 'line',
      id,
      anchor: { x: 0, y },
      direction: { x: 1, y: 0 },
      layerId: 'construction',
      lineStyle: 'CONSTRUCTION',
      referenceEntityId: null,
    }));
    const relations = exportGeometryBundle(doc).derivedRelations;
    expect(new Set(relations.map((r) => r.id)).size).toBe(relations.length);
  });
  it('round-trips every kind, renders geometry and safely quotes annotation text', () => {
    const doc = fixture(),
      bundle = exportGeometryBundle(doc);
    expect(loadGeometryDocument(serializeGeometryDocument(doc))).toEqual(doc);
    const svg = exportSheetSvg(doc);
    for (const e of doc.entities) expect(svg).toContain('data-entity-id="' + e.id + '"');
    expect(svg).toContain('轴孔 &lt;A&gt;');
    expect(bundle.narrative).toContain('实际测量值 5 mm');
    expect(bundle.narrative).toContain('用户覆盖文字 "100"');
    expect(bundle.narrative).toContain('公差符合性未知');
    expect(sheetBounds(doc).width).toBeGreaterThan(24);
  });
  it.each([
    ['ALIGNED', 5],
    ['LINEAR', 3],
    ['ANGULAR', 90],
    ['RADIUS', 3],
    ['DIAMETER', 6],
  ] as const)('measures %s from references', (type, expected) => {
    const doc = fixture(),
      refs =
        type === 'ANGULAR'
          ? ['p0', 'p1', 'p2']
          : type === 'RADIUS' || type === 'DIAMETER'
            ? ['hole']
            : ['p0', 'p1'];
    const d = { ...dim, dimensionType: type, referenceIds: refs };
    expect(dimensionValue(doc, d)).toBeCloseTo(expected, 10);
    expect(cadDrawing(doc, d).labels[0].text).toBe('100');
    const updated = transact(doc, (draft) => {
      const p = draft.entities.find((e) => e.id === 'p1');
      if (p?.kind === 'point') p.position = { x: 6, y: 8 };
    });
    expect(dimensionValue(updated, dim)).toBe(10);
  });
  it('rejects broken references, degenerate angle rays, open hatch borders and excessive scan rows', () => {
    const doc = fixture();
    for (const patch of [
      { ...dim, referenceIds: ['p0', 'missing'] },
      { ...dim, dimensionType: 'ANGULAR', referenceIds: ['p0', 'p0', 'p1'] },
      { ...hatch, loops: [['p0', 'p1', 'p2']] },
      { ...ellipse, minorRadius: 20 },
    ]) {
      expect(
        GeometryDocument.safeParse({
          ...doc,
          entities: doc.entities.map((e) => (e.id === patch.id ? patch : e)),
        }).success,
      ).toBe(false);
    }
    const bad = {
      ...doc,
      entities: doc.entities.map((e) =>
        e.id === 'oval'
          ? { ...ellipse, majorRadius: 9999, minorRadius: 9980 }
          : e.id === 'fill'
            ? { ...hatch, spacing: 0.1 }
            : e,
      ),
    };
    expect(GeometryDocument.safeParse(bad).success).toBe(false);
    const preview = cadDrawing(doc, { ...hatch, spacing: 0.0001 });
    expect(preview.strokes).toHaveLength(0);
    expect(preview.labels[0].text).toContain('剖面间距');
  });
  it('keeps holes open and selects the actual strokes of the hatch and rotated ellipse', () => {
    const doc = fixture(),
      center = { x: 0, y: 0 },
      box = { x: -100, y: -100, width: 200, height: 200 };
    expect(hatchStrokes(doc, hatch).filter((path) => Math.abs(path[0].y) < 1e-8)).toHaveLength(2);
    expect(hitDistance(doc, hatch, center, box)).toBeGreaterThan(2.9);
    expect(hitDistance(doc, ellipse, ellipseAt(center, ellipse, 77), box)).toBeLessThan(1e-9);
    expect(
      entityInMarquee(doc, ellipse, { x: -1, y: -1, width: 2, height: 2 }, 'crossing', 'local'),
    ).toBe(false);
    expect(hitDistance(doc, label, { x: 11, y: 21 }, box)).toBe(0);
  });
  it('trims Hermite parameter intervals without replacing cubic geometry with polylines', () => {
    const knots = [
        { x: 0, y: 1 },
        { x: 8, y: 11 },
        { x: 16, y: 0 },
      ],
      all = curveSegments(knots);
    const kept = visibleCurveSegments(knots, [0.25, 0.75]);
    expect(kept).toHaveLength(2);
    expect(kept[0].start).toEqual(cubicAt(all[0], 0.5));
    expect(kept[1].end).toEqual(cubicAt(all[1], 0.5));
    expect(cubicAt(kept[1], 0.5).x).toBeCloseTo(cubicAt(all[1], 0.25).x, 10);
  });
  it('preserves empty upper or lower deviation slots and renders each at the correct height', () => {
    const doc = fixture(),
      base = {
        ...common,
        id: 'tol',
        kind: 'engineeringAnnotation',
        annotationType: 'TOLERANCE_TEXT',
        position: { x: 0, y: 0 },
        size: 4,
        angle: 0,
      } as const;
    for (const [fields, sign] of [
      [['25', '+0.2', ''], 1],
      [['25', '', '−0.4'], -1],
    ] as const) {
      const e = { ...base, fields: [...fields] };
      expect(
        GeometryDocument.parse({ ...doc, entities: [...doc.entities, e] }).entities.at(-1),
      ).toEqual(e);
      const drawing = cadDrawing(doc, e);
      expect(drawing.labels).toHaveLength(2);
      expect(Math.sign(drawing.labels[1].at.y)).toBe(sign);
    }
    expect(
      GeometryDocument.safeParse({
        ...doc,
        entities: [...doc.entities, { ...base, fields: ['25', '', ''] }],
      }).success,
    ).toBe(false);
    const rough = { ...base, annotationType: 'ROUGHNESS' as const, fields: ['Ra 3.2'] };
    const prohibited = cadDrawing(doc, { ...rough, roughnessMode: 'REMOVAL_PROHIBITED' });
    const required = cadDrawing(doc, { ...rough, roughnessMode: 'REMOVAL_REQUIRED' });
    expect(prohibited.strokes[1]).toHaveLength(33);
    expect(required.strokes[1]).toHaveLength(2);
    expect(
      GeometryDocument.safeParse({
        ...doc,
        entities: [...doc.entities, { ...rough, fields: [''] }],
      }).success,
    ).toBe(false);
  });
  it('selects a rotated ellipse at an exact tangency and filters points outside its saved arc', () => {
    const doc = fixture();
    const c = { x: 0, y: 0 },
      alpha = (ellipse.angle * Math.PI) / 180;
    const maximum =
      (Math.atan2(-ellipse.minorRadius * Math.sin(alpha), ellipse.majorRadius * Math.cos(alpha)) *
        180) /
      Math.PI;
    const p = ellipseAt(c, ellipse, maximum);
    const box = { x: p.x, y: p.y - 0.01, width: 1, height: 0.02 };
    expect(entityInMarquee(doc, ellipse, box, 'crossing', 'local')).toBe(true);
    expect(
      entityInMarquee(doc, { ...ellipse, startAngle: 45, sweep: 90 }, box, 'crossing', 'local'),
    ).toBe(false);
  });
  it('only promotes a new editable transaction from a 2.x snapshot', () => {
    const old = createDocument('VHW_PROJECTION');
    old.schemaVersion = 'tuheng.geometry/2.0.0';
    const frozen = serializeGeometryDocument(old);
    const next = transact(loadGeometryDocument(frozen), (d) => d.entities.push({ ...label }));
    expect(next.schemaVersion).toBe('tuheng.geometry/3.0.0');
    expect(serializeGeometryDocument(old)).toBe(frozen);
    expect(loadGeometryDocument(frozen).schemaVersion).toBe('tuheng.geometry/2.0.0');
  });
  it('validates property drafts and protects frozen annotation text and styles on submission', () => {
    const doc = fixture(),
      values = propertyValues(doc, ellipse);
    expect(applyProperties(doc, ellipse.id, values, 'student')).toBe(doc);
    expect(() =>
      applyProperties(doc, ellipse.id, { ...values, minorRadius: '-' }, 'student'),
    ).toThrow();
    expect(
      applyProperties(doc, ellipse.id, { ...values, angle: '15' }, 'student').entities.find(
        (e) => e.id === ellipse.id,
      ),
    ).toMatchObject({ angle: 15 });
    const stem = createDocument('ISOMETRIC');
    stem.entities = [{ ...label, lineStyle: 'PROBLEM_VISIBLE', layerId: 'stem' }];
    expect(() =>
      combineAnswer(stem, { ...stem, entities: [{ ...stem.entities[0], content: '更改' }] }),
    ).toThrow(/STEM/);
  });
});
