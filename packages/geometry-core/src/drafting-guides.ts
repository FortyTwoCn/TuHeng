import type { GeometryDocument, Vec2 } from '@tuheng/contracts';
import { add, cross, distance, foot, length, scale, sub, unit } from './math';
import { conicParameter, nearestOnShape, type Conic } from './parametric-geometry';
import { nearbyEntries, snapIndex, objectSnapEnabled } from './snap-geometry';
import { localToSheet, sheetDeltaToLocal, sheetToLocal, viewTransform } from './sheet';
import type { SnapCandidate, SnapOptions, SnapTrack } from './snapping';

export interface TrackingBase {
  position: Vec2;
  direction?: Vec2;
  directions?: readonly Vec2[];
  /** Coordinates are local to this view, or to the active view if omitted. */
  viewId?: string;
}

export function trackingBase(
  doc: GeometryDocument,
  viewId: string,
  candidate: SnapCandidate,
  options: SnapOptions = {},
): TrackingBase & { viewId: string } {
  const directions: Vec2[] = [];
  for (const { entity, shape } of snapIndex(doc, viewId).entries) {
    if (
      entity?.kind !== 'segment' ||
      shape.kind !== 'line' ||
      options.hiddenLayers?.includes(entity.layerId) ||
      options.exclude?.includes(entity.id)
    )
      continue;
    const { a, d } = shape.line;
    const atEndpoint =
      candidate.kind === 'COINCIDENT' &&
      (distance(candidate.position, a) < 1e-7 || distance(candidate.position, add(a, d)) < 1e-7);
    if (!atEndpoint && !candidate.entityIds.includes(entity.id)) continue;
    const direction = unit(d);
    if (
      length(direction) > 0 &&
      !directions.some((other) => Math.abs(cross(other, direction)) < 1e-8)
    )
      directions.push(direction);
  }
  return { viewId, position: candidate.position, direction: directions[0], directions };
}

export function trackingGuides(
  doc: GeometryDocument,
  viewId: string,
  bases: readonly TrackingBase[],
) {
  const anchors: Vec2[] = [];
  const guides: (SnapTrack & { label: string })[] = [];
  for (const base of bases) {
    const source = base.viewId && base.viewId !== viewId ? base.viewId : undefined;
    const point = source
      ? sheetToLocal(doc, viewId, localToSheet(doc, source, base.position))
      : base.position;
    anchors.push(point);
    const directions = [
      { direction: { x: 1, y: 0 }, label: '水平追踪' },
      { direction: { x: 0, y: 1 }, label: '垂直追踪' },
      ...(base.directions ?? (base.direction ? [base.direction] : [])).map((direction) => ({
        direction,
        label: '延长线追踪',
      })),
    ];
    const frame = source ? viewTransform(doc, source) : undefined;
    for (const { direction: delta, label } of directions) {
      const direction = unit(
        frame
          ? sheetDeltaToLocal(
              doc,
              viewId,
              add(scale(frame.xAxis, delta.x), scale(frame.yAxis, delta.y)),
            )
          : delta,
      );
      if (
        length(direction) < 1e-8 ||
        guides.some(
          (g) =>
            Math.abs(cross(direction, g.direction)) < 1e-8 &&
            Math.abs(cross(sub(point, g.point), g.direction)) < 1e-8,
        )
      )
        continue;
      guides.push({ point, direction, label });
    }
  }
  return { anchors, guides };
}

export function nearestDraftingCandidate(
  doc: GeometryDocument,
  viewId: string,
  pointer: Vec2,
  radius: number,
  options: SnapOptions,
  accepts: (q: Vec2) => boolean,
): SnapCandidate | undefined {
  if (!objectSnapEnabled(options, 'nearest')) return;
  let best: SnapCandidate | undefined;
  for (const entry of nearbyEntries(doc, viewId, pointer, radius, options)) {
    if (!entry.entity) continue;
    const q =
      entry.shape.kind === 'line'
        ? foot(pointer, entry.shape.line)
        : nearestOnShape(entry.shape, pointer).position;
    const gap = distance(q, pointer);
    if (gap <= radius && (!best || gap < best.distance) && accepts(q))
      best = {
        kind: 'NEAREST',
        position: q,
        positionOnly: true,
        distance: gap,
        entityIds: [entry.entity.id],
        label: '就近点 · ' + entry.name,
      };
  }
  return best;
}

type CircleEdge = { id: string; conic: Conic };
export function commonTangentCandidates(
  doc: GeometryDocument,
  viewId: string,
  p: Vec2,
  radius: number,
  options: SnapOptions,
): SnapCandidate[] {
  if (!objectSnapEnabled(options, 'tangent')) return [];
  const circles: CircleEdge[] = [];
  for (const e of snapIndex(doc, viewId).entries) {
    if (e.entity?.kind !== 'circle' && e.entity?.kind !== 'arc') continue;
    if (options.hiddenLayers?.includes(e.entity.layerId) || options.exclude?.includes(e.entity.id))
      continue;
    if (e.shape.kind === 'parametric' && e.shape.conic)
      circles.push({ id: e.entity.id, conic: e.shape.conic });
  }
  const nearby = circles.filter(({ conic: c }) => Math.abs(distance(p, c.center) - c.a) <= radius);
  const candidates: SnapCandidate[] = [];
  for (const first of nearby)
    for (const second of circles) {
      if (first.id === second.id) continue;
      const a = first.conic,
        b = second.conic;
      const delta = sub(b.center, a.center),
        span = length(delta);
      if (span <= 1e-8) continue;
      const axis = scale(delta, 1 / span),
        normal = { x: -axis.y, y: axis.x };
      for (const side of [1, -1]) {
        const along = (a.a - side * b.a) / span;
        if (Math.abs(along) >= 1 - 1e-10) continue;
        const away = Math.sqrt(1 - along ** 2);
        for (const sign of [1, -1]) {
          const n = add(scale(axis, along), scale(normal, sign * away));
          const q = add(a.center, scale(n, a.a)),
            other = add(b.center, scale(n, side * b.a));
          const gap = distance(p, q);
          if (
            gap > radius ||
            conicParameter(a, q) > 1 + 1e-8 ||
            conicParameter(b, other) > 1 + 1e-8
          )
            continue;
          candidates.push({
            kind: 'TANGENT',
            position: q,
            positionOnly: true,
            distance: gap,
            entityIds: [first.id, second.id],
            pairedTangent: { sourceId: second.id, contact: other },
            label: side === 1 ? '外公切首点' : '内公切首点',
          });
        }
      }
    }
  return candidates.sort((a, b) => a.distance - b.distance);
}
