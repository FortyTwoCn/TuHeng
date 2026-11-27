import type { GeometryDocument, GeometryEntity, Vec2 } from '@tuheng/contracts';
import { spanPoints } from './cad-faces';
import { cross, distance, dot, sub } from './math';
import { boundaryShape } from './parametric-geometry';

export const CONTOUR_JOIN_MM = 0.00002;
export const CONTOUR_SEGMENT_LIMIT = 6000;
const epsilon = 1e-9;

export type ContourEdge = { from: Vec2; to: Vec2; entityId: string };
export type DrawingContour = { edges: ContourEdge[]; area: number; hole: boolean };
export type ContourProblem = { entityIds: string[]; points: Vec2[]; detail: string };
export type ContourPath = { entity: GeometryEntity; points: Vec2[] };

export function isContourEntity(entity: GeometryEntity) {
  return ['segment', 'line', 'circle', 'arc', 'ellipse', 'curve', 'polyline'].includes(entity.kind);
}

export function contourLineRole(entity: GeometryEntity) {
  const pattern = entity.appearance?.pattern;
  if (pattern === 'CENTER') return 'CENTER';
  if (entity.lineStyle === 'CONSTRUCTION' || pattern === 'GUIDE' || pattern === 'PHANTOM')
    return 'GUIDE';
  return entity.lineStyle.endsWith('_HIDDEN') ? 'HIDDEN' : 'VISIBLE';
}

export function sampleContour(doc: GeometryDocument, entity: GeometryEntity): Vec2[] {
  if (entity.kind === 'polyline') return entity.points;
  if (entity.kind === 'line') return [];
  const shape = boundaryShape(doc, entity);
  if (!shape) return [];
  if (shape.kind === 'line') return spanPoints(shape, 0, 1);
  // Include conic extrema and spline joins so projections preserve their actual extents.
  const [start, end] = entity.kind === 'curve' ? (entity.parameterRange ?? [0, 1]) : [0, 1];
  const cuts = [start, end];
  if (shape.conic) {
    const { a, b, angle, sweep, start: initial } = shape.conic;
    const radians = (angle * Math.PI) / 180;
    const extrema = [
      Math.atan2(-b * Math.sin(radians), a * Math.cos(radians)),
      Math.atan2(b * Math.cos(radians), a * Math.sin(radians)),
    ];
    for (const theta of extrema)
      for (let i = -4; i <= 4; i++)
        cuts.push(((theta * 180) / Math.PI + 180 * i - initial) / sweep);
    const count = Math.ceil(Math.abs(sweep) / 11.25);
    for (let i = 1; i < count; i++) cuts.push(i / count);
  } else {
    for (const piece of shape.pieces)
      cuts.push(piece.parameter(piece.lo), piece.parameter(piece.hi));
  }
  const knots = cuts
    .filter((t) => t >= start && t <= end)
    .sort((a, b) => a - b)
    .filter((t, i, list) => !i || t - list[i - 1] > epsilon);
  return knots.slice(1).flatMap((t, i) => spanPoints(shape, knots[i], t).slice(i ? 1 : 0));
}

export function containsContourPoint(edges: readonly ContourEdge[], { x, y }: Vec2) {
  let inside = false;
  for (const { from: a, to: b } of edges)
    if (a.y > y !== b.y > y && x < a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y)) inside = !inside;
  return inside;
}

type Segment = ContourEdge & {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  cuts: number[];
};
type HalfEdge = { from: number; to: number; reverse: number; entityId: string; angle: number };
const mix = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
const inSegment = (t: number) => t >= -epsilon && t <= 1 + epsilon;
const interior = (t: number) => t > epsilon && t < 1 - epsilon;

