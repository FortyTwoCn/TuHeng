import {
  hatchRing,
  type GeometryDocument,
  type GeometryEntity,
  type Vec2,
} from '@tuheng/contracts';
import { facePerimeter } from './cad-faces';
import {
  dxfGroups,
  dxfNormal,
  dxfNumber,
  dxfPoint,
  dxfPointTags,
  UnsupportedDxfEntity,
  type DxfPair,
  type DxfTags,
} from './dxf-format';
import {
  angleVector,
  ccwSweep,
  dxfArc,
  dxfEllipseFromParameters,
  dxfPolyline,
  dxfVertex,
  dxfVertices,
  ocsPoint,
  wrapAngle,
  type DxfShape,
} from './dxf-shapes';
import { readDxfSpline } from './dxf-spline';
import { localToSheet, viewTransform } from './sheet';
import { add, angle, scale } from './vectors';

type Hatch = Extract<GeometryEntity, { kind: 'hatch' }>;
type Segment = Extract<GeometryEntity, { kind: 'segment' }>;

/** 输出带实际图案方向和间距的非关联填充，CAD 可直接显示剖面线和内孔。 */
export function dxfHatchTags(
  doc: GeometryDocument,
  hatch: Hatch,
  entities: ReadonlyMap<string, GeometryEntity>,
): DxfPair[] {
  const sheet = (p: Vec2) => localToSheet(doc, hatch.viewId, p);
  const polyline = (points: Vec2[], index: number): DxfPair[] => [
    [92, index === 0 ? 3 : 2],
    [72, 0],
    [73, 1],
    [93, points.length],
    ...points.flatMap((p) => dxfPointTags(10, sheet(p))),
    [97, 0],
  ];
  const frame = viewTransform(doc, hatch.viewId);
  const direction = (a: number) => {
    const v = angleVector(a);
    return add(scale(frame.xAxis, v.x), scale(frame.yAxis, v.y));
  };
  const paths =
    hatch.spans?.flatMap((spans, i) => polyline(facePerimeter(doc, spans), i)) ??
    hatch.loops.flatMap((loop, i): DxfPair[] => {
      const border = entities.get(loop[0]);
      if (loop.length === 1 && (border?.kind === 'circle' || border?.kind === 'ellipse')) {
        const center = entities.get(border.center);
        if (center?.kind !== 'point') throw Error('剖面边界圆心不存在');
        const edge: DxfPair[] =
          border.kind === 'circle'
            ? [[72, 2], ...dxfPointTags(10, sheet(center.position)), [40, border.radius]]
            : [
                [72, 3],
                ...dxfPointTags(10, sheet(center.position)),
                ...dxfPointTags(11, scale(direction(border.angle), border.majorRadius)),
                [40, border.minorRadius / border.majorRadius],
              ];
        return [[92, i === 0 ? 1 : 0], [93, 1], ...edge, [50, 0], [51, 360], [73, 1], [97, 0]];
      }
      const corners = hatchRing(loop.map((id) => entities.get(id) as Segment));
      return polyline(
        corners.map((id) => {
          const corner = entities.get(id);
          if (corner?.kind !== 'point') throw Error('剖面边界点不存在');
          return corner.position;
        }),
        i,
      );
    });
  const origin = sheet(hatch.origin),
    tangent = direction(hatch.angle);
  const degrees = wrapAngle(angle(tangent));
  return [
    [100, 'AcDbHatch'],
    ...dxfPointTags(10, { x: 0, y: 0 }, 0),
    [210, 0],
    [220, 0],
    [230, 1],
    [2, 'USER'],
    [70, 0],
    [71, 0],
    [91, hatch.loops.length],
    ...paths,
    [75, 0],
    [76, 0],
    [52, degrees],
    [41, 1],
    [77, 0],
    [78, 1],
    [53, degrees],
    [43, origin.x],
    [44, origin.y],
    [45, -tangent.y * hatch.spacing],
    [46, tangent.x * hatch.spacing],
    [79, 0],
    [98, 0],
  ];
}

export function readDxfHatch(tags: DxfTags): DxfShape[] {
  const normal = dxfNormal(tags);
  const end = tags.findIndex(([code]) => code === 75);
  const paths = dxfGroups(end === -1 ? tags : tags.slice(0, end), 92);
  if (dxfNumber(tags, 91, paths.length) !== paths.length) throw Error('DXF 的剖面边界已截断');
  if (paths.length > 256) throw new UnsupportedDxfEntity('剖面边界过多');
  // 读入两种边界记录。填充图案仍由源 CAD 管理，图衡保留可编辑轮廓。
  return paths.flatMap((path): DxfShape[] => {
    if (dxfNumber(path, 92) & 2) {
      const vertices = dxfVertices(path).map((v) => dxfVertex(v, normal));
      if (dxfNumber(path, 93, vertices.length) !== vertices.length)
        throw Error('DXF 的剖面顶点已截断');
      return dxfPolyline(vertices, !!dxfNumber(path, 73, 0));
    }
    const edges = dxfGroups(path, 72);
    if (dxfNumber(path, 93, edges.length) !== edges.length) throw Error('DXF 的剖面边已截断');
    return edges.map((edge): DxfShape => {
      switch (dxfNumber(edge, 72)) {
        case 1:
          return {
            kind: 'segment',
            start: ocsPoint(dxfPoint(edge), normal),
            end: ocsPoint(dxfPoint(edge, 11), normal),
          };
        case 2:
          return dxfArc(edge, normal, !dxfNumber(edge, 73, 1));
        case 3: {
          // HATCH 的椭圆边使用度表示极角，ELLIPSE 的参数使用弧度。
          const ratio = dxfNumber(edge, 40);
          const parameter = (degrees: number) => {
            const { x, y } = angleVector(degrees);
            return wrapAngle(Math.atan2(y / ratio, x), 2 * Math.PI);
          };
          const first = dxfNumber(edge, 50),
            last = dxfNumber(edge, 51);
          const start = parameter(first);
          const stop = ccwSweep(first, last) === 360 ? start + 2 * Math.PI : parameter(last);
          return dxfEllipseFromParameters(
            ocsPoint(dxfPoint(edge), normal),
            ocsPoint(dxfPoint(edge, 11), normal),
            ratio,
            start,
            stop,
            normal,
            !dxfNumber(edge, 73, 1),
          );
        }
        case 4: {
          const codes: Record<number, number> = { 94: 71, 95: 72, 96: 73, 42: 41 };
          return readDxfSpline(
            edge.map(([c, v]) => [
              codes[c] ?? c,
              normal < 0 && (c === 10 || c === 11) ? String(-Number(v)) : v,
            ]),
            [],
          );
        }
        default:
          throw new UnsupportedDxfEntity('包含不支持的剖面边');
      }
    });
  });
}
