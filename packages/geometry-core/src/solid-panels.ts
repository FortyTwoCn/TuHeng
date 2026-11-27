import { projectionPlaneAxes, type AuditedDrawingView, type SolidAxis } from './drawing-audit';
import type { ContourEdge } from './drawing-contours';

export type SolidPoint = [number, number, number];
export type SolidBounds = { min: SolidPoint; max: SolidPoint; size: SolidPoint };
export type SolidPanel = { points: SolidPoint[]; viewId: string; entityId: string };
export const solidAxes = { x: 0, y: 1, z: 2 } as const satisfies Record<SolidAxis, number>;
export const SOLID_EPSILON = 1e-8;

const axisIndices = [0, 1, 2] as const;
type AxisIndex = (typeof axisIndices)[number];
type Height = { start: number; slope: number };
type DepthRange = { lower: Height; upper: Height };
type Band = DepthRange & { from: number; to: number };
type SliceEdge = { u0: number; u1: number; depth0: number; depth1: number };
type Slicer = {
  first: SliceEdge[];
  second: SliceEdge[];
  firstKnots: number[];
  secondKnots: number[];
};
type Plane = {
  viewId: string;
  axes: [AxisIndex, AxisIndex];
  perpendicular: AxisIndex;
  edges: ContourEdge[];
  slicer: Slicer;
};

const heightAt = (h: Height, t: number) => h.start + h.slope * t;
const constant = (start: number): Height => ({ start, slope: 0 });
const sortedUnique = (values: number[]) =>
  values
    .sort((a, b) => a - b)
    .filter((value, index, sorted) => !index || value - sorted[index - 1] > SOLID_EPSILON);

function makePlane(audited: AuditedDrawingView): Plane {
  const [a, b] = projectionPlaneAxes[audited.direction!];
  const axes = [solidAxes[a], solidAxes[b]] as [AxisIndex, AxisIndex];
  const edges = audited.contours.flatMap(({ edges }) => edges);
  const first = edges.map(({ from, to }) => ({
    u0: from.x,
    u1: to.x,
    depth0: from.y,
    depth1: to.y,
  }));
  const second = edges.map(({ from, to }) => ({
    u0: from.y,
    u1: to.y,
    depth0: from.x,
    depth1: to.x,
  }));
  return {
    viewId: audited.view.id,
    axes,
    perpendicular: axisIndices.find((axis) => !axes.includes(axis))!,
    edges,
    slicer: {
      first,
      second,
      firstKnots: sortedUnique(first.flatMap(({ u0, u1 }) => [u0, u1])),
      secondKnots: sortedUnique(second.flatMap(({ u0, u1 }) => [u0, u1])),
    },
  };
}

function subtractOwnedRanges(ranges: DepthRange[], owned: [number, number][]) {
  let visible = ranges;
  for (const [low, high] of owned) {
    visible = visible.flatMap((range) => {
      if (range.upper.start <= low || range.lower.start >= high) return [range];
      const rest: DepthRange[] = [];
      if (range.lower.start < low) rest.push({ lower: range.lower, upper: constant(low) });
      if (range.upper.start > high) rest.push({ lower: constant(high), upper: range.upper });
      return rest;
    });
  }
  return visible;
}

function scanRanges(
  edges: SliceEdge[],
  u: Height,
  t: number,
  inward: number,
  ownedByOther: boolean,
) {
  const coordinate = heightAt(u, t),
    flat = Math.abs(u.slope) <= SOLID_EPSILON;
  const crossings: Height[] = [],
    owned: [number, number][] = [];
  for (const { u0, u1, depth0, depth1 } of edges) {
    const lo = Math.min(u0, u1),
      hi = Math.max(u0, u1);
    if (hi - lo <= SOLID_EPSILON) {
      if (flat && ownedByOther && Math.abs(coordinate - lo) <= SOLID_EPSILON)
        owned.push([Math.min(depth0, depth1), Math.max(depth0, depth1)]);
      continue;
    }
    // At a coplanar boundary, use the material side of the source edge.
    const atLow = flat && Math.abs(coordinate - lo) <= SOLID_EPSILON;
    const atHigh = flat && Math.abs(coordinate - hi) <= SOLID_EPSILON;
    if (atLow ? inward < 0 : atHigh ? inward > 0 : coordinate <= lo || coordinate >= hi) continue;
    const rate = (depth1 - depth0) / (u1 - u0);
    crossings.push({ start: depth0 + rate * (u.start - u0), slope: rate * u.slope });
  }
  crossings.sort((a, b) => heightAt(a, t) - heightAt(b, t));
  if (crossings.length % 2) throw Error('投影扫描线遇到无法配对的轮廓边界');
  const ranges: DepthRange[] = [];
  for (let i = 0; i < crossings.length; i += 2)
    ranges.push({ lower: crossings[i], upper: crossings[i + 1] });
  return owned.length ? subtractOwnedRanges(ranges, owned) : ranges;
}

function crossing(a: Height, b: Height) {
  return (a.start - b.start) / (b.slope - a.slope);
}

