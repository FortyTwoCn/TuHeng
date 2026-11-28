import type { Vec2 } from '@tuheng/contracts';
import type { ProjectionDirection } from './projection-coordinates';
import {
  add3,
  axes3,
  cross3,
  dot3,
  norm3,
  scale3,
  sub3,
  unit3,
  type AxisIndex,
  type SolidPoint,
} from './spatial-math';

export const CELL_EPSILON = 1e-8;
export const viewAxes3 = { V: [0, 2, 1], H: [0, 1, 2], W: [1, 2, 0] } as const;
export type PlaneSource = {
  entityId: string;
  viewId: string;
  direction: ProjectionDirection;
  from: Vec2;
  to: Vec2;
  curved: boolean;
};
export type CutPlane = {
  id: number;
  normal: SolidPoint;
  offset: number;
  axis?: AxisIndex;
  sources: PlaneSource[];
};
export type HalfSpace = { plane: CutPlane; side: 1 | -1 };
export type Facet = HalfSpace & { points: SolidPoint[] };
export type ConvexCell = { facets: Facet[]; sample: SolidPoint };
export type Cell = ConvexCell & { id: number; box: SolidPoint };

export const project2 = (point: SolidPoint, direction: ProjectionDirection): Vec2 => {
  const [u, v] = viewAxes3[direction];
  return { x: point[u], y: point[v] };
};

export function centroid(points: readonly SolidPoint[]) {
  const center: SolidPoint = [0, 0, 0];
  for (const point of points) for (const axis of axes3) center[axis] += point[axis] / points.length;
  return center;
}

export const signedDistance = (p: SolidPoint, { plane, side }: HalfSpace) =>
  (dot3(p, plane.normal) - plane.offset) * side;

export function planeRegistry() {
  const planes = new Map<string, CutPlane>();
  return (normal: SolidPoint, offset: number, sources: PlaneSource[] = []) => {
    if (normal.find((value) => Math.abs(value) > CELL_EPSILON)! < 0) {
      normal = scale3(normal, -1);
      offset = -offset;
    }
    const key = [...normal, offset].map((value) => Math.round(value * 1e8)).join(',');
    let plane = planes.get(key);
    if (!plane) {
      const axis = axes3.find(
        (i) =>
          Math.abs(normal[i] - 1) <= CELL_EPSILON &&
          axes3.every((j) => j === i || Math.abs(normal[j]) <= CELL_EPSILON),
      );
      plane = { id: planes.size, normal, offset, axis, sources: [] };
      planes.set(key, plane);
    }
    plane.sources.push(...sources);
    return plane;
  };
}

function splitPolygon(points: SolidPoint[], plane: HalfSpace) {
  const inside: SolidPoint[] = [],
    outside: SolidPoint[] = [],
    section: SolidPoint[] = [];
  for (const [i, a] of points.entries()) {
    const b = points[(i + 1) % points.length];
    const da = signedDistance(a, plane),
      db = signedDistance(b, plane);
    if (da <= CELL_EPSILON) inside.push(a);
    if (da >= -CELL_EPSILON) outside.push(a);
    if (Math.abs(da) <= CELL_EPSILON) section.push(a);
    if ((da < -CELL_EPSILON && db > CELL_EPSILON) || (da > CELL_EPSILON && db < -CELL_EPSILON)) {
      const crossing = add3(a, scale3(sub3(b, a), da / (da - db)));
      inside.push(crossing);
      outside.push(crossing);
      section.push(crossing);
    }
  }
  return { inside, outside, section };
}

export function facetArea(points: SolidPoint[]) {
  if (points.length < 3) return 0;
  const [origin] = points;
  return points
    .slice(2)
    .reduce(
      (sum, p, i) => sum + norm3(cross3(sub3(points[i + 1], origin), sub3(p, origin))) * 0.5,
      0,
    );
}

function aroundPlane(points: SolidPoint[], normal: SolidPoint) {
  const center = centroid(points);
  const u = unit3(sub3(points[0], center)),
    v = cross3(normal, u);
  const bearing = (point: SolidPoint) => {
    const d = sub3(point, center);
    return Math.atan2(dot3(d, v), dot3(d, u));
  };
  return points.sort((a, b) => bearing(a) - bearing(b));
}

