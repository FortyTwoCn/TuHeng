import { GeometryDocument, type Vec2 } from '@tuheng/contracts';
import { cadDrawing, mapCadDrawing } from './cad-geometry';
import { dxfAxisLayer, dxfPointTags, type DxfPair } from './dxf-format';
import { dxfHatchTags } from './dxf-hatch';
import { angleVector, dxfDegrees, ocsPoint, wrapAngle } from './dxf-shapes';
import { dxfSplineTags } from './dxf-spline';
import {
  dxfAnnotationSuffix,
  dxfEntityStyle,
  dxfLayerNames,
  dxfReferenceLayer,
} from './dxf-styles';
import { dxfTextTags } from './dxf-text';
import { DxfWriter } from './dxf-writer';
import { add, angle, clipLine, cross, distance, planeOutline, scale, sub } from './math';
import { clipReference, referenceGeometry } from './references';
import { localToSheet, sheetBounds, viewTransform } from './sheet';

const line = (a: Vec2, b: Vec2): DxfPair[] => [
  [100, 'AcDbLine'],
  ...dxfPointTags(10, a, 0),
  ...dxfPointTags(11, b, 0),
];
const extrusion = (sign: number): DxfPair[] => [
  [210, 0],
  [220, 0],
  [230, sign],
];

function polyline(points: Vec2[]): DxfPair[] {
  const closed = points.length > 2 && distance(points[0], points.at(-1)!) < 1e-8;
  const vertices = closed ? points.slice(0, -1) : points;
  return [
    [100, 'AcDbPolyline'],
    [90, vertices.length],
    [70, closed ? 1 : 0],
    ...vertices.flatMap((p) => dxfPointTags(10, p)),
  ];
}

