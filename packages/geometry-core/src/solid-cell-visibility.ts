import type { Vec2 } from '@tuheng/contracts';
import { CONTOUR_JOIN_MM, subdividePlanarEdges, type ContourEdge } from './drawing-contours';
import type { ProjectionDirection } from './projection-coordinates';
import {
  CELL_EPSILON,
  project2,
  viewAxes3,
  type CellInterval,
  type CutPlane,
} from './solid-cell-geometry';
import type { SolidPartition } from './solid-cell-partition';
import { CellConstraints, FALSE } from './solid-cell-solver';
import { constrainCellTopology } from './solid-cell-topology';
import { dot3 } from './spatial-math';

type Ray = { intervals: CellInterval[]; covered: number; front: Event[] };
type Event = { plane?: CutPlane; literal: number };
const virtual = '\0';

function projectedEdges(partition: SolidPartition, direction: ProjectionDirection) {
  const seen = new Set<string>();
  const supports = new Map<string, { from: Vec2; to: Vec2 }[]>();
  const key = (p: Vec2) => [p.x, p.y].map((n) => Math.round(n / (CONTOUR_JOIN_MM / 4))).join(',');
  for (const { facets } of partition.cells)
    for (const { points } of facets) {
      const projected = points.map((p) => project2(p, direction));
      for (const [i, from] of projected.entries()) {
        const to = projected[(i + 1) % projected.length];
        const a = key(from),
          b = key(to);
        if (a === b) continue;
        const segment = a < b ? a + ':' + b : b + ':' + a;
        if (seen.has(segment)) continue;
        seen.add(segment);
        const dx = to.x - from.x,
          dy = to.y - from.y;
        const length = Math.hypot(dx, dy);
        if (length <= CONTOUR_JOIN_MM) continue;
        const sign = dx < -CELL_EPSILON || (Math.abs(dx) <= CELL_EPSILON && dy < 0) ? -1 : 1;
        const u = (sign * dx) / length,
          v = (sign * dy) / length;
        const k = [u, v, u * from.y - v * from.x].map((n) => Math.round(n * 1e7)).join(',');
        const pieces = supports.get(k) ?? [];
        pieces.push({ from, to });
        supports.set(k, pieces);
      }
    }
  return [...supports.values()].flatMap((pieces) => {
    if (pieces.length === 1) return [{ ...pieces[0], entityId: virtual }];
    const [{ from, to }] = pieces;
    const axis = Math.abs(from.x - to.x) >= Math.abs(from.y - to.y) ? 'x' : 'y';
    const endpoints = pieces
      .flatMap(({ from, to }) =>
        from[axis] < to[axis]
          ? [
              { p: from, delta: 1 },
              { p: to, delta: -1 },
            ]
          : [
              { p: to, delta: 1 },
              { p: from, delta: -1 },
            ],
      )
      .sort((a, b) => a.p[axis] - b.p[axis]);
    const edges: ContourEdge[] = [];
    let previous = endpoints[0].p,
      count = 0;
    for (const { p, delta } of endpoints) {
      if (p[axis] - previous[axis] > CONTOUR_JOIN_MM) {
        if (count > 0) edges.push({ from: previous, to: p, entityId: virtual });
        previous = p;
      }
      count += delta;
    }
    return edges;
  });
}

function rayAt(formula: CellConstraints, intervals: CellInterval[], variable: number[]): Ray {
  const front: Event[] = [];
  let covered = FALSE;
  for (const { cell, entry } of intervals) {
    const lit = variable[cell.id];
    front.push({ plane: entry, literal: formula.and(lit, -covered) });
    covered = formula.or([covered, lit]);
  }
  front.push({ literal: -covered });
  return { intervals, covered, front };
}

function transitions(
  formula: CellConstraints,
  ray: Ray,
  entry: boolean,
  variable: number[],
): Event[] {
  return ray.intervals.map((interval, i) => {
    const neighbor = ray.intervals[i + (entry ? -1 : 1)];
    const gap =
      !neighbor ||
      (entry ? neighbor.far - interval.near : interval.far - neighbor.near) > CELL_EPSILON * 10;
    return {
      plane: entry ? interval.entry : interval.exit,
      literal: formula.and(variable[interval.cell.id], gap ? -FALSE : -variable[neighbor.cell.id]),
    };
  });
}

