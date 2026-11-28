import { simpleHatchPolygon } from '@tuheng/contracts';
import { cross3, dot3, norm3, scale3, sub3, unit3, add3, type SolidPoint } from './spatial-math';
import type { ProjectionSource, SpatialRole } from './spatial-projections';

export type SpatialSegment = {
  ends: [string, string];
  points: [SolidPoint, SolidPoint];
  role: SpatialRole;
  sources: ProjectionSource[];
};

export type SpatialFace = {
  points: SolidPoint[];
  normal: SolidPoint;
  role: 'PROBLEM' | 'ANSWER';
  sources: ProjectionSource[];
  kind: 'POLYGON' | 'SPANNED';
};

export type SpatialRightAngle = { points: SolidPoint[]; sources: ProjectionSource[] };

type Incident = { to: string; segment: SpatialSegment; direction: SolidPoint };
type Graph = Map<string, Incident[]>;

function graphOf(segments: SpatialSegment[], role: SpatialFace['role']) {
  const graph: Graph = new Map();
  for (const segment of segments) {
    if (segment.role !== role) continue;
    const [a, b] = segment.ends;
    const direction = sub3(segment.points[1], segment.points[0]);
    for (const [from, to, vector] of [
      [a, b, direction],
      [b, a, scale3(direction, -1)],
    ] as const) {
      const list = graph.get(from) ?? [];
      list.push({ to, segment, direction: vector });
      graph.set(from, list);
    }
  }
  return graph;
}

function polygonNormal(points: SolidPoint[], tolerance: number) {
  const origin = points[0];
  let sum: SolidPoint = [0, 0, 0];
  for (const [i, p] of points.entries())
    sum = add3(sum, cross3(sub3(p, origin), sub3(points[(i + 1) % points.length], origin)));
  if (norm3(sum) <= tolerance ** 2) return;
  const normal = unit3(sum);
  if (points.some((point) => Math.abs(dot3(sub3(point, origin), normal)) > tolerance)) return;
  const u = unit3(sub3(points[1], origin)),
    v = cross3(normal, u);
  if (
    simpleHatchPolygon(
      points.map((p) => {
        const delta = sub3(p, origin);
        return { x: dot3(delta, u), y: dot3(delta, v) };
      }),
    )
  )
    return normal;
}

function polygons(
  graph: Graph,
  positions: ReadonlyMap<string, SolidPoint>,
  role: SpatialFace['role'],
  tolerance: number,
) {
  const faces: SpatialFace[] = [];
  const used = new Set<SpatialSegment>();
  const neighbors = new Map(
    [...graph].map(([id, adjacent]) => [id, new Set(adjacent.map(({ to }) => to))]),
  );
  let budget = 18000;
  for (const start of graph.keys()) {
    const nodes = [start],
      edges: SpatialSegment[] = [];
    function walk(at: string) {
      if (--budget <= 0 || nodes.length > 96) return;
      if (nodes.length > 2 && neighbors.get(start)!.has(at)) {
        if (nodes[1] > at) return;
        const points = nodes.map((id) => positions.get(id)!);
        const normal = polygonNormal(points, tolerance);
        if (!normal) return;
        const closing = graph.get(at)!.find(({ to }) => to === start)!;
        const ring = [...edges, closing.segment];
        ring.forEach((edge) => used.add(edge));
        faces.push({
          points,
          normal,
          role,
          kind: 'POLYGON',
          sources: ring.flatMap(({ sources }) => sources),
        });
        return;
      }
      for (const { to, segment } of graph.get(at) ?? []) {
        if (
          to <= start ||
          nodes.includes(to) ||
          nodes.slice(1, -1).some((node) => neighbors.get(node)!.has(to))
        )
          continue;
        nodes.push(to);
        edges.push(segment);
        walk(to);
        nodes.pop();
        edges.pop();
      }
    }
    walk(start);
    if (budget <= 0) break;
  }
  return { faces, used, limited: budget <= 0 };
}

function spannedFace(origin: SolidPoint, a: Incident, b: Incident): SpatialFace {
  const span = Math.min(norm3(a.direction), norm3(b.direction));
  const u = scale3(a.direction, 1 / norm3(a.direction));
  const along = dot3(b.direction, u);
  const height = sub3(b.direction, scale3(u, along));
  const v = unit3(height);
  const margin = span * 0.19;
  const left = Math.min(0, along) - margin;
  const right = Math.max(norm3(a.direction), along) + margin;
  const point = (x: number, y: number) => add3(origin, add3(scale3(u, x), scale3(v, y)));
  return {
    kind: 'SPANNED',
    points: [
      point(left, -margin),
      point(right, -margin),
      point(right, norm3(height) + margin),
      point(left, norm3(height) + margin),
    ],
    normal: cross3(u, v),
    role: 'ANSWER',
    sources: [...a.segment.sources, ...b.segment.sources],
  };
}

export function reconstructSpatialFaces(
  segments: SpatialSegment[],
  positions: ReadonlyMap<string, SolidPoint>,
  tolerance: number,
) {
  const problem = polygons(graphOf(segments, 'PROBLEM'), positions, 'PROBLEM', tolerance);
  const answerGraph = graphOf(segments, 'ANSWER');
  const answer = polygons(answerGraph, positions, 'ANSWER', tolerance);
  const markers: SpatialRightAngle[] = [];
  const generated: SpatialFace[] = [];
  const marked = new Set<SpatialSegment>();
  for (const [id, incident] of answerGraph) {
    const origin = positions.get(id)!;
    const candidates = incident.filter(({ segment }) => !answer.used.has(segment));
    for (const [i, a] of candidates.entries())
      for (const b of candidates.slice(i + 1)) {
        const u = unit3(a.direction),
          v = unit3(b.direction);
        if (norm3(cross3(u, v)) <= 1e-4) continue;
        const face = spannedFace(origin, a, b);
        if (
          generated.some(
            (other) =>
              Math.abs(dot3(other.normal, face.normal)) > 1 - 1e-8 &&
              Math.abs(dot3(sub3(origin, other.points[0]), other.normal)) <= tolerance,
          )
        )
          continue;
        generated.push(face);
        for (const arm of [a, b]) {
          if (marked.has(arm.segment)) continue;
          const foot = positions.get(arm.to)!;
          const normal = unit3(arm.direction);
          const surface = problem.faces.find(
            (polygon) =>
              norm3(cross3(normal, polygon.normal)) <= 1e-4 &&
              Math.abs(dot3(sub3(foot, polygon.points[0]), polygon.normal)) <= tolerance,
          );
          if (!surface) continue;
          marked.add(arm.segment);
          const size =
            Math.min(norm3(arm.direction), norm3(sub3(surface.points[1], surface.points[0]))) *
            0.13;
          const side = scale3(unit3(sub3(surface.points[0], surface.points[1])), size);
          const rise = scale3(normal, -size);
          markers.push({
            points: [add3(foot, side), add3(foot, add3(side, rise)), add3(foot, rise)],
            sources: arm.segment.sources,
          });
        }
        if (generated.length >= 64)
          return {
            faces: [...problem.faces, ...answer.faces, ...generated],
            markers,
            limited: true,
          };
      }
  }
  return {
    faces: [...problem.faces, ...answer.faces, ...generated],
    markers,
    limited: problem.limited || answer.limited,
  };
}