function intersectBand(band: Band, range: DepthRange): Band[] {
  const cuts = [crossing(band.lower, range.lower), crossing(band.upper, range.upper)].filter(
    (t) => t > band.from + SOLID_EPSILON && t < band.to - SOLID_EPSILON,
  );
  const knots = sortedUnique([band.from, ...cuts, band.to]);
  const intersections: Band[] = [];
  for (const [i, end] of knots.slice(1).entries()) {
    let from = knots[i],
      to = end;
    const mid = (from + to) / 2;
    const lower =
      heightAt(band.lower, mid) >= heightAt(range.lower, mid) ? band.lower : range.lower;
    const upper =
      heightAt(band.upper, mid) <= heightAt(range.upper, mid) ? band.upper : range.upper;
    const widthAtStart = heightAt(upper, from) - heightAt(lower, from);
    const widthAtEnd = heightAt(upper, to) - heightAt(lower, to);
    if (Math.max(widthAtStart, widthAtEnd) <= SOLID_EPSILON) continue;
    if (widthAtStart < 0) from = crossing(lower, upper);
    if (widthAtEnd < 0) to = crossing(lower, upper);
    if (to - from > SOLID_EPSILON) intersections.push({ from, to, lower, upper });
  }
  return intersections;
}

function pointOnPanel(plane: Plane, edge: ContourEdge, t: number, depth: number): SolidPoint {
  const p: SolidPoint = [0, 0, 0];
  p[plane.axes[0]] = edge.from.x + t * (edge.to.x - edge.from.x);
  p[plane.axes[1]] = edge.from.y + t * (edge.to.y - edge.from.y);
  p[plane.perpendicular] = depth;
  return p;
}

export function solidPanels(views: AuditedDrawingView[]): SolidPanel[] {
  const planes = views.map(makePlane);
  const min: SolidPoint = [-Infinity, -Infinity, -Infinity];
  const max: SolidPoint = [Infinity, Infinity, Infinity];
  planes.forEach(({ axes }, i) => {
    const bounds = views[i].bounds!;
    for (const [coordinate, axis] of [
      ['x', axes[0]],
      ['y', axes[1]],
    ] as const) {
      min[axis] = Math.max(min[axis], bounds.min[coordinate]);
      max[axis] = Math.min(max[axis], bounds.max[coordinate]);
    }
  });
  if (min.some((value, i) => max[i] - value <= SOLID_EPSILON)) return [];

  const panels: SolidPanel[] = [];
  let work = 0;
  for (const [owner, plane] of planes.entries()) {
    const depth = plane.perpendicular;
    const flipped = plane.axes[0] === 0 && plane.axes[1] === 2;
    for (const edge of plane.edges) {
      const dx = edge.to.x - edge.from.x,
        dy = edge.to.y - edge.from.y;
      const intervals = [0, 1];
      const candidates = planes.flatMap((other, index) => {
        if (index === owner) return [];
        const shared = other.axes.find((axis) => axis !== depth)!;
        const first = shared === plane.axes[0];
        const u = { start: first ? edge.from.x : edge.from.y, slope: first ? dx : dy };
        const inward = first ? -dy : dx;
        const fixedFirst = shared === other.axes[0];
        const knots = fixedFirst ? other.slicer.firstKnots : other.slicer.secondKnots;
        const edges = fixedFirst ? other.slicer.first : other.slicer.second;
        work += knots.length;
        if (Math.abs(u.slope) > SOLID_EPSILON) {
          for (const knot of knots) {
            const t = (knot - u.start) / u.slope;
            if (t > SOLID_EPSILON && t < 1 - SOLID_EPSILON) intervals.push(t);
          }
        }
        return [{ u, inward, edges, ownedByOther: index < owner }];
      });
      const cuts = sortedUnique(intervals);
      for (const [i, to] of cuts.slice(1).entries()) {
        const from = cuts[i],
          mid = (from + to) / 2;
        let bands: Band[] = [
          { from, to, lower: constant(min[depth]), upper: constant(max[depth]) },
        ];
        for (const { u, inward, edges, ownedByOther } of candidates) {
          work += edges.length;
          if (work > 3_000_000) throw Error('投影裁剪过于复杂，已达到计算上限');
          const ranges = scanRanges(edges, u, mid, inward, ownedByOther);
          work += bands.length * ranges.length;
          bands = bands.flatMap((band) => ranges.flatMap((range) => intersectBand(band, range)));
          if (!bands.length) break;
        }
        for (const { from, to, lower, upper } of bands) {
          const points = [
            pointOnPanel(plane, edge, from, heightAt(lower, from)),
            pointOnPanel(plane, edge, to, heightAt(lower, to)),
            pointOnPanel(plane, edge, to, heightAt(upper, to)),
            pointOnPanel(plane, edge, from, heightAt(upper, from)),
          ];
          if (panels.length >= 15000) throw Error('三维裁剪表面数量超过上限');
          panels.push({
            points: flipped ? points.reverse() : points,
            viewId: plane.viewId,
            entityId: edge.entityId,
          });
        }
      }
    }
  }
  return panels;
}
