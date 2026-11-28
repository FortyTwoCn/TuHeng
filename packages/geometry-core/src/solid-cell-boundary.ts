import {
  CELL_EPSILON,
  centroid,
  facetArea,
  project2,
  signedDistance,
  subtractCell,
  type Facet,
} from './solid-cell-geometry';
import type { SolidPartition } from './solid-cell-partition';
import { solidAxes, type SolidPoint } from './spatial-math';
import type { SolidPanel } from './solid-panels';
import { projectionPlaneAxes } from './projection-coordinates';

function facetSource(facet: Facet, partition: SolidPartition, points: SolidPoint[]) {
  const center = centroid(points);
  let minDistance = Infinity;
  let source = facet.plane.sources[0];
  for (const candidate of facet.plane.sources) {
    const p = project2(center, candidate.direction),
      { from, to } = candidate;
    const dx = to.x - from.x,
      dy = to.y - from.y;
    const t = Math.max(
      0,
      Math.min(1, ((p.x - from.x) * dx + (p.y - from.y) * dy) / (dx * dx + dy * dy)),
    );
    const distance = Math.hypot(p.x - from.x - t * dx, p.y - from.y - t * dy);
    if (distance >= minDistance) continue;
    minDistance = distance;
    source = candidate;
  }
  if (source) return { viewId: source.viewId, entityId: source.entityId };
  const plan =
    partition.plans.find(({ direction }) =>
      projectionPlaneAxes[direction].every((axis) => solidAxes[axis] !== facet.plane.axis),
    ) ?? partition.plans[0];
  return { viewId: plan.view.view.id, entityId: '' };
}

export function cellBoundaryPanels(partition: SolidPartition, occupancy: Int8Array) {
  const panels: SolidPanel[] = [];
  for (const cell of partition.cells) {
    if (occupancy[cell.id] !== 1) continue;
    for (const facet of cell.facets) {
      const { axis } = facet.plane;
      const adjoining = [...cell.box] as SolidPoint;
      if (axis !== undefined) adjoining[axis] += facet.side;
      let pieces = [facet.points];
      for (const neighbor of partition.at(adjoining)) {
        if (!pieces.length) break;
        if (occupancy[neighbor.id] !== 1 || signedDistance(neighbor.sample, facet) <= CELL_EPSILON)
          continue;
        pieces = pieces.flatMap((points) => subtractCell(points, neighbor, facet.plane));
      }
      for (const points of pieces)
        if (facetArea(points) > CELL_EPSILON)
          panels.push({ points, ...facetSource(facet, partition, points) });
    }
  }
  return panels;
}
