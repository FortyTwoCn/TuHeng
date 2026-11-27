import { describe, expect, it } from 'vitest';
import {
  EditorType,
  type GeometryDocument,
  type GeometryEntity,
  type Vec2,
} from '@tuheng/contracts';
import {
  addDrawing,
  combineAnswer,
  createDocument,
  decodeDxfBytes,
  distance,
  DXF_MAX_BYTES,
  ellipseAt,
  exportDocumentToDxf,
  importDxfToDocument,
  localToSheet,
  point,
  visibleCurveSegments,
} from '@tuheng/geometry-core';
import { dxfFixture, dxfLine, dxfRoundTripFixture } from '../dxf-fixtures';

function entitiesOf<K extends GeometryEntity['kind']>(doc: GeometryDocument, kind: K) {
  return doc.entities.filter((e): e is Extract<GeometryEntity, { kind: K }> => e.kind === kind);
}
function close(actual: Vec2, expected: Vec2) {
  expect(distance(actual, expected)).toBeLessThan(0.001);
}
function arcEnds(doc: GeometryDocument, arc: Extract<GeometryEntity, { kind: 'arc' }>) {
  const center = point(doc, arc.center);
  return [arc.startAngle, arc.startAngle + arc.sweep].map((angle) => ({
    x: center.x + arc.radius * Math.cos((angle * Math.PI) / 180),
    y: center.y + arc.radius * Math.sin((angle * Math.PI) / 180),
  }));
}

describe('DXF 往返', () => {
  it('保留毫米坐标、点连接、圆心半径、正负扫角、椭圆轴、样条和中文文字', () => {
    const source = dxfRoundTripFixture();
    const dxf = exportDocumentToDxf(source);
    expect(dxf).toMatch(/\$ACADVER\r\n1\r\nAC1021/);
    expect(dxf).toMatch(/\$INSUNITS\r\n70\r\n4/);
    for (const name of [
      'HEADER',
      'TABLES',
      'LTYPE',
      'LAYER',
      'ENTITIES',
      'EOF',
      'CONTINUOUS',
      'DASHED',
      'CENTER',
      'PHANTOM',
      'TH_AXIS',
    ]) {
      expect(dxf).toContain(`\r\n${name}\r\n`);
    }
    const result = importDxfToDocument(dxf, { editorType: source.editorType });
    const doc = result.document;
    expect(result.skippedAxisCount).toBe(3);
    expect(result.ignoredCount).toBe(0);
    const [first, second] = entitiesOf(doc, 'segment');
    expect(first.endPoint).toBe(second.startPoint);
    expect(first.appearance).toEqual({ color: '#336da7', widthMm: 0.369, pattern: 'PHANTOM' });
    close(point(doc, first.startPoint), point(source, 'p0'));
    close(point(doc, first.endPoint), point(source, 'p1'));
    expect(entitiesOf(doc, 'point').find((e) => e.id === first.startPoint)).toMatchObject({
      name: '定位点',
      labelVisible: true,
    });
    const circle = entitiesOf(doc, 'circle')[0];
    close(point(doc, circle.center), point(source, 'p0'));
    expect(circle.radius).toBeCloseTo(4.123456, 8);

    const arcs = entitiesOf(source, 'arc');
    for (const [i, arc] of entitiesOf(doc, 'arc').slice(0, 2).entries()) {
      const expected = arcs[i];
      expect(arc.sweep).toBeCloseTo(expected.sweep, 8);
      expect(arc.radius).toBeCloseTo(expected.radius, 8);
      const endpoints = arcEnds(source, expected);
      arcEnds(doc, arc).forEach((actual, j) => close(actual, endpoints[j]));
    }
    const original = entitiesOf(source, 'ellipse')[0],
      ellipse = entitiesOf(doc, 'ellipse')[0];
    expect(ellipse.majorRadius).toBeCloseTo(original.majorRadius, 8);
    expect(ellipse.minorRadius).toBeCloseTo(original.minorRadius, 8);
    expect(ellipse.angle).toBeCloseTo(original.angle, 8);
    expect(ellipse.sweep).toBeCloseTo(original.sweep, 8);
    for (const t of [0, 0.5, 1])
      close(
        ellipseAt(point(doc, ellipse.center), ellipse, ellipse.startAngle + ellipse.sweep * t),
        ellipseAt(
          point(source, original.center),
          original,
          original.startAngle + original.sweep * t,
        ),
      );
    const givenCurves = entitiesOf(source, 'curve');
    for (const [i, curve] of entitiesOf(doc, 'curve').entries()) {
      const given = givenCurves[i];
      expect(curve.interpolation).toBe(given.interpolation);
      expect(curve.parameterRange).toEqual(given.parameterRange);
      const originalPath = visibleCurveSegments(
        given.pointIds.map((id) => point(source, id)),
        given.parameterRange,
        given.interpolation,
      );
      const path = visibleCurveSegments(
        curve.pointIds.map((id) => point(doc, id)),
        curve.parameterRange,
        curve.interpolation,
      );
      expect(path).toEqual(originalPath);
    }
    expect(entitiesOf(doc, 'curve')).toHaveLength(2);
    expect(entitiesOf(doc, 'polyline')[0].points).toEqual(entitiesOf(source, 'polyline')[0].points);
    const labels = entitiesOf(doc, 'text');
    for (const text of entitiesOf(source, 'text')) {
      const loaded = labels.find((e) => e.content === text.content)!;
      expect(loaded.viewId).toBe(text.viewId);
      close(loaded.position, text.position);
      expect(loaded.size).toBeCloseTo(text.size, 8);
      expect(loaded.angle).toBeCloseTo(text.angle, 8);
    }
    expect(labels.map((e) => e.content)).toEqual(
      expect.arrayContaining(['定位长度', '向视 A', '基准 B']),
    );
    expect(entitiesOf(doc, 'segment').at(-1)?.appearance?.pattern).toBe('DASHED');
    expect(entitiesOf(doc, 'arc').at(-1)?.sweep).toBeCloseTo(-360, 8);
    expect(result.warnings).toContainEqual({ type: 'HATCH', count: 1, message: '已提取剖面边界' });
    expect(
      importDxfToDocument(exportDocumentToDxf(source, { includeAxes: false })).skippedAxisCount,
    ).toBe(0);
  });
});

