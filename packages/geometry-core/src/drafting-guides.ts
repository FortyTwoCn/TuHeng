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
import { localToSheet, sheetDeltaToLocal, sheetToLocal, viewTransform } from './sheet';
import { segmentSatisfiesGuide, type SnapCandidate, type SnapOptions } from './snapping';

export interface TrackingBase {
  position: Vec2;
  direction?: Vec2;
  /** Coordinates are local to this view, or to the active view if omitted. */
  viewId?: string;
}

export function trackingBase(
  doc: GeometryDocument,
  viewId: string,
  candidate: SnapCandidate,
): TrackingBase & { viewId: string } {
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
    viewId,
    position: candidate.position,
    direction: line?.shape.kind === 'line' ? unit(line.shape.line.d) : undefined,
  };
}

type Guide = { point: Vec2; direction: Vec2 };
type TrackingGuide = Guide & { label: string };
type TrackingCandidate = SnapCandidate & { tracks: Guide[]; intersection: boolean };
const trackLine = ({ point, direction }: Guide): BoundaryShape => ({
  kind: 'line',
  line: { a: point, d: direction, finite: false },
});
const close = (a: Vec2, b: Vec2) => distance(a, b) < 1e-7;
function guideSet(doc: GeometryDocument, viewId: string, bases: readonly TrackingBase[]) {
  const anchors: Vec2[] = [];
  const guides: TrackingGuide[] = [];
  for (const base of bases) {
    const source = base.viewId && base.viewId !== viewId ? base.viewId : undefined;
    const point = source
      ? sheetToLocal(doc, viewId, localToSheet(doc, source, base.position))
      : base.position;
    anchors.push(point);
    const directions = [
      { direction: { x: 1, y: 0 }, label: '水平追踪' },
      { direction: { x: 0, y: 1 }, label: '垂直追踪' },
    ];
    if (base.direction) directions.push({ direction: base.direction, label: '延长线追踪' });
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

export function trackingCandidate(
  doc: GeometryDocument,
  viewId: string,
  pointer: Vec2,
  bases: readonly TrackingBase[],
  radius: number,
  options: SnapOptions,
  accepts: (q: Vec2) => boolean = () => true,
): TrackingCandidate | undefined {
  const { anchors, guides } = guideSet(doc, viewId, bases);
  const near = guides.filter(
    (g) => Math.abs(cross(sub(pointer, g.point), g.direction)) <= radius,
  );
  if (!near.length) return;
  let intersection: TrackingCandidate | undefined, alignment: TrackingCandidate | undefined;
  const candidate = (p: Vec2, tracks: Guide[], label: string): TrackingCandidate => ({
    kind: 'TRACKING',
    position: p,
    positionOnly: true,
    tracks,
    distance: distance(pointer, p),
    entityIds: [],
    label,
    intersection: false,
  });
  const crossPoint = (p: Vec2, tracks: Guide[], entry?: ReturnType<typeof nearbyEntries>[number]) => {
    if (anchors.some((anchor) => close(anchor, p)) || !accepts(p)) return;
    const reference = entry && !entry.entity ? entry.ref : undefined;
    const label = entry && reference ? `追踪交点 · ${entry.name}` : '追踪交点';
    const next = {
      ...candidate(p, tracks, label),
      intersection: true,
      entityIds: entry?.entity ? [entry.entity.id] : [],
      reference,
    };
    if (next.distance > radius) return;
    if (intersection && close(intersection.position, p)) {
      const winner = reference && !intersection.reference ? next : intersection;
      intersection = { ...winner, tracks: [...new Set([...intersection.tracks, ...tracks])] };
    } else if (!intersection || next.distance < intersection.distance) {
      intersection = next;
    }
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
    const next = candidate(pos, [g], g.label);
    if (!alignment || next.distance < alignment.distance) alignment = next;
  }
  const objects = objectSnapEnabled(options, 'intersection');
  if (objects || options.axes !== false)
    for (const entry of nearbyEntries(doc, viewId, pointer, radius, { ...options, objects }))
      for (const g of near) {
        if (
          entry.shape.kind === 'line' &&
          Math.abs(cross(g.direction, unit(entry.shape.line.d))) < 1e-8
        )
          continue;
        try {
          for (const hit of shapeIntersections(trackLine(g), entry.shape))
            if (!entry.ray || hit.b >= -1e-8) crossPoint(hit.position, [g], entry);
        } catch {
          // Coincident surfaces have no isolated intersection.
        }
      }
  return intersection ?? alignment;
}

/** Solve a tracking line or a copied length on the active drafting direction. */
export function combinedLineCandidate(
  doc: GeometryDocument,
  viewId: string,
  origin: Vec2,
  pointer: Vec2,
  directions: readonly SnapCandidate[],
  bases: readonly TrackingBase[],
  radius: number,
  options: SnapOptions,
  accepts: (q: Vec2) => boolean,
): SnapCandidate | undefined {
  const rays = directions.filter((c) =>
    (c.guide || c.kind === 'AXIS_DIRECTION') && !close(c.position, origin),
  );
  if (!rays.length) return;
  const { anchors, guides } = guideSet(doc, viewId, bases);
  const near = guides.filter(
    (g) => Math.abs(cross(sub(pointer, g.point), g.direction)) <= radius,
  );
  const span = distance(pointer, origin);
  const segments = snapIndex(doc, viewId).entries.flatMap(({ entity, shape }) => {
    if (
      entity?.kind !== 'segment' || entity.viewId !== viewId || shape.kind !== 'line' ||
      options.hiddenLayers?.includes(entity.layerId) || options.exclude?.includes(entity.id)
    ) return [];
    return [{
      id: entity.id,
      start: shape.line.a,
      end: add(shape.line.a, shape.line.d),
      length: length(shape.line.d),
    }];
  });
  let best: SnapCandidate | undefined;
  let bestScore = Infinity;
  for (const ray of rays) {
    const along = unit(sub(ray.position, origin));
    const connected = ray.guide?.kind === 'perpendicular' && close(ray.guide.contact, origin)
      ? segments.find(({ id }) => id === ray.guide?.sourceId)
      : undefined;
    const lengthAnchors = [origin, ...anchors];
    if (connected) lengthAnchors.push(connected.start, connected.end);
    const lengths = segments.filter((s) => Math.abs(s.length - span) <= radius &&
      lengthAnchors.some((a) => close(a, s.start) || close(a, s.end)),
    );
    function offer(end: Vec2, tracks: Guide[]) {
      const gap = distance(end, pointer);
      if (
        gap > (tracks.length ? radius : radius * 0.7) || !accepts(end) ||
        dot(sub(end, origin), along) <= 1e-7 ||
        (ray.guide && !segmentSatisfiesGuide(origin, end, ray.guide))
      ) return;
      const len = distance(origin, end);
      const reference = lengths.find((s) => Math.abs(s.length - len) < 1e-7);
      const score = gap / radius - (reference ? 0.12 : 0) - (connected ? 0.06 : 0);
      if (score >= bestScore || (!tracks.length && !reference)) return;
      bestScore = score;
      best = {
        kind: 'TRACKING',
        position: end,
        positionOnly: true,
        label: reference ? '等长' : '追踪交点',
        distance: gap,
        guide: ray.guide,
        tracks,
        entityIds: [...new Set([...ray.entityIds, ...(reference ? [reference.id] : [])])],
        equalLength: reference ? { sourceId: reference.id, length: reference.length } : undefined,
      };
    }
    for (const g of near) {
      const det = cross(along, g.direction);
      if (Math.abs(det) > 1e-8)
        offer(add(origin, scale(along, cross(sub(g.point, origin), g.direction) / det)), [g]);
    }
    for (const source of lengths) offer(add(origin, scale(along, source.length)), []);
  }
  return best;
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