function makeCell(facets: Facet[]): ConvexCell {
  return { facets, sample: centroid(facets.flatMap(({ points }) => points)) };
}

export function boxCell(faces: [CutPlane, CutPlane][]) {
  const facets: Facet[] = [];
  for (const axis of axes3) {
    const u = (axis + 1) % 3,
      v = (axis + 2) % 3;
    for (const side of [-1, 1] as const) {
      const plane = faces[axis][side < 0 ? 0 : 1];
      const points = (
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ] as const
      ).map(([a, b]) => {
        const point: SolidPoint = [0, 0, 0];
        point[axis] = plane.offset;
        point[u] = faces[u][a].offset;
        point[v] = faces[v][b].offset;
        return point;
      });
      facets.push({ plane, side, points: side < 0 ? points.reverse() : points });
    }
  }
  return makeCell(facets);
}

export function cutCell(cell: ConvexCell, plane: CutPlane) {
  const cut: HalfSpace = { plane, side: 1 };
  let positive = false,
    negative = false;
  for (const { points } of cell.facets)
    for (const p of points) {
      const value = signedDistance(p, cut);
      if (value > CELL_EPSILON) positive = true;
      if (value < -CELL_EPSILON) negative = true;
    }
  if (!positive || !negative) return [cell];
  const inside: Facet[] = [],
    outside: Facet[] = [],
    section: SolidPoint[] = [];
  for (const face of cell.facets) {
    const split = splitPolygon(face.points, cut);
    if (facetArea(split.inside) > CELL_EPSILON ** 2) inside.push({ ...face, points: split.inside });
    if (facetArea(split.outside) > CELL_EPSILON ** 2)
      outside.push({ ...face, points: split.outside });
    for (const p of split.section)
      if (!section.some((q) => norm3(sub3(p, q)) <= CELL_EPSILON)) section.push(p);
  }
  if (section.length < 3) return [cell];
  const points = aroundPlane(section, plane.normal);
  inside.push({ ...cut, points });
  outside.push({ plane, side: -1, points: [...points].reverse() });
  return [makeCell(inside), makeCell(outside)];
}

/** Return the convex pieces of a facet left after an adjoining cell is removed. */
export function subtractCell(points: SolidPoint[], cell: Cell, shared: CutPlane) {
  let inside = points;
  const outside: SolidPoint[][] = [];
  for (const facet of cell.facets) {
    if (facet.plane.id === shared.id) continue;
    const distances = inside.map((point) => signedDistance(point, facet));
    if (distances.every((d) => d <= CELL_EPSILON)) continue;
    if (distances.every((d) => d >= -CELL_EPSILON)) return [points];
    const split = splitPolygon(inside, facet);
    inside = split.inside;
    outside.push(split.outside);
  }
  return outside;
}

export function sharedFacetArea(facet: Facet, cell: Cell) {
  let inside = facet.points;
  for (const cut of cell.facets) {
    if (cut.plane.id === facet.plane.id) continue;
    inside = splitPolygon(inside, cut).inside;
    if (inside.length < 3) return 0;
  }
  return facetArea(inside);
}

export type CellInterval = {
  cell: Cell;
  near: number;
  far: number;
  entry: CutPlane;
  exit: CutPlane;
};
export function intersectCellRay(
  cell: Cell,
  point: Vec2,
  direction: ProjectionDirection,
): CellInterval | undefined {
  const [u, v, depth] = viewAxes3[direction];
  let near = Infinity,
    far = -Infinity;
  let entry: CutPlane | undefined, exit: CutPlane | undefined;
  for (const { plane, side } of cell.facets) {
    const factor = plane.normal[depth] * side;
    const distance = (plane.offset - plane.normal[u] * point.x - plane.normal[v] * point.y) * side;
    if (Math.abs(factor) <= CELL_EPSILON) {
      if (distance < -CELL_EPSILON) return;
    } else if (factor > 0) {
      if (distance / factor < near) {
        near = distance / factor;
        entry = plane;
      }
    } else if (distance / factor > far) {
      far = distance / factor;
      exit = plane;
    }
    if (near - far <= CELL_EPSILON) return;
  }
  if (entry && exit) return { cell, near, far, entry, exit };
}
