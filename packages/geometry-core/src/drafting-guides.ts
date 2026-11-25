import type { GeometryDocument, Vec2 } from '@tuheng/contracts';
import { add, cross, distance, dot, foot, length, scale, sub, unit } from './math';
import {
  conicParameter,
  nearestOnShape,
  shapeIntersections,
  type BoundaryShape,
  type Conic,
} from './parametric-geometry';
import { nearbyEntries, snapIndex, objectSnapEnabled } from './snap-geometry';
import type { SnapCandidate, SnapOptions } from './snapping';

export interface TrackingBase {
  position: Vec2;
  direction?: Vec2;
}

export function trackingBase(
  doc: GeometryDocument,
  viewId: string,
  candidate: SnapCandidate,
): TrackingBase {
  const line = snapIndex(doc, viewId).entries.find(
    (entry) =>
      entry.shape.kind === 'line' &&
      entry.shape.line.finite &&
      entry.entity &&
      (candidate.entityIds.includes(entry.entity.id) ||
        (candidate.kind === 'COINCIDENT' &&
          entry.entity?.kind === 'segment' &&
          candidate.entityIds.some(
            (id) =>
              entry.entity?.kind === 'segment' &&
              (entry.entity.startPoint === id || entry.entity.endPoint === id),
          ))),
  );
  return {
    position: candidate.position,
    direction: line?.shape.kind === 'line' ? unit(line.shape.line.d) : undefined,
  };
}

type Guide = { point: Vec2; direction: Vec2 };
const trackLine = ({ point, direction }: Guide): BoundaryShape => ({
  kind: 'line',
  line: { a: point, d: direction, finite: false },
});
const close = (a: Vec2, b: Vec2) => distance(a, b) < 1e-7;
function guideSet(bases: readonly TrackingBase[]) {
  const directions = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
  ];
  const guides: Guide[] = [];
  for (const base of bases)
    for (const direction of base.direction ? [...directions, base.direction] : directions) {
      if (
        guides.some(
          (g) =>
            Math.abs(cross(direction, g.direction)) < 1e-8 &&
            Math.abs(cross(sub(base.position, g.point), g.direction)) < 1e-8,
        )
      )
        continue;
      guides.push({ point: base.position, direction });
    }
  return guides;
}

export function trackingCandidate(
  doc: GeometryDocument,
  viewId: string,
  pointer: Vec2,
  bases: readonly TrackingBase[],
  radius: number,
  options: SnapOptions,
  accepts: (q: Vec2) => boolean = () => true,
): SnapCandidate | undefined {
  const near = guideSet(bases).filter(
    (g) => Math.abs(cross(sub(pointer, g.point), g.direction)) <= radius,
  );
  if (!near.length) return;
  let intersection: SnapCandidate | undefined, alignment: SnapCandidate | undefined;
  const candidate = (p: Vec2, guides: Guide[], label: string, entities: string[] = []) => ({
    kind: 'TRACKING' as const,
    position: p,
    positionOnly: true,
    tracks: guides,
    distance: distance(pointer, p),
    entityIds: entities,
    label,
  });
  const crossPoint = (p: Vec2, guides: Guide[], entities?: string[]) => {
    if (bases.some((base) => close(base.position, p)) || !accepts(p)) return;
    const next = candidate(p, guides, '追踪交点', entities);
    if (next.distance <= radius && (!intersection || next.distance < intersection.distance))
      intersection = next;
  };
  for (const [i, g] of near.entries()) {
    for (const h of near.slice(i + 1)) {
      const det = cross(g.direction, h.direction);
      if (Math.abs(det) > 1e-8)
        crossPoint(
          add(g.point, scale(g.direction, cross(sub(h.point, g.point), h.direction) / det)),
          [g, h],
        );
    }
    const pos = add(g.point, scale(g.direction, dot(sub(pointer, g.point), g.direction)));
    if (!accepts(pos)) continue;
    const name =
      Math.abs(g.direction.y) < 1e-8
        ? '水平追踪'
        : Math.abs(g.direction.x) < 1e-8
          ? '垂直追踪'
          : '延长线追踪';
    const next = candidate(pos, [g], name);
    if (!alignment || next.distance < alignment.distance) alignment = next;
  }
  if (objectSnapEnabled(options, 'intersection'))
    for (const entry of nearbyEntries(doc, viewId, pointer, radius, options))
      for (const g of near) {
        if (
          entry.shape.kind === 'line' &&
          Math.abs(cross(g.direction, unit(entry.shape.line.d))) < 1e-8
        )
          continue;
        try {
          for (const hit of shapeIntersections(trackLine(g), entry.shape))
            if (!entry.ray || hit.b >= -1e-8)
              crossPoint(hit.position, [g], entry.entity ? [entry.entity.id] : []);
        } catch {
          // Coincident surfaces have no isolated intersection.
        }
      }
  return intersection ?? alignment;
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
