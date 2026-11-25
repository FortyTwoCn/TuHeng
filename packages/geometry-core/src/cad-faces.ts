import type { GeometryDocument, GeometryEntity, Vec2 } from '@tuheng/contracts';
import { cross, distance, length, sub } from './math';
import {
  boundaryAt,
  boundaryShape,
  shapeIntersections,
  type BoundaryShape,
} from './parametric-geometry';
import { shapeBounds } from './snap-geometry';
import { distinct } from './curve-roots';

export type FaceSpan = { entityId: string; from: number; to: number };
type SpanEdge = { span: FaceSpan; to: number; bearing: number; reverse: number };

const joinTolerance = 2e-5;
function lineError(p: Vec2, a: Vec2, b: Vec2) {
  const d = sub(b, a);
  return length(d) < 1e-9 ? distance(a, p) : Math.abs(cross(d, sub(p, a))) / length(d);
}

export function spanPoints(shape: BoundaryShape, from: number, to: number): Vec2[] {
  const a = boundaryAt(shape, from),
    b = boundaryAt(shape, to);
  if (shape.kind === 'line') return [a, b];
  const samples = [a];
  function subdivide(l: number, r: number, p: Vec2, q: Vec2, depth: number) {
    const m = (l + r) / 2,
      center = boundaryAt(shape, m);
    const curved =
      Math.max(
        lineError(center, p, q),
        lineError(boundaryAt(shape, (l + m) / 2), p, q),
        lineError(boundaryAt(shape, (m + r) / 2), p, q),
      ) > 0.015;
    if (depth > 0 && (curved || Math.abs(r - l) > 0.125)) {
      subdivide(l, m, p, center, depth - 1);
      subdivide(m, r, center, q, depth - 1);
    } else samples.push(q);
  }
  subdivide(from, to, a, b, 8);
  return samples;
}

export function facePerimeter(
  doc: GeometryDocument,
  spans: FaceSpan[],
  shapes = new Map<string, BoundaryShape>(),
): Vec2[] {
  const points: Vec2[] = [];
  for (const { entityId, from, to } of spans) {
    let shape = shapes.get(entityId);
    if (!shape) {
      const entity = doc.entities.find((e) => e.id === entityId);
      shape = entity && boundaryShape(doc, entity);
      if (!shape) throw Error('剖面边界不存在');
      shapes.set(entityId, shape);
    }
    const path = spanPoints(shape, from, to);
    if (points.length && distance(points.at(-1)!, path[0]) > joinTolerance)
      throw Error('剖面边界已断开');
    points.push(...(points.length ? path.slice(1) : path));
  }
  if (points.length < 4 || distance(points[0], points.at(-1)!) > joinTolerance)
    throw Error('剖面边界未闭合');
  return points.slice(0, -1);
}

function contains(q: Vec2, points: Vec2[]) {
  let inside = false;
  for (const [i, a] of points.entries()) {
    const b = points[(i + 1) % points.length];
    if (a.y > q.y !== b.y > q.y && q.x < a.x + ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y))
      inside = !inside;
  }
  return inside;
}

function boundsOverlap(a: number[], b: number[]) {
  return (
    a[0] <= b[2] + joinTolerance &&
    b[0] <= a[2] + joinTolerance &&
    a[1] <= b[3] + joinTolerance &&
    b[1] <= a[3] + joinTolerance
  );
}
type FaceShape = { entity: GeometryEntity; shape: BoundaryShape; bounds: number[]; cuts: number[] };

