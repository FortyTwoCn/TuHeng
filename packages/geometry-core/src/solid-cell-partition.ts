import type { Vec2 } from '@tuheng/contracts';
import type { AuditedDrawingView, ProjectionDirection } from './drawing-audit';
import {
  containsContourPoint,
  pathEdges,
  planarFaceAt,
  subdividePlanarEdges,
  type ContourEdge,
  type ContourPath,
} from './drawing-contours';
import {
  boxCell,
  CELL_EPSILON,
  cutCell,
  intersectCellRay,
  planeRegistry,
  project2,
  sharedFacetArea,
  viewAxes3,
  type Cell,
  type CutPlane,
  type PlaneSource,
} from './solid-cell-geometry';
import { axes3, bounds3, unit3, type SolidPoint } from './spatial-math';

const boxLimit = 16000;
const cellLimit = 11000;
const cutLimit = 800;
export const CELL_COMPUTATION_LIMIT = '投影细分已达到空间单元计算上限，请简化边界或分解组合体。';
type Interval = [number, number];
type Plan = ReturnType<typeof makePlan>;

function makePlan(view: AuditedDrawingView) {
  const direction = view.direction!;
  const paths = [...view.boundary, ...view.hidden];
  const edges = pathEdges(paths);
  const subdivision = subdividePlanarEdges(edges);
  const outer = view.contours.filter(({ hole }) => !hole).map(({ edges }) => edges);
  const byId = new Map(paths.map((path) => [path.entity.id, path]));
  return {
    direction,
    view,
    edges,
    subdivision,
    ink: new Map(
      paths.map(({ entity }) => [
        entity.id,
        view.hidden.some((path) => path.entity.id === entity.id)
          ? ('HIDDEN' as const)
          : ('VISIBLE' as const),
      ]),
    ),
    source: (id: string) => byId.get(id),
    inEnvelope: (point: Vec2) => outer.some((edges) => containsContourPoint(edges, point)),
  };
}

type Bore = { direction: ProjectionDirection; boundary: ContourEdge[]; depth: Interval };

function tangentSpans(
  plan: Plan,
  axis: number,
  depthAxis: number,
  position: number,
  tolerance: number,
) {
  const [u] = viewAxes3[plan.direction];
  const constant = axis === u ? 'x' : 'y',
    varying = depthAxis === u ? 'x' : 'y';
  const ranges: Interval[] = [];
  for (const { from, to, entityId } of plan.edges) {
    if (
      plan.ink.get(entityId) !== 'HIDDEN' ||
      Math.abs(from[constant] - position) > tolerance ||
      Math.abs(to[constant] - position) > tolerance
    )
      continue;
    ranges.push([Math.min(from[varying], to[varying]), Math.max(from[varying], to[varying])]);
  }
  const merged: Interval[] = [];
  for (const [lo, hi] of ranges.sort(([a], [b]) => a - b)) {
    const last = merged.at(-1);
    if (last && lo <= last[1] + tolerance) last[1] = Math.max(last[1], hi);
    else merged.push([lo, hi]);
  }
  return merged;
}

function cylindricalCuts(plans: Plan[], tolerance: number): Bore[] {
  const bores: Bore[] = [];
  for (const plan of plans) {
    const { direction, view } = plan;
    const [u, v, depth] = viewAxes3[direction];
    for (const path of view.boundary) {
      if (path.entity.kind !== 'circle' && path.entity.kind !== 'ellipse') continue;
      // Tangencies have meaning for an interior loop, not the outer wall of a cylinder.
      if (
        view.contours.some(
          (contour) =>
            !contour.hole && contour.edges.some(({ entityId }) => entityId === path.entity.id),
        )
      )
        continue;
      const bounds = bounds3(path.points.map(({ x, y }) => [x, y, 0]));
      const spans: Interval[][] = [];
      for (const other of plans) {
        if (other === plan) continue;
        const [first, second] = viewAxes3[other.direction];
        const axis = first === depth ? second : first;
        const component = axis === u ? 0 : axis === v ? 1 : undefined;
        if (component === undefined) continue;
        const left = tangentSpans(other, axis, depth, bounds.min[component], tolerance);
        const right = tangentSpans(other, axis, depth, bounds.max[component], tolerance);
        const corresponding = left.flatMap(([lo, hi]): Interval[] =>
          right.flatMap(([a, b]): Interval[] =>
            Math.abs(lo - a) <= tolerance &&
            Math.abs(hi - b) <= tolerance &&
            Math.min(hi, b) - Math.max(lo, a) > tolerance
              ? [[Math.max(lo, a), Math.min(hi, b)]]
              : [],
          ),
        );
        if (corresponding.length) spans.push(corresponding);
      }
      if (!spans.length) continue;
      const boundary = pathEdges([path]);
      for (const [lo, hi] of spans[0]) {
        if (
          spans
            .slice(1)
            .every((other) =>
              other.some(
                ([a, b]) => Math.abs(a - lo) <= tolerance && Math.abs(b - hi) <= tolerance,
              ),
            )
        )
          bores.push({ boundary, depth: [lo, hi], direction });
      }
    }
  }
  return bores;
}