function splitAtIntersections(segments: Segment[]) {
  const problems: ContourProblem[] = [];
  const problemKeys = new Set<string>();
  const mark = (a: Segment, b: Segment, point: Vec2, detail: string) => {
    const entityIds = [...new Set([a.entityId, b.entityId])].sort();
    const key = JSON.stringify([entityIds, detail]);
    if (problems.length < 24 && !problemKeys.has(key)) {
      problems.push({ entityIds, points: [point], detail });
      problemKeys.add(key);
    }
  };
  segments.sort((a, b) => a.minX - b.minX);
  let comparisons = 0;
  for (const [i, a] of segments.entries()) {
    const ad = sub(a.to, a.from);
    for (let j = i + 1; j < segments.length && segments[j].minX <= a.maxX + CONTOUR_JOIN_MM; j++) {
      if (++comparisons > 750000) throw Error('轮廓交点过密，已达到审核计算上限');
      const b = segments[j];
      if (b.maxY < a.minY - CONTOUR_JOIN_MM || b.minY > a.maxY + CONTOUR_JOIN_MM) continue;
      const bd = sub(b.to, b.from);
      const ab = sub(b.from, a.from);
      const determinant = cross(ad, bd);
      const lenA = Math.hypot(ad.x, ad.y);
      const lenB = Math.hypot(bd.x, bd.y);
      if (Math.abs(determinant) <= epsilon * lenA * lenB) {
        if (Math.abs(cross(ad, ab)) > CONTOUR_JOIN_MM * lenA) continue;
        const t = dot(ab, ad) / (lenA * lenA);
        const u = t + dot(bd, ad) / (lenA * lenA);
        const low = Math.max(0, Math.min(t, u));
        const high = Math.min(1, Math.max(t, u));
        if ((high - low) * lenA > CONTOUR_JOIN_MM)
          mark(a, b, mix(a.from, a.to, (low + high) / 2), '发现重复或部分重叠的轮廓');
        continue;
      }
      const t = cross(ab, bd) / determinant;
      const u = cross(ab, ad) / determinant;
      if (!inSegment(t) || !inSegment(u)) continue;
      if (interior(t)) a.cuts.push(t);
      if (interior(u)) b.cuts.push(u);
      if (interior(t) && interior(u) && a.entityId === b.entityId)
        mark(a, b, mix(a.from, a.to, t), '轮廓发生自交，无法确定实体内外');
    }
  }
  return problems;
}