describe('第三方文本 DXF', () => {
  it('识别闭合 LWPOLYLINE 和 R12 POLYLINE 的首尾凸度', () => {
    const q = Math.tan(Math.PI / 8);
    const result = importDxfToDocument(
      dxfFixture([
        [0, 'lwpolyline'],
        [90, 3],
        [70, 1],
        [10, 0],
        [20, 20],
        [42, 1],
        [10, 10],
        [20, 20],
        [10, 0],
        [20, 30],
        [42, -q],
        [0, 'polyline'],
        [70, 1],
        [0, 'vertex'],
        [10, 0],
        [20, -10],
        [42, -q],
        [0, 'vertex'],
        [10, 10],
        [20, -10],
        [0, 'vertex'],
        [10, 0],
        [20, -25],
        [0, 'seqend'],
      ]),
      { editorType: 'ISOMETRIC' },
    );
    expect(result.importedCount).toBe(2);
    const arcs = entitiesOf(result.document, 'arc');
    expect(arcs.map((e) => Math.round(e.sweep))).toEqual([180, -90, -90]);
    for (const [i, ends] of [
      [
        { x: 0, y: 20 },
        { x: 10, y: 20 },
      ],
      [
        { x: 0, y: 30 },
        { x: 0, y: 20 },
      ],
      [
        { x: 0, y: -10 },
        { x: 10, y: -10 },
      ],
    ].entries()) {
      arcEnds(result.document, arcs[i]).forEach((p, j) => close(p, ends[j]));
    }
    expect(entitiesOf(result.document, 'segment')).toHaveLength(3);
  });

  it('读取图层样式、颜色、MTEXT 格式、基础标注与剖面边界', () => {
    const result = importDxfToDocument(
      dxfFixture(
        [
          ...dxfLine({ x: 1, y: 2 }, { x: 4, y: 2 }, 'center'),
          ...dxfLine({ x: 4, y: 2 }, { x: 7, y: 2 }, 'hidden'),
          ...dxfLine({ x: 7, y: 2 }, { x: 9, y: 2 }, 'phantom'),
          ...dxfLine({ x: 0, y: 0 }, { x: 9, y: 0 }, 'th_axis'),
          [0, 'MTEXT'],
          [10, 4],
          [20, 8],
          [40, 2.7],
          [11, 0],
          [21, 1],
          [3, String.raw`{\fSimSun|b0;剖面}\P`],
          [1, String.raw`{\C1;间距}\~\U+00B1\S1^2;`],
          [0, 'DIMENSION'],
          [70, 32],
          [10, 17],
          [20, 4],
          [11, 11],
          [21, 6],
          [13, 3],
          [23, 1],
          [14, 17],
          [24, 1],
          [42, 14],
          [1, '长度 <>'],
          [0, 'HATCH'],
          [91, 1],
          [92, 2],
          [72, 0],
          [73, 1],
          [93, 3],
          [10, 1],
          [20, 1],
          [10, 4],
          [20, 1],
          [10, 3],
          [20, 3],
          [97, 0],
          [75, 0],
        ],
        {
          tables: [
            [0, 'LAYER'],
            [2, 'CENTER'],
            [6, 'CENTER2'],
            [62, 1],
            [370, 35],
            [0, 'LAYER'],
            [2, 'HIDDEN'],
            [6, 'HIDDEN'],
            [420, 0x1a2b3c],
            [0, 'LAYER'],
            [2, 'PHANTOM'],
            [6, 'PHANTOM'],
            [62, 5],
          ],
        },
      ),
      { editorType: 'ISOMETRIC' },
    );
    const [center, hidden, phantom] = entitiesOf(result.document, 'segment');
    expect(center.endPoint).toBe(hidden.startPoint);
    expect(center.appearance).toMatchObject({ pattern: 'CENTER', color: '#ff0000', widthMm: 0.35 });
    expect(hidden.lineStyle).toBe('ANSWER_HIDDEN');
    expect(hidden.appearance).toMatchObject({ pattern: 'DASHED', color: '#1a2b3c' });
    expect(phantom.appearance).toMatchObject({ pattern: 'PHANTOM', color: '#0000ff' });
    const [label, dimension] = entitiesOf(result.document, 'text');
    expect(label).toMatchObject({ content: '剖面\n间距 ±1/2', angle: 90, size: 2.7 });
    expect(dimension.content).toBe('长度 14');
    expect(entitiesOf(result.document, 'polyline')[0].points).toEqual([
      { x: 1, y: 1 },
      { x: 4, y: 1 },
      { x: 3, y: 3 },
      { x: 1, y: 1 },
    ]);
    expect(result.skippedAxisCount).toBe(1);
  });

  it('采样标准有理样条并导入两个拟合点的退化样条', () => {
    const result = importDxfToDocument(
      dxfFixture([
        [0, 'SPLINE'],
        [70, 12],
        [71, 2],
        [72, 6],
        [73, 3],
        [74, 0],
        [40, 0],
        [40, 0],
        [40, 0],
        [40, 1],
        [40, 1],
        [40, 1],
        [41, 1],
        [41, Math.SQRT1_2],
        [41, 1],
        [10, 10],
        [20, 0],
        [10, 10],
        [20, 10],
        [10, 0],
        [20, 10],
        [0, 'SPLINE'],
        [74, 2],
        [11, 1.1],
        [21, 2.2],
        [11, 3.3],
        [21, 4.4],
      ]),
      { editorType: 'ISOMETRIC' },
    );
    const curve = entitiesOf(result.document, 'curve')[0];
    const midpoint = point(result.document, curve.pointIds[Math.floor(curve.pointIds.length / 2)]);
    close(midpoint, { x: 10 * Math.SQRT1_2, y: 10 * Math.SQRT1_2 });
    expect(entitiesOf(result.document, 'segment')).toHaveLength(1);
  });

  it.each(EditorType.options)('保持毫米坐标并在 %s 中识别视图', (editorType) => {
    const doc = importDxfToDocument(
      dxfFixture(dxfLine({ x: -1, y: -2 }, { x: -3, y: -2 }), { units: 1 }),
      { editorType },
    ).document;
    const segment = entitiesOf(doc, 'segment')[0];
    expect(segment.viewId).toBe(
      ['ISOMETRIC', 'OBLIQUE_DIMETRIC'].includes(editorType) ? 'view-0' : 'view-1',
    );
    close(localToSheet(doc, segment.viewId, point(doc, segment.startPoint)), {
      x: -25.4,
      y: -50.8,
    });
  });

  it('居中时只平移，保留毫米尺寸并识别旧版中文代码页', () => {
    const file = dxfFixture(dxfLine({ x: 50000, y: 12 }, { x: 50020, y: 12 }));
    expect(() => importDxfToDocument(file)).toThrow('居中导入');
    const doc = importDxfToDocument(file, {
      editorType: 'ISOMETRIC',
      placement: 'center',
    }).document;
    const line = entitiesOf(doc, 'segment')[0];
    expect(point(doc, line.startPoint)).toEqual({ x: -10, y: 0 });
    expect(point(doc, line.endPoint)).toEqual({ x: 10, y: 0 });
    const body = dxfFixture([
      [0, 'TEXT'],
      [10, 5],
      [20, 5],
      [40, 2],
      [1, '@@'],
    ]);
    const legacy = body.replace('$INSUNITS', '$DWGCODEPAGE\n3\nANSI_936\n9\n$INSUNITS');
    const [start, end] = legacy.split('@@').map((part) => new TextEncoder().encode(part));
    const bytes = Uint8Array.from([...start, 0xc9, 0xe8, 0xbc, 0xc6, ...end]);
    expect(entitiesOf(importDxfToDocument(decodeDxfBytes(bytes)).document, 'text')[0].content).toBe(
      '设计',
    );
  });

  it('拒绝截断、非 DXF、无效数值以及超过上限的文件', () => {
    const line = dxfFixture(dxfLine({ x: 1, y: 2 }, { x: 3, y: 4 }));
    for (const bad of [
      'not dxf',
      'AutoCAD Binary DXF\r\n\x1a\0',
      line.replace('  0\neof\n', ''),
      line.replace('  21\n4\n', '  21\nInfinity\n'),
      dxfFixture([
        [0, 'POLYLINE'],
        [70, 1],
        [0, 'VERTEX'],
        [10, 1],
        [20, 2],
      ]),
      dxfFixture([
        [0, 'LWPOLYLINE'],
        [90, 5],
        [10, 1],
        [20, 2],
      ]),
    ])
      expect(() => importDxfToDocument(bad)).toThrow(/DXF/);
    expect(() => importDxfToDocument('x'.repeat(DXF_MAX_BYTES + 1))).toThrow('8 MB');
    expect(() =>
      importDxfToDocument(dxfFixture(Array.from({ length: 20001 }, () => [0, '3DSOLID']))),
    ).toThrow('20,000');
  });

  it('按类型汇总忽略项，忽略所有对象时保留原图', () => {
    const base = addDrawing(
      createDocument('VH_PROJECTION'),
      'point',
      'view-0',
      [{ x: 5, y: 5 }],
      'student',
    );
    const report = importDxfToDocument(
      dxfFixture([
        [0, '3DSOLID'],
        [0, '3DSOLID'],
        [0, 'INSERT'],
        [2, 'NESTED'],
      ]),
      { document: base, mode: 'replace' },
    );
    expect(report.document).toBe(base);
    expect(report.createdEntityCount).toBe(0);
    expect(report.ignoredCount).toBe(3);
    expect(report.warnings).toEqual([
      expect.objectContaining({ type: '3DSOLID', count: 2 }),
      expect.objectContaining({ type: 'INSERT', count: 1 }),
    ]);
  });

  it('展开二维等比块、继承 ByBlock 样式并报告嵌套块和非等比块', () => {
    const result = importDxfToDocument(
      dxfFixture(
        [
          [0, 'INSERT'],
          [2, 'SYMBOL_A'],
          [8, 'SCHOOL'],
          [10, 20],
          [20, 30],
          [41, 2],
          [42, 2],
          [50, 90],
          [62, 3],
          [6, 'CENTER'],
          [0, 'INSERT'],
          [2, 'SYMBOL_A'],
          [10, 0],
          [20, 0],
          [41, 2],
          [42, 1],
        ],
        {
          blocks: [
            [0, 'BLOCK'],
            [2, 'SYMBOL_A'],
            [10, 1],
            [20, 1],
            ...dxfLine({ x: 1, y: 1 }, { x: 4, y: 1 }),
            [62, 0],
            [6, 'BYBLOCK'],
            [0, 'CIRCLE'],
            [10, 3],
            [20, 2],
            [40, 2],
            [0, 'INSERT'],
            [2, 'SYMBOL_A'],
            [10, 1],
            [20, 1],
            [0, 'ENDBLK'],
          ],
        },
      ),
      { editorType: 'ISOMETRIC' },
    );
    const doc = result.document;
    const segment = entitiesOf(doc, 'segment')[0],
      circle = entitiesOf(doc, 'circle')[0];
    expect(result.importedCount).toBe(1);
    expect(result.ignoredCount).toBe(2);
    expect(result.warnings).toEqual([
      expect.objectContaining({ type: 'INSERT', message: expect.stringContaining('嵌套块') }),
      expect.objectContaining({ type: 'INSERT', message: expect.stringContaining('非等比块') }),
    ]);
    close(point(doc, segment.startPoint), { x: 20, y: 30 });
    close(point(doc, segment.endPoint), { x: 20, y: 36 });
    close(point(doc, circle.center), { x: 18, y: 34 });
    expect(circle.radius).toBeCloseTo(4, 8);
    expect(segment.appearance).toMatchObject({ pattern: 'CENTER', color: '#00ff00' });
  });
});

