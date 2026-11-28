import { CONTOUR_JOIN_MM } from './drawing-contours';
import { project2, signedDistance, type CutPlane } from './solid-cell-geometry';
import type { SolidPartition } from './solid-cell-partition';
import { FALSE, type CellConstraints } from './solid-cell-solver';
import { add3, cross3, dot3, norm3, scale3, sub3, unit3, type SolidPoint } from './spatial-math';

const fullTurn = 2 * Math.PI;
const angleAt = (angle: number) => (angle + fullTurn) % fullTurn;
const supportTolerance = 1e-6;
const key = (point: SolidPoint) =>
  point.map((value) => Math.round(value / supportTolerance)).join(',');

function hasDrawingStroke(partition: SolidPartition, center: SolidPoint, direction: SolidPoint) {
  return partition.plans.some(({ direction: view, subdivision }) => {
    const p = project2(center, view),
      d = project2(direction, view);
    const magnitude = Math.hypot(d.x, d.y);
    if (magnitude <= supportTolerance) return false;
    return subdivision.edges.some(({ from, to }) => {
      const dx = to.x - from.x,
        dy = to.y - from.y;
      const length = Math.hypot(dx, dy);
      const x = p.x - from.x,
        y = p.y - from.y;
      return (
        Math.abs(dx * d.y - dy * d.x) <= length * magnitude * 2e-6 &&
        Math.abs(dx * y - dy * x) <= CONTOUR_JOIN_MM * length &&
        x * dx + y * dy >= -CONTOUR_JOIN_MM * length &&
        (p.x - to.x) * dx + (p.y - to.y) * dy <= CONTOUR_JOIN_MM * length
      );
    });
  });
}

function crossSection(partition: SolidPartition, center: SolidPoint, direction: SolidPoint) {
  const u = unit3(cross3(direction, Math.abs(direction[0]) > 0.7 ? [0, 1, 0] : [1, 0, 0]));
  const v = cross3(direction, u);
  const touching = partition.touching(center).flatMap((cell) => {
    const distances = cell.facets.map((facet) => signedDistance(center, facet));
    if (distances.some((distance) => distance > supportTolerance)) return [];
    return [
      {
        state: partition.variable[cell.id],
        active: cell.facets.filter(
          ({ plane }, i) =>
            Math.abs(distances[i]) <= supportTolerance &&
            Math.abs(dot3(plane.normal, direction)) <= 1e-6,
        ),
      },
    ];
  });
  const planes = new Set(touching.flatMap(({ active }) => active.map(({ plane }) => plane)));
  const angles = [...planes]
    .flatMap((plane) => {
      const normal = Math.atan2(dot3(plane.normal, v), dot3(plane.normal, u));
      return [Math.PI / 2, (3 * Math.PI) / 2].map((offset) => ({
        plane,
        angle: angleAt(normal + offset),
      }));
    })
    .sort((a, b) => a.angle - b.angle);
  const ordered = angles.filter(({ angle }, i) => !i || angle - angles[i - 1].angle > 1e-7);
  if (ordered.length > 1 && ordered[0].angle + fullTurn - ordered.at(-1)!.angle <= 1e-7)
    ordered.pop();
  const states = ordered.map(({ angle }, i) => {
    const next = i + 1 < ordered.length ? ordered[i + 1].angle : ordered[0].angle + fullTurn;
    const middle = (angle + next) / 2;
    const outward = add3(scale3(u, Math.cos(middle)), scale3(v, Math.sin(middle)));
    return (
      touching.find(({ active }) =>
        active.every(({ plane, side }) => dot3(outward, plane.normal) * side <= 1e-8),
      )?.state ?? FALSE
    );
  });
  return { ordered, states };
}

function smoothContinuation(a: CutPlane, b: CutPlane, angle: number) {
  if (a === b) return Math.abs(angle - Math.PI) <= 1e-6;
  if (Math.abs(angle - Math.PI) > 0.21) return false;
  return a.sources.some(({ curved }) => curved) || b.sources.some(({ curved }) => curved);
}

export function constrainCellTopology(partition: SolidPartition, formula: CellConstraints) {
  const visited = new Set<string>(),
    patterns = new Set<string>();
  for (const { facets } of partition.cells)
    for (const { points, plane } of facets) {
      for (const [i, a] of points.entries()) {
        const b = points[(i + 1) % points.length],
          delta = sub3(b, a);
        if (norm3(delta) <= CONTOUR_JOIN_MM) continue;
        if (
          !facets.some(
            (other) =>
              other.plane !== plane &&
              Math.abs(signedDistance(a, other)) <= supportTolerance &&
              Math.abs(signedDistance(b, other)) <= supportTolerance,
          )
        )
          continue;
        const ends = [key(a), key(b)].sort().join(':');
        if (visited.has(ends)) continue;
        visited.add(ends);
        if (visited.size > 55000) throw Error('空间棱边数量超过计算上限。');
        const direction = unit3(delta);
        // An off-center parameter avoids coinciding with a vertex from a neighboring slab.
        const center = add3(a, scale3(delta, 0.438));
        const { ordered, states } = crossSection(partition, center, direction);
        const changes = ordered.flatMap((boundary, j) => {
          const previous = states[(j + states.length - 1) % states.length],
            next = states[j];
          return previous === next ? [] : [{ ...boundary, previous, next }];
        });
        if (
          changes.length <= 2 &&
          (changes.length < 2 ||
            smoothContinuation(
              changes[0].plane,
              changes[1].plane,
              changes[1].angle - changes[0].angle,
            ))
        )
          continue;
        const unmarked = !hasDrawingStroke(partition, center, direction);
        const forbidden: [number, number][] = [];
        if (unmarked)
          for (const [j, a] of changes.entries())
            for (let k = j + 1; k < changes.length; k++)
              if (!smoothContinuation(a.plane, changes[k].plane, changes[k].angle - a.angle))
                forbidden.push([j, k]);
        const pattern =
          changes
            .map(({ previous, next }) =>
              [Math.min(previous, next), Math.max(previous, next)].join(','),
            )
            .join(':') +
          '/' +
          forbidden.map((pair) => pair.join(',')).join(':');
        if (patterns.has(pattern)) continue;
        patterns.add(pattern);
        const transitions = changes.map(({ previous, next }) =>
          formula.or([formula.and(previous, -next), formula.and(-previous, next)]),
        );
        // A manifold solid has at most two surface sheets meeting around a geometric edge.
        for (let j = 0; j < transitions.length; j++)
          for (let k = j + 1; k < transitions.length; k++)
            for (let l = k + 1; l < transitions.length; l++)
              formula.require(-transitions[j], -transitions[k], -transitions[l]);
        for (const [j, k] of forbidden) formula.require(-transitions[j], -transitions[k]);
      }
    }
}
