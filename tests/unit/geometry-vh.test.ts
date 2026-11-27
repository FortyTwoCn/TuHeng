import { describe, expect, it } from 'vitest';
import { GeometryDocument, GeometryEvidence, geometryDocumentJsonSchema } from '@tuheng/contracts';
import {
  addDrawing,
  addProjectionAxis,
  analyzeGeometryDocument,
  confirmSnap,
  createDocument,
  drawingViewAt,
  exportGeometryBundle,
  exportSheetSvg,
  linkProjection,
  loadGeometryDocument,
  localToSheet,
  projectPoint,
  referenceGeometry,
  referenceKey,
  resolveReference,
  serializeGeometryDocument,
  snapCandidates,
  targetCapabilities,
} from '@tuheng/geometry-core';

describe('两面投影', () => {
  it('只创建 V/H 与水平 X-O 轴，沿用三面投影的坐标方向', () => {
    const doc = createDocument('VH_PROJECTION');
    expect(GeometryDocument.parse(doc).schemaVersion).toBe('tuheng.geometry/3.0.0');
    expect(doc.views).toEqual(createDocument('VHW_PROJECTION').views.slice(0, 2));
    expect(referenceGeometry(doc).map((r) => referenceKey(r.ref))).toEqual([
      'origin:view-0',
      'axis:X',
    ]);
    const axis = resolveReference(doc, { kind: 'baseAxis', axisId: 'X' });
    expect(axis).toMatchObject({ extent: 'line', direction: { x: -1, y: 0 } });
    for (const axisId of ['Z', 'Y_H', 'Y_W', 'MITER_45'] as const) {
      const ref = { kind: 'baseAxis', axisId } as const;
      expect(() => resolveReference(doc, ref)).toThrow('基准轴不存在');
      expect(targetCapabilities(doc, ref, 'student').snappable).toBe(false);
    }
    for (const x of [-40, 40]) {
      expect(drawingViewAt(doc, { x, y: 16 })).toBe('view-0');
      expect(drawingViewAt(doc, { x, y: -16 })).toBe('view-1');
      expect(drawingViewAt(doc, { x, y: 0 }, 'view-1')).toBe('view-1');
    }
    const spatial = { x: 12, y: 8, z: 5 };
    expect(localToSheet(doc, 'view-0', projectPoint(doc, spatial, 'view-0'))).toEqual({
      x: -12,
      y: 5,
    });
    expect(localToSheet(doc, 'view-1', projectPoint(doc, spatial, 'view-1'))).toEqual({
      x: -12,
      y: -8,
    });
  });

  it('追踪并核算 V-H 长对正偏差，导出评分证据和可重载图纸', () => {
    const stem = createDocument('VH_PROJECTION');
    const base = addDrawing(stem, 'point', 'view-0', [{ x: 15, y: 12 }], 'student');
    const source = base.entities[0].id;
    const candidate = snapCandidates(base, 'view-1', { x: 15.3, y: -24 }, 4, undefined, {
      projection: true,
    }).find((c) => c.kind === 'PROJECTION_ALIGNMENT')!;
    expect(candidate).toMatchObject({
      entityIds: [source],
      position: { x: 15, y: -24 },
      tracks: [{ point: { x: 15, y: 12 }, direction: { x: 0, y: 1 } }],
    });
    const drawing = addDrawing(base, 'point', 'view-1', [candidate.position], 'student');
    const target = drawing.entities[1].id;
    const confirmed = confirmSnap(base, drawing, candidate, target, 'student');
    const doc = linkProjection(confirmed, [source, target]);
    const bundle = exportGeometryBundle(doc);
    expect(bundle.derivedRelations).toEqual([
      expect.objectContaining({
        kind: 'PROJECTION_ALIGNMENT',
        deviation: 0,
        description: expect.stringContaining('V-H 长对正'),
      }),
    ]);
    expect(bundle.narrative).toContain('+X 向左');
    expect(
      GeometryEvidence.parse({
        schemaVersion: doc.schemaVersion,
        editorType: doc.editorType,
        problemDocument: stem,
        answerDocument: bundle.document,
        derivedRelations: bundle.derivedRelations,
        narrative: bundle.narrative,
      }).editorType,
    ).toBe('VH_PROJECTION');
    const edited = structuredClone(confirmed);
    const point = edited.entities[1];
    if (point.kind !== 'point') throw Error('Expected H point');
    point.position.x += 2;
    expect(analyzeGeometryDocument(edited)[0].deviation).toBe(2);
    expect(loadGeometryDocument(serializeGeometryDocument(doc))).toEqual(doc);
    expect(JSON.stringify(geometryDocumentJsonSchema())).toContain('"VH_PROJECTION"');
    const svg = exportSheetSvg(doc);
    expect(svg).toContain('data-reference-id="axis:X"');
    expect(svg).toContain('>O</text>');
    expect(svg).not.toMatch(/axis:(Z|Y_H|Y_W|MITER_45)/);
  });

  it('允许基于 V/H 换面，限制不存在的参考轴和旧版类型', () => {
    const doc = createDocument('VH_PROJECTION');
    const result = addProjectionAxis(
      doc,
      {
        name: 'X1',
        viewName: 'H1',
        retainedViewId: 'view-0',
        replacedViewId: 'view-1',
        parentId: null,
        method: 'PARALLEL',
        referenceEntityId: null,
        referenceAxis: { kind: 'baseAxis', axisId: 'X' },
        anchor: { x: -5, y: 15 },
        through: { x: -8, y: 15 },
        side: 1,
      },
      'student',
    );
    expect(result.views.map((v) => v.name)).toEqual(['V', 'H', 'H1']);
    expect(drawingViewAt(result, { x: -25, y: 10 })).toBe(result.views[2].id);
    expect(
      GeometryDocument.safeParse({ ...doc, schemaVersion: 'tuheng.geometry/2.2.0' }).success,
    ).toBe(false);
    result.auxiliarySystems![0].referenceAxis = { kind: 'baseAxis', axisId: 'Z' };
    expect(GeometryDocument.safeParse(result).success).toBe(false);
  });
});