function equivalentPlane(direction: ProjectionDirection, point: Vec2) {
  const [u, v, depth] = viewAxes3[direction];
  const at = ({ normal, offset }: CutPlane) =>
    (offset - normal[u] * point.x - normal[v] * point.y) / normal[depth];
  return (a?: CutPlane, b?: CutPlane) => {
    if (a === b) return true;
    if (!a || !b) return false;
    return (
      (a.sources.some(({ curved }) => curved) || b.sources.some(({ curved }) => curved)) &&
      Math.abs(dot3(a.normal, b.normal)) >= 0.98 &&
      Math.abs(at(a) - at(b)) <= CONTOUR_JOIN_MM * 4
    );
  };
}

function compareFronts(
  formula: CellConstraints,
  first: Ray,
  second: Ray,
  same: ReturnType<typeof equivalentPlane>,
  visible: boolean,
) {
  for (const [a, b] of [
    [first, second],
    [second, first],
  ]) {
    for (const { plane, literal } of a.front) {
      const matches = b.front
        .filter((event) => same(plane, event.plane))
        .map((event) => event.literal);
      if (visible) for (const other of matches) formula.require(-literal, -other);
      else formula.require(-literal, ...matches);
    }
    if (visible) break;
  }
}

function requireHiddenEdge(
  formula: CellConstraints,
  a: Ray,
  b: Ray,
  same: ReturnType<typeof equivalentPlane>,
  variable: number[],
) {
  // The nearest visible support stays continuous. A later material entry or exit must change.
  formula.require(a.covered);
  const changes: number[] = [];
  for (const entry of [true, false]) {
    const first = transitions(formula, a, entry, variable),
      second = transitions(formula, b, entry, variable);
    for (const [own, other] of [
      [first, second],
      [second, first],
    ])
      for (const { plane, literal } of own) {
        const opposing = other
          .filter((event) => same(plane, event.plane))
          .map((event) => -event.literal);
        changes.push(formula.and(literal, ...opposing));
      }
  }
  formula.require(...changes);
}

export function solveCellVisibility(partition: SolidPartition) {
  const formula = new CellConstraints(partition.groups);
  const measured = new Set<string>();
  let samples = 0;
  for (const plan of partition.plans) {
    const direction = plan.direction;
    // Also test undrawn edges of the candidate arrangement: the nearest surface must be
    // continuous there. Otherwise a solution could satisfy the ink while drawing extra lines.
    const overlay = subdividePlanarEdges([...plan.edges, ...projectedEdges(partition, direction)]);
    for (const { from, to, entityIds } of overlay.edges) {
      const dx = to.x - from.x,
        dy = to.y - from.y,
        length = Math.hypot(dx, dy);
      const center = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
      const samplingWidth = Math.min(length * 0.02, CONTOUR_JOIN_MM * 0.2);
      const raySides = [-1, 1].map((sign) => ({
        x: center.x - sign * (dy / length) * samplingWidth,
        y: center.y + sign * (dx / length) * samplingWidth,
      }));
      const role = entityIds.some((id) => plan.ink.get(id) === 'VISIBLE')
        ? 'VISIBLE'
        : entityIds.some((id) => plan.ink.get(id) === 'HIDDEN')
          ? 'HIDDEN'
          : undefined;
      if (role) for (const id of entityIds) if (id !== virtual) measured.add(id);
      const [a, b] = raySides.map((p) => {
        const result = rayAt(formula, partition.ray(p, direction), partition.variable);
        if (partition.requiresMaterial(plan, p)) formula.require(result.covered);
        return result;
      });
      const same = equivalentPlane(direction, center);
      compareFronts(formula, a, b, same, role === 'VISIBLE');
      if (role === 'HIDDEN') requireHiddenEdge(formula, a, b, same, partition.variable);
      samples++;
    }
  }
  constrainCellTopology(partition, formula);
  const result = formula.solve();
  const stats = { measured: measured.size, samples };
  return result.status === 'SOLVED'
    ? {
        ...stats,
        status: result.status,
        cells: Int8Array.from(partition.variable, (id) => result.cells[id - 2]),
      }
    : { ...stats, status: result.status };
}