function clipBounds(plans: Plan[]) {
  const min: SolidPoint = [-Infinity, -Infinity, -Infinity],
    max: SolidPoint = [Infinity, Infinity, Infinity];
  for (const { direction, view } of plans) {
    const axes = viewAxes3[direction];
    for (const [i, key] of (['x', 'y'] as const).entries()) {
      const axis = axes[i];
      min[axis] = Math.max(min[axis], view.bounds!.min[key]);
      max[axis] = Math.min(max[axis], view.bounds!.max[key]);
    }
  }
  return { min, max };
}

const uniqueSorted = (values: number[]) =>
  values.sort((a, b) => a - b).filter((value, i, all) => !i || value - all[i - 1] > CELL_EPSILON);

function sourceIsCurved(path?: ContourPath) {
  return path && ['arc', 'circle', 'ellipse', 'curve'].includes(path.entity.kind);
}

function partitionPlanes(plans: Plan[]) {
  const registry = planeRegistry();
  const { min, max } = clipBounds(plans);
  const knots = axes3.map((axis) => [min[axis], max[axis]]);
  const sloping: { plane: CutPlane; u: number; v: number; uSpan: Interval; vSpan: Interval }[] = [];
  for (const plan of plans) {
    const [u, v] = viewAxes3[plan.direction];
    for (const { from, to, entityIds } of plan.subdivision.edges) {
      const du = to.x - from.x,
        dv = to.y - from.y;
      const normal: SolidPoint = [0, 0, 0],
        point: SolidPoint = [0, 0, 0];
      normal[u] = Math.abs(dv) > CELL_EPSILON ? -dv : 0;
      normal[v] = Math.abs(du) > CELL_EPSILON ? du : 0;
      point[u] = from.x;
      point[v] = from.y;
      const n = unit3(normal);
      const sources = entityIds.map((entityId): PlaneSource => ({
        from,
        to,
        entityId,
        direction: plan.direction,
        viewId: plan.view.view.id,
        curved: !!sourceIsCurved(plan.source(entityId)),
      }));
      const plane = registry(n, n[u] * point[u] + n[v] * point[v], sources);
      knots[u].push(from.x, to.x);
      if (plane.axis !== undefined) {
        knots[v].push(from.y, to.y);
      } else {
        sloping.push({
          plane,
          u,
          v,
          uSpan: [Math.min(from.x, to.x), Math.max(from.x, to.x)],
          vSpan: [Math.min(from.y, to.y), Math.max(from.y, to.y)],
        });
      }
    }
  }
  if (sloping.length > cutLimit) throw Error(CELL_COMPUTATION_LIMIT);
  const grid = knots.map((values, axis) =>
    uniqueSorted(values.filter((v) => v >= min[axis] && v <= max[axis])),
  );
  const gridPlanes = grid.map((values, axis) =>
    values.map((offset) => {
      const normal: SolidPoint = [0, 0, 0];
      normal[axis] = 1;
      return registry(normal, offset);
    }),
  );
  return { grid, gridPlanes, sloping };
}

function slabIndex(knots: number[], coordinate: number) {
  if (coordinate <= knots[0] || coordinate >= knots.at(-1)!) return -1;
  let lo = 0,
    hi = knots.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >>> 1;
    if (knots[mid] > coordinate) hi = mid;
    else lo = mid;
  }
  return lo;
}