/** DXF 使用图纸坐标，X 向右、Y 向上，原比例为毫米。 */
export function exportDocumentToDxf(input: GeometryDocument, { includeAxes = true } = {}) {
  const doc = GeometryDocument.parse(input);
  const writer = new DxfWriter();
  const box = sheetBounds(doc);
  if (includeAxes) {
    for (const reference of referenceGeometry(doc)) {
      const style = dxfEntityStyle({
        lineStyle: 'CONSTRUCTION',
        appearance: { color: '#638894', pattern: reference.direction ? 'CENTER' : 'SOLID' },
      });
      const ends = clipReference(reference, box);
      if (ends) writer.entity('LINE', dxfAxisLayer, style, line(...ends));
      const at = ends
        ? add(scale(ends[0], 0.15), scale(ends[1], 0.85))
        : add(reference.anchor, { x: 1, y: -3 });
      const label = dxfTextTags({
        at,
        angle: 0,
        size: 2.5,
        text: reference.name === '原点 O' ? 'O' : reference.name,
      });
      writer.entity(label.type, dxfAxisLayer, style, label.tags);
    }
  }
  const entities = new Map(doc.entities.map((entity) => [entity.id, entity]));
  const layers = new Map(doc.layers.map(({ id, role }) => [id, dxfLayerNames[role]]));
  const pointAt = (id: string) => {
    const point = entities.get(id);
    if (point?.kind !== 'point') throw Error('点引用不存在');
    return point.position;
  };
  for (const entity of doc.entities) {
    const { viewId } = entity;
    const at = (p: Vec2) => localToSheet(doc, viewId, p);
    const frame = viewTransform(doc, viewId);
    const mirror = cross(frame.xAxis, frame.yAxis) < 0 ? -1 : 1;
    const direction = (degrees: number) => {
      const p = angleVector(degrees);
      return add(scale(frame.xAxis, p.x), scale(frame.yAxis, p.y));
    };
    const layer = layers.get(entity.layerId)!;
    const style = dxfEntityStyle(entity);
    const metadata: DxfPair[] = [[1000, 'FRAME=' + doc.editorType + '/' + viewId]];
    if (entity.appearance?.widthMm !== undefined)
      metadata.push([1000, 'WIDTH_MM=' + entity.appearance.widthMm]);
    const emit = (type: string, tags: DxfPair[], extra: DxfPair[] = [], destination = layer) =>
      writer.entity(type, destination, style, tags, [...metadata, ...extra]);
    switch (entity.kind) {
      case 'point':
        emit(
          'POINT',
          [[100, 'AcDbPoint'], ...dxfPointTags(10, at(entity.position), 0)],
          [
            [1000, 'NAME=' + entity.name.replace(/[\r\n\0]/g, ' ')],
            [1000, 'LABEL=' + Number(entity.labelVisible)],
          ],
        );
        break;
      case 'segment':
        emit('LINE', line(at(pointAt(entity.startPoint)), at(pointAt(entity.endPoint))));
        break;
      case 'line': {
        const a = at(entity.anchor),
          d = sub(at(add(entity.anchor, entity.direction)), a);
        const ends = clipLine({ a, d, finite: false }, box);
        if (ends) emit('LINE', line(...ends), [], dxfReferenceLayer);
        break;
      }
      case 'circle':
        emit('CIRCLE', [
          [100, 'AcDbCircle'],
          ...dxfPointTags(10, at(pointAt(entity.center)), 0),
          [40, entity.radius],
        ]);
        break;
      case 'arc': {
        // DXF 总沿 OCS 的逆时针方向。顺时针图形使用 -Z 法向，同时变换圆心和起角。
        const sweep = entity.sweep * mirror,
          normal = Math.sign(sweep);
        const sheetStart = angle(direction(entity.startAngle));
        const start = wrapAngle(normal < 0 ? 180 - sheetStart : sheetStart);
        const end = Math.abs(sweep) === 360 ? start + 360 : wrapAngle(start + Math.abs(sweep));
        emit('ARC', [
          [100, 'AcDbCircle'],
          ...dxfPointTags(10, ocsPoint(at(pointAt(entity.center)), normal), 0),
          [40, entity.radius],
          ...extrusion(normal),
          [100, 'AcDbArc'],
          [50, start],
          [51, end],
        ]);
        break;
      }
      case 'ellipse': {
        // 椭圆中心和主轴在 WCS，法向决定参数增长方向与副轴朝向。
        const normal = Math.sign(entity.sweep * mirror);
        const turn = 2 * Math.PI,
          full = Math.abs(entity.sweep) === 360;
        const start = full
          ? 0
          : wrapAngle((entity.startAngle * mirror * normal) / dxfDegrees, turn);
        const end = full ? turn : wrapAngle(start + Math.abs(entity.sweep) / dxfDegrees, turn);
        emit('ELLIPSE', [
          [100, 'AcDbEllipse'],
          ...dxfPointTags(10, at(pointAt(entity.center)), 0),
          ...dxfPointTags(11, scale(direction(entity.angle), entity.majorRadius), 0),
          ...extrusion(normal),
          [40, entity.minorRadius / entity.majorRadius],
          [41, start],
          [42, end],
        ]);
        break;
      }
      case 'curve': {
        const spline = dxfSplineTags(
          entity.pointIds.map((id) => at(pointAt(id))),
          entity.interpolation,
          entity.parameterRange,
        );
        emit('SPLINE', spline.tags, spline.metadata);
        break;
      }
      case 'polyline':
        emit('LWPOLYLINE', polyline(entity.points.map(at)));
        break;
      case 'hatch':
        emit('HATCH', dxfHatchTags(doc, entity, entities));
        break;
      case 'plane':
        emit(
          'LWPOLYLINE',
          polyline(planeOutline(doc, entity).map(at)),
          [],
          layer + dxfAnnotationSuffix,
        );
        break;
      case 'text':
      case 'dimension':
      case 'symbol':
      case 'engineeringAnnotation': {
        const drawing = mapCadDrawing(cadDrawing(doc, entity), at);
        const destination = entity.kind === 'text' ? layer : layer + dxfAnnotationSuffix;
        for (const points of drawing.strokes) {
          if (points.length === 2) emit('LINE', line(points[0], points[1]), [], destination);
          else if (points.length > 2) emit('LWPOLYLINE', polyline(points), [], destination);
        }
        for (const label of drawing.labels) {
          const text = dxfTextTags(label);
          emit(text.type, text.tags, [], destination);
        }
        break;
      }
    }
  }
  return writer.finish();
}