it('学生替换只清理作答对象，题干、视图和权限保持原样', () => {
  const stem = addDrawing(
    createDocument('VH_PROJECTION'),
    'segment',
    'view-0',
    [
      { x: 4, y: 6 },
      { x: 8, y: 9 },
    ],
    'teacher',
  );
  const answer = addDrawing(stem, 'point', 'view-1', [{ x: 2, y: -5 }], 'student');
  const original = structuredClone(answer);
  const dxf = dxfFixture([
    ...dxfLine({ x: -4, y: 6 }, { x: -15, y: 10 }, 'TH_PROBLEM_STEM'),
    [0, 'CIRCLE'],
    [8, 'TH_CONSTRUCTION'],
    [10, -12],
    [20, -15],
    [40, 5],
  ]);
  const imported = importDxfToDocument(dxf, { document: answer, role: 'student', mode: 'replace' });
  expect(answer).toEqual(original);
  expect(combineAnswer(stem, imported.document)).toEqual(imported.document);
  expect(imported.document.entities.slice(0, stem.entities.length)).toEqual(stem.entities);
  expect(imported.document.entities.slice(stem.entities.length).map((e) => e.layerId)).toEqual([
    'answer',
    'answer',
    'answer',
    'construction',
    'construction',
  ]);
  const merged = importDxfToDocument(dxf, { document: answer, role: 'student', mode: 'merge' });
  expect(merged.document.entities.slice(0, answer.entities.length)).toEqual(answer.entities);
  const authored = importDxfToDocument(dxf, { document: stem, role: 'teacher' });
  expect(authored.document.entities.every((e) => e.layerId === 'stem')).toBe(true);
});