export function partitionSolid(views: AuditedDrawingView[], tolerance: number) {
  const plans = views.map(makePlan);
  const bores = cylindricalCuts(plans, tolerance);
  const { grid, gridPlanes, sloping } = partitionPlanes(plans);
  const size = grid.map((values) => values.length - 1);
  if (size.some((n) => n < 1)) throw Error('投影正交交集为空或退化为零体积。');
  if (size.reduce((a, b) => a * b, 1) > boxLimit) throw Error(CELL_COMPUTATION_LIMIT);
  const boxes: (Cell[] | undefined)[] = [];
  const cells: Cell[] = [];
  const index = ([x, y, z]: SolidPoint) => (x * size[1] + y) * size[2] + z;
  const at = (box: SolidPoint) =>
    box.some((n, i) => n < 0 || n >= size[i]) ? [] : (boxes[index(box)] ?? []);
  const inBore = (sample: SolidPoint, bore: Bore) => {
    const depth = sample[viewAxes3[bore.direction][2]];
    return (
      depth > bore.depth[0] &&
      depth < bore.depth[1] &&
      containsContourPoint(bore.boundary, project2(sample, bore.direction))
    );
  };
  const cutsBySlab = grid.map((values, axis) =>
    values
      .slice(1)
      .map((hi, i) =>
        sloping.filter(
          ({ u, uSpan }) =>
            u === axis && uSpan[0] < hi - CELL_EPSILON && uSpan[1] > values[i] + CELL_EPSILON,
        ),
      ),
  );
  for (let x = 0; x < size[0]; x++)
    for (let y = 0; y < size[1]; y++)
      for (let z = 0; z < size[2]; z++) {
        const box: SolidPoint = [x, y, z];
        const faces = gridPlanes.map((planes, i): [CutPlane, CutPlane] => [
          planes[box[i]],
          planes[box[i] + 1],
        ]);
        let pieces = [boxCell(faces)];
        const relevant = new Set(
          axes3.flatMap((axis) =>
            cutsBySlab[axis][box[axis]].flatMap(({ plane, v, vSpan }) =>
              vSpan[0] < grid[v][box[v] + 1] - CELL_EPSILON &&
              vSpan[1] > grid[v][box[v]] + CELL_EPSILON
                ? [plane]
                : [],
            ),
          ),
        );
        for (const plane of relevant) {
          pieces = pieces.flatMap((cell) => cutCell(cell, plane));
          if (pieces.length > 96) throw Error(CELL_COMPUTATION_LIMIT);
        }
        const retained = pieces.flatMap(({ sample, facets }): Cell[] => {
          if (
            plans.some((plan) => {
              const p = project2(sample, plan.direction);
              return !plan.inEnvelope(p) || planarFaceAt(plan.subdivision.faces, p) < 0;
            }) ||
            bores.some((bore) => inBore(sample, bore))
          )
            return [];
          if (cells.length >= cellLimit) throw Error(CELL_COMPUTATION_LIMIT);
          const result = { id: cells.length, facets, sample, box };
          cells.push(result);
          return [result];
        });
        if (retained.length) boxes[index(box)] = retained;
      }
  if (!cells.length) throw Error('投影正交交集为空或退化为零体积。');
  // Joins across support planes introduced solely for numerical subdivision have one
  // occupancy state: drawn feature planes are the possible material interfaces.
  const parents = cells.map(({ id }) => id);
  const root = (id: number) => {
    let node = id;
    while (parents[node] !== node) {
      parents[node] = parents[parents[node]];
      node = parents[node];
    }
    return node;
  };
  for (const cell of cells)
    for (const facet of cell.facets) {
      const { axis, sources } = facet.plane;
      if (axis === undefined || facet.side < 0 || sources.length) continue;
      const box = [...cell.box] as SolidPoint;
      box[axis]++;
      for (const adjacent of at(box)) {
        const other = root(adjacent.id),
          own = root(cell.id);
        if (
          own !== other &&
          adjacent.facets.some((face) => face.plane === facet.plane) &&
          sharedFacetArea(facet, adjacent) > CELL_EPSILON
        )
          parents[other] = own;
      }
    }
  const groups = new Map<number, number>();
  const variable = cells.map(({ id }) => {
    const key = root(id);
    if (!groups.has(key)) groups.set(key, groups.size);
    return groups.get(key)! + 2;
  });
  function ray(point: Vec2, direction: ProjectionDirection) {
    const [u, v, depth] = viewAxes3[direction],
      box: SolidPoint = [0, 0, 0];
    box[u] = slabIndex(grid[u], point.x);
    box[v] = slabIndex(grid[v], point.y);
    if (box[u] < 0 || box[v] < 0) return [];
    const intervals = [];
    for (let i = size[depth] - 1; i >= 0; i--) {
      box[depth] = i;
      for (const cell of at(box)) {
        const interval = intersectCellRay(cell, point, direction);
        if (interval) intervals.push(interval);
      }
    }
    const merged: typeof intervals = [];
    for (const interval of intervals.sort((a, b) => b.near - a.near)) {
      const previous = merged.at(-1);
      if (
        previous &&
        variable[previous.cell.id] === variable[interval.cell.id] &&
        Math.abs(previous.far - interval.near) <= CELL_EPSILON * 10
      ) {
        previous.far = interval.far;
        previous.exit = interval.exit;
      } else merged.push(interval);
    }
    return merged;
  }
  function touching(point: SolidPoint) {
    const probes = grid.map((knots, i) =>
      [...new Set([slabIndex(knots, point[i] - 1e-6), slabIndex(knots, point[i] + 1e-6)])].filter(
        (value) => value >= 0,
      ),
    );
    return probes[0].flatMap((x) =>
      probes[1].flatMap((y) => probes[2].flatMap((z) => at([x, y, z]))),
    );
  }
  return {
    cells,
    plans,
    at,
    ray,
    touching,
    bores,
    variable,
    groups: groups.size,
    requiresMaterial: (plan: Plan, point: Vec2) =>
      plan.inEnvelope(point) &&
      !bores.some(
        (bore) => bore.direction === plan.direction && containsContourPoint(bore.boundary, point),
      ),
  };
}

export type SolidPartition = ReturnType<typeof partitionSolid>;
