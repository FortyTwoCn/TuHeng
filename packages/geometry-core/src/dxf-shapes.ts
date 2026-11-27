import type { Vec2 } from '@tuheng/contracts';
import type { Interpolation } from './curves';
import {
  dxfGroups,
  dxfNormal,
  dxfNumber,
  dxfPoint,
  UnsupportedDxfEntity,
  type DxfTags,
} from './dxf-format';
import { add, angle, distance, scale, sub } from './vectors';

export type DxfShape =
  | { kind: 'point'; position: Vec2; name?: string; labelVisible?: boolean }
  | { kind: 'segment'; start: Vec2; end: Vec2 }
  | { kind: 'polyline'; points: Vec2[]; closed: boolean }
  | { kind: 'circle'; center: Vec2; radius: number }
  | { kind: 'arc'; center: Vec2; radius: number; startAngle: number; sweep: number }
  | { kind: 'ellipse'; center: Vec2; major: Vec2; ratio: number; startAngle: number; sweep: number }
  | { kind: 'curve'; points: Vec2[]; interpolation: Interpolation; range?: [number, number] }
  | { kind: 'text'; position: Vec2; angle: number; size: number; content: string };

export const dxfDegrees = 180 / Math.PI;
export const wrapAngle = (value: number, turn = 360) => ((value % turn) + turn) % turn;
export const ocsPoint = ({ x, y }: Vec2, normal: number) => ({ x: x * normal, y });
export const angleVector = (degrees: number) => ({
  x: Math.cos(degrees / dxfDegrees),
  y: Math.sin(degrees / dxfDegrees),
});

export function ccwSweep(start: number, end: number, turn = 360) {
  return Math.abs(end - start) >= turn - 1e-10 ? turn : wrapAngle(end - start, turn);
}

function positiveRadius(radius: number) {
  if (radius <= 0) throw Error('DXF 曲线半径必须大于零');
  return radius;
}

export function dxfCircle(tags: DxfTags): DxfShape {
  return {
    kind: 'circle',
    center: ocsPoint(dxfPoint(tags), dxfNormal(tags)),
    radius: positiveRadius(dxfNumber(tags, 40)),
  };
}

export function dxfArc(tags: DxfTags, normal = dxfNormal(tags), reversed = false): DxfShape {
  const start = dxfNumber(tags, 50),
    end = dxfNumber(tags, 51);
  const sweep = ccwSweep(start, end);
  if (sweep <= 0.001) throw new UnsupportedDxfEntity('圆弧扫角过小');
  const first = reversed ? end : start;
  return {
    kind: 'arc',
    center: ocsPoint(dxfPoint(tags), normal),
    radius: positiveRadius(dxfNumber(tags, 40)),
    startAngle: wrapAngle(normal < 0 ? 180 - first : first),
    sweep: sweep * normal * (reversed ? -1 : 1),
  };
}

export function dxfEllipse(tags: DxfTags): DxfShape {
  const normal = dxfNormal(tags),
    ratio = dxfNumber(tags, 40);
  const start = dxfNumber(tags, 41, 0),
    end = dxfNumber(tags, 42, 2 * Math.PI);
  return dxfEllipseFromParameters(dxfPoint(tags), dxfPoint(tags, 11), ratio, start, end, normal);
}

export function dxfEllipseFromParameters(
  center: Vec2,
  major: Vec2,
  ratio: number,
  start: number,
  end: number,
  normal: number,
  reversed = false,
): DxfShape {
  const sweep = ccwSweep(start, end, 2 * Math.PI) * dxfDegrees;
  if (ratio <= 0 || ratio > 1 || !Math.hypot(major.x, major.y)) throw Error('DXF 椭圆轴无效');
  if (sweep <= 0.001) throw new UnsupportedDxfEntity('椭圆扫角过小');
  return {
    kind: 'ellipse',
    center,
    major,
    ratio,
    startAngle: wrapAngle((reversed ? end : start) * dxfDegrees * normal),
    sweep: sweep * normal * (reversed ? -1 : 1),
  };
}

export const dxfVertices = (tags: DxfTags) => dxfGroups(tags, 10);
export function dxfVertex(tags: DxfTags, normal: number) {
  return { position: ocsPoint(dxfPoint(tags), normal), bulge: dxfNumber(tags, 42, 0) * normal };
}

export function dxfPolyline(vertices: ReturnType<typeof dxfVertex>[], closed: boolean): DxfShape[] {
  if (vertices.length < 2 || vertices.length > 4096)
    throw new UnsupportedDxfEntity('多段线顶点数超出 2 至 4096');
  if (!vertices.some((vertex) => vertex.bulge))
    return [{ kind: 'polyline', points: vertices.map(({ position }) => position), closed }];
  // Bulge = tan(扫角/4)。负值保留顺时针方向，闭合边取最后一顶点的 bulge。
  const edges: DxfShape[] = [];
  for (let index = 0; index < (closed ? vertices.length : vertices.length - 1); index++) {
    const { position: start, bulge } = vertices[index];
    const end = vertices[(index + 1) % vertices.length].position;
    if (distance(start, end) <= 1e-8) continue;
    const sweep = 4 * Math.atan(bulge) * dxfDegrees;
    if (Math.abs(sweep) <= 0.001) {
      edges.push({ kind: 'segment', start, end });
      continue;
    }
    const delta = sub(end, start);
    const middle = add(start, scale(delta, 0.5));
    const center = add(middle, scale({ x: -delta.y, y: delta.x }, (1 / bulge - bulge) / 4));
    edges.push({
      kind: 'arc',
      center,
      radius: distance(start, center),
      startAngle: angle(sub(start, center)),
      sweep,
    });
  }
  return edges;
}

export function dxfShapeBoundsPoints(shape: DxfShape): Vec2[] {
  switch (shape.kind) {
    case 'point':
    case 'text':
      return [shape.position];
    case 'segment':
      return [shape.start, shape.end];
    case 'polyline':
    case 'curve':
      return shape.points;
    case 'circle':
    case 'arc':
    case 'ellipse': {
      const radius =
        shape.kind === 'ellipse' ? Math.hypot(shape.major.x, shape.major.y) : shape.radius;
      return [
        add(shape.center, { x: -radius, y: -radius }),
        add(shape.center, { x: radius, y: radius }),
      ];
    }
  }
}