function contourGraph(segments: Segment[]) {
  const points: Vec2[] = [];
  const outgoing: number[][] = [];
  const buckets = new Map<string, number[]>();
  const halfEdges: HalfEdge[] = [];
  const edgeKeys = new Set<string>();
  const vertex = (p: Vec2) => {
    const x = Math.floor(p.x / CONTOUR_JOIN_MM),
      y = Math.floor(p.y / CONTOUR_JOIN_MM);
    for (let i = x - 1; i <= x + 1; i++)
      for (let j = y - 1; j <= y + 1; j++)
        for (const index of buckets.get(`${i},${j}`) ?? [])
          if (distance(p, points[index]) <= CONTOUR_JOIN_MM) return index;
    const index = points.length,
      key = `${x},${y}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(index);
    buckets.set(key, bucket);
    points.push(p);
    outgoing.push([]);
    return index;
  };
  for (const segment of segments) {
    const knots = segment.cuts.sort((a, b) => a - b);
    let from = vertex(segment.from);
    for (const t of knots.slice(1)) {
      const to = vertex(mix(segment.from, segment.to, t));
      if (to === from) continue;
      const key = `${Math.min(from, to)},${Math.max(from, to)}`;
      if (!edgeKeys.has(key)) {
        edgeKeys.add(key);
        if (halfEdges.length >= CONTOUR_SEGMENT_LIMIT * 4) throw Error('分面后的轮廓边数超过上限');
        const d = sub(points[to], points[from]),
          i = halfEdges.length;
        halfEdges.push(
          { from, to, reverse: i + 1, entityId: segment.entityId, angle: Math.atan2(d.y, d.x) },
          {
            from: to,
            to: from,
            reverse: i,
            entityId: segment.entityId,
            angle: Math.atan2(-d.y, -d.x),
          },
        );
        outgoing[from].push(i);
        outgoing[to].push(i + 1);
      }
      from = to;
    }
  }
  for (const list of outgoing) list.sort((a, b) => halfEdges[a].angle - halfEdges[b].angle);
  return { points, outgoing, halfEdges };
}

function exteriorLoops({ points, outgoing, halfEdges }: ReturnType<typeof contourGraph>) {
  const loops: { edges: ContourEdge[]; area: number; pinched: boolean }[] = [];
  const visited = new Uint8Array(halfEdges.length);
  for (let start = 0; start < halfEdges.length; start++) {
    if (visited[start]) continue;
    const walk = new Set<number>();
    let cursor = start;
    while (!visited[cursor]) {
      visited[cursor] = 1;
      walk.add(cursor);
      const { to, reverse } = halfEdges[cursor],
        ring = outgoing[to];
      cursor = ring[(ring.indexOf(reverse) + ring.length - 1) % ring.length];
    }
    if (cursor !== start) continue;
    const outer = [...walk].map((i) => halfEdges[i]).filter(({ reverse }) => !walk.has(reverse));
    if (outer.length < 3) continue;
    const origin = points[outer[0].from];
    const area =
      outer.reduce(
        (sum, { from, to }) => sum + cross(sub(points[from], origin), sub(points[to], origin)),
        0,
      ) / 2;
    if (area < -epsilon)
      loops.push({
        edges: outer.map(({ from, to, entityId }) => ({
          from: points[from],
          to: points[to],
          entityId,
        })),
        area: -area,
        pinched:
          new Set(outer.map(({ from }) => from)).size !== outer.length ||
          outer.some(({ to }, i) => to !== outer[(i + 1) % outer.length].from),
      });
  }
  return loops;
}

export function extractDrawingContours(paths: readonly ContourPath[], tolerance: number) {
  const segments: Segment[] = [];
  for (const { entity, points } of paths) {
    for (let i = 1; i < points.length; i++) {
      const from = points[i - 1],
        to = points[i];
      if (distance(from, to) <= CONTOUR_JOIN_MM) continue;
      if (segments.length >= CONTOUR_SEGMENT_LIMIT) throw Error('轮廓采样边数超过审核上限');
      segments.push({
        from,
        to,
        entityId: entity.id,
        cuts: [0, 1],
        minX: Math.min(from.x, to.x),
        maxX: Math.max(from.x, to.x),
        minY: Math.min(from.y, to.y),
        maxY: Math.max(from.y, to.y),
      });
    }
  }
  const problems = splitAtIntersections(segments);
  const graph = contourGraph(segments);
  const ends = graph.outgoing.flatMap((list, index) =>
    list.length === 1
      ? [{ position: graph.points[index], entityId: graph.halfEdges[list[0]].entityId }]
      : [],
  );
  if (ends.length) {
    let gap = Infinity;
    for (const end of ends.slice(0, 128))
      for (const other of ends)
        if (end !== other) gap = Math.min(gap, distance(end.position, other.position));
    problems.push({
      entityIds: [...new Set(ends.map(({ entityId }) => entityId))],
      points: ends.slice(0, 24).map(({ position }) => position),
      detail:
        gap <= tolerance
          ? `发现 ${ends.length} 个悬空端点，最小断口 ${gap.toFixed(4)} mm`
          : `发现 ${ends.length} 个悬空端点，请将轮廓端点闭合`,
    });
  }
  const loops = exteriorLoops(graph);
  const contours: DrawingContour[] = [];
  for (const loop of loops) {
    if (loop.pinched) {
      problems.push({
        entityIds: [...new Set(loop.edges.map(({ entityId }) => entityId))],
        points: [loop.edges[0].from],
        detail: '轮廓在节点处自接触，内外区域不唯一',
      });
      continue;
    }
    const nesting = loops.filter(
      (other) => other.area > loop.area && containsContourPoint(other.edges, loop.edges[0].from),
    ).length;
    const hole = nesting % 2 === 1;
    contours.push({
      area: loop.area,
      hole,
      edges: hole
        ? loop.edges
        : [...loop.edges]
            .reverse()
            .map(({ from, to, entityId }) => ({ from: to, to: from, entityId })),
    });
  }
  return { contours, problems };
}
