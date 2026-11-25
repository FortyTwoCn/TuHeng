import type { GeometryDocument, GeometryEntity, Vec2 } from '@tuheng/contracts';
import { cross, distance, dot, sub } from './math';
import { ellipseAt } from './cad-geometry';

interface Contour {
  edges: string[];
  perimeter: Vec2[];
  area: number;
  contains: (point: Vec2) => boolean;
}
function pointInPolygon(p: Vec2, polygon: Vec2[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
}
/** Walk the face on the left of each directed half-edge. Shared edges delimit adjacent faces. */
function segmentFaces(
  segments: Extract<GeometryEntity, { kind: 'segment' }>[],
  points: Map<string, Vec2>,
): Contour[] {
  type Edge = { id: string; from: string; to: string; angle: number; reverse?: Edge };
  const neighbors = new Map<string, Edge[]>();
  for (const entity of segments) {
    const a = points.get(entity.startPoint),
      b = points.get(entity.endPoint);
    if (!a || !b || distance(a, b) < 1e-8) continue;
    const forward: Edge = {
      id: entity.id,
      from: entity.startPoint,
      to: entity.endPoint,
      angle: Math.atan2(b.y - a.y, b.x - a.x),
    };
    const backward: Edge = {
      id: entity.id,
      from: entity.endPoint,
      to: entity.startPoint,
      angle: Math.atan2(a.y - b.y, a.x - b.x),
    };
    forward.reverse = backward;
    backward.reverse = forward;
    for (const edge of [forward, backward]) {
      const list = neighbors.get(edge.from) ?? [];
      list.push(edge);
      neighbors.set(edge.from, list);
    }
  }
  for (const group of neighbors.values()) group.sort((a, b) => a.angle - b.angle);
  const visited = new Set<Edge>(),
    result: Contour[] = [];
  for (const group of neighbors.values())
    for (const initial of group) {
      if (visited.has(initial)) continue;
      const path: Edge[] = [];
      let edge = initial;
      while (!visited.has(edge)) {
        visited.add(edge);
        path.push(edge);
        const outgoing = neighbors.get(edge.to)!;
        edge = outgoing[(outgoing.indexOf(edge.reverse!) + outgoing.length - 1) % outgoing.length];
      }
      if (
        edge !== initial ||
        path.length < 3 ||
        new Set(path.map((e) => e.from)).size !== path.length
      )
        continue;
      const polygon = path.map((e) => points.get(e.from)!);
      const area =
        polygon.reduce((sum, p, i) => sum + cross(p, polygon[(i + 1) % polygon.length]), 0) / 2;
      if (area > 1e-8)
        result.push({
          area,
          edges: path.map((e) => e.id),
          perimeter: polygon,
          contains: (p) => pointInPolygon(p, polygon),
        });
    }
  return result;
}
/** Resolve a region only when the user taps its interior. This does not run on pointermove. */
export function regionAt(
  doc: GeometryDocument,
  viewId: string,
  position: Vec2,
  hiddenLayers: readonly string[] = [],
): string[] {
  const entities = doc.entities.filter(
    (e) => e.viewId === viewId && !hiddenLayers.includes(e.layerId),
  );
  const points = new Map(
    doc.entities.filter((e) => e.kind === 'point').map((e) => [e.id, e.position]),
  );
  const contours = segmentFaces(
    entities.filter((e) => e.kind === 'segment'),
    points,
  );
  for (const e of entities) {
    if (e.kind !== 'circle' && !(e.kind === 'ellipse' && Math.abs(e.sweep) === 360)) continue;
    const center = points.get(e.center)!;
    const a = e.kind === 'circle' ? e.radius : e.majorRadius,
      b = e.kind === 'circle' ? e.radius : e.minorRadius;
    const theta = ((e.kind === 'circle' ? 0 : e.angle) * Math.PI) / 180;
    const axis = { x: Math.cos(theta), y: Math.sin(theta) },
      normal = { x: -axis.y, y: axis.x };
    const perimeter = Array.from({ length: 32 }, (_, i) =>
      e.kind === 'ellipse'
        ? ellipseAt(center, e, (360 * i) / 32)
        : {
            x: center.x + a * Math.cos((i * Math.PI) / 16),
            y: center.y + b * Math.sin((i * Math.PI) / 16),
          },
    );
    contours.push({
      area: Math.PI * a * b,
      edges: [e.id],
      perimeter,
      contains(q) {
        const d = sub(q, center);
        return (dot(d, axis) / a) ** 2 + (dot(d, normal) / b) ** 2 < 1 - 1e-10;
      },
    });
  }
  const surrounds = (outer: Contour, inner: Contour) =>
    outer.area > inner.area && inner.perimeter.every((p) => outer.contains(p));
  const candidates = contours.filter((r) => r.contains(position)).sort((a, b) => a.area - b.area);
  if (!candidates.length) throw Error('此处没有可识别的闭合区域。请连接端点或点选边界');
  const outer = candidates[0];
  if (candidates.slice(1).some((r) => !surrounds(r, outer)))
    throw Error('轮廓重叠，请明确点选边界');
  const nested = contours.filter((r) => surrounds(outer, r));
  const holes = nested.filter((r) => !nested.some((other) => surrounds(other, r)));
  return [...outer.edges, ...holes.flatMap((r) => r.edges)];
}