export function hatchFaceAt(
  doc: GeometryDocument,
  viewId: string,
  pick: Vec2,
  hidden: readonly string[],
) {
  const objects: FaceShape[] = [];
  for (const entity of doc.entities) {
    if (entity.viewId !== viewId || hidden.includes(entity.layerId)) continue;
    const shape = boundaryShape(doc, entity);
    if (!shape) continue;
    const bounds = shapeBounds(shape) ?? [-Infinity, -Infinity, Infinity, Infinity];
    // Infinite construction lines only contribute edges between actual intersections.
    const cuts =
      entity.kind === 'line'
        ? []
        : entity.kind === 'curve'
          ? (entity.parameterRange ?? [0, 1])
          : [0, 1];
    objects.push({ entity, shape, bounds, cuts: [...cuts] });
  }
  objects.sort((a, b) => a.bounds[0] - b.bounds[0]);
  let pairs = 0;
  // Bounding boxes reject distant pairs before the analytic curve intersection step.
  for (const [i, a] of objects.entries()) {
    for (
      let j = i + 1;
      j < objects.length && objects[j].bounds[0] <= a.bounds[2] + joinTolerance;
      j++
    ) {
      const b = objects[j];
      if (!boundsOverlap(a.bounds, b.bounds)) continue;
      if (++pairs > 8000) throw Error('可见边界过于密集，请隐藏无关图层后选择区域');
      const hits = shapeIntersections(a.shape, b.shape);
      for (const h of hits)
        if (!h.tangent) {
          a.cuts.push(h.a);
          b.cuts.push(h.b);
        }
    }
  }

  const buckets = new Map<string, number[]>(),
    vertices: Vec2[] = [];
  const outgoing: number[][] = [],
    edges: SpanEdge[] = [];
  function vertex(p: Vec2) {
    const x = Math.floor(p.x / joinTolerance),
      y = Math.floor(p.y / joinTolerance);
    for (const dx of [-1, 0, 1])
      for (const dy of [-1, 0, 1])
        for (const index of buckets.get(x + dx + ',' + (y + dy)) ?? [])
          if (distance(p, vertices[index]) <= joinTolerance) return index;
    const id = vertices.length,
      key = x + ',' + y;
    vertices.push(p);
    outgoing.push([]);
    const block = buckets.get(key) ?? [];
    block.push(id);
    buckets.set(key, block);
    return id;
  }
  function addEdge(object: FaceShape, from: number, to: number) {
    const entityId = object.entity.id;
    const a = boundaryAt(object.shape, from),
      b = boundaryAt(object.shape, to),
      u = vertex(a),
      v = vertex(b);
    if (u === v && object.shape.kind === 'line') return;
    const delta = (from - to) * 0.0001,
      startSlope = sub(boundaryAt(object.shape, from - delta), a),
      endSlope = sub(boundaryAt(object.shape, to + delta), b);
    const index = edges.length;
    edges.push(
      {
        span: { entityId, from, to },
        to: v,
        bearing: Math.atan2(startSlope.y, startSlope.x),
        reverse: index + 1,
      },
      {
        span: { entityId, from: to, to: from },
        to: u,
        bearing: Math.atan2(endSlope.y, endSlope.x),
        reverse: index,
      },
    );
    outgoing[u].push(index);
    outgoing[v].push(index + 1);
  }
  for (const object of objects) {
    const cuts = distinct(object.cuts, 1e-8);
    for (let i = 1; i < cuts.length; i++) addEdge(object, cuts[i - 1], cuts[i]);
  }
  if (edges.length > 12000) throw Error('可见区域的边界交点过多');
  for (const list of outgoing) list.sort((a, b) => edges[a].bearing - edges[b].bearing);
  const shapes = new Map(objects.map((o) => [o.entity.id, o.shape]));
  const visited = new Set<number>();
  const faces: { spans: FaceSpan[]; points: Vec2[]; area: number }[] = [];
  for (const [start] of edges.entries()) {
    if (visited.has(start)) continue;
    const path = new Set<number>();
    let current = start;
    do {
      visited.add(current);
      path.add(current);
      const { to, reverse } = edges[current],
        list = outgoing[to];
      current = list[(list.indexOf(reverse) + list.length - 1) % list.length];
    } while (!visited.has(current));
    if (current !== start) continue;
    const spans = [...path].filter((i) => !path.has(edges[i].reverse)).map((i) => edges[i].span);
    if (!spans.length || spans.length > 256) continue;
    try {
      const points = facePerimeter(doc, spans, shapes);
      const area =
        points.reduce((sum, p, i) => sum + cross(p, points[(i + 1) % points.length]), 0) / 2;
      if (area > 1e-8) faces.push({ spans, points, area });
    } catch {
      // A dangling or disconnected walk is not a fillable boundary.
    }
  }
  const outer = faces
    .filter((face) => contains(pick, face.points))
    .sort((a, b) => a.area - b.area)[0];
  if (!outer) throw Error('此处没有闭合区域，请检查边界或选取完整轮廓');
  const encloses = (a: typeof outer, b: typeof outer) =>
    a.area > b.area && b.points.every((p) => contains(p, a.points));
  const inside = faces.filter((f) => encloses(outer, f));
  const holes = inside.filter((f) => !inside.some((other) => encloses(other, f)));
  return [outer, ...holes].map((f) => f.spans);
}
