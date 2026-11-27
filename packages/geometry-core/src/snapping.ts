import { createId } from '@tuheng/contracts';
import type { GeometryDocument, Vec2, GeometryTargetRef } from '@tuheng/contracts';
import { add, cross, distance, foot, length, scale, sub, dot, unit } from './math';
import { viewAxes } from './projections';
import { mergePoints } from './topology';
import { transact } from './document';
import { referenceGeometry, referenceKey, closestReference } from './references';
import {
  curvedSnapPositions,
  geometricIntersections,
  nearbyEntries,
  snapIndex,
  objectSnapEnabled,
  directionalEndpoint,
  tangentAtCircleOrigin,
  type ObjectSnapType,
} from './snap-geometry';
export type { ObjectSnapType } from './snap-geometry';
import { localToSheet, orthographic, sheetToLocal } from './sheet';
import { writeReferenceRelation } from './reference-relations';
export const interactionThresholds = {
  mouse: { drag: 4, snap: 10, hit: 10 },
  pen: { drag: 3, snap: 12, hit: 12 },
  touch: { drag: 7, snap: 16, hit: 18 },
};
export interface SnapGuide {
  kind: 'parallel' | 'perpendicular' | 'tangent';
  sourceId: string;
  origin: Vec2;
  contact: Vec2;
  direction: Vec2;
}
export interface SnapCandidate {
  positionOnly?: boolean;
  tracks?: { point: Vec2; direction: Vec2 }[];
  id?: string;
  label?: string;
  reference?: GeometryTargetRef;
  references?: GeometryTargetRef[];
  position: Vec2;
  entityIds: string[];
  kind:
    | 'NEAREST'
    | 'TRACKING'
    | 'ENDPOINT'
    | 'CENTER'
    | 'FOOT'
    | 'TANGENT'
    | 'QUADRANT'
    | 'COINCIDENT'
    | 'MIDPOINT'
    | 'INTERSECTION'
    | 'POINT_ON_LINE'
    | 'GRID'
    | 'AXIS'
    | 'AXIS_DIRECTION'
    | 'POINT_ON_REFERENCE'
    | 'ORIGIN'
    | 'PARALLEL'
    | 'PERPENDICULAR'
    | 'PROJECTION_ALIGNMENT';
  distance: number;
  guide?: SnapGuide;
  equalLength?: { sourceId: string; length: number };
  pairedTangent?: { sourceId: string; contact: Vec2 };
}
export interface SnapOptions {
  exclude?: string[];
  hiddenLayers?: string[];
  grid?: boolean;
  gridSpacing?: number;
  projection?: boolean;
  threshold?: number;
  previous?: SnapCandidate;
  axes?: boolean;
  objects?: boolean;
  objectTypes?: readonly ObjectSnapType[];
  direction?: boolean;
  lineRelations?: boolean;
}
// Coincident snap positions are compared in local drawing millimetres, never in screen pixels.
const samePosition = 1e-7;
const pointFeatureOrder: Partial<Record<SnapCandidate['kind'], number>> = {
  COINCIDENT: 0,
  ENDPOINT: 1,
  ORIGIN: 2,
  INTERSECTION: 3,
  CENTER: 4,
  MIDPOINT: 5,
  QUADRANT: 6,
  GRID: 7,
};

export function segmentSatisfiesGuide(start: Vec2, end: Vec2, g: SnapGuide): boolean {
  const v = sub(end, start),
    size = length(v);
  if (size <= samePosition) return false;
  const direction = scale(v, 1 / size);
  if (g.kind === 'perpendicular') return Math.abs(dot(direction, g.direction)) <= 1e-8;
  if (Math.abs(cross(direction, g.direction)) > 1e-8) return false;
  if (g.kind === 'parallel') return true;
  const fromStart = sub(g.contact, start);
  const along = dot(fromStart, direction);
  return (
    Math.abs(cross(fromStart, g.direction)) <= samePosition &&
    along >= -samePosition &&
    along <= size + samePosition
  );
}

function acceptsGuide(start: Vec2, end: Vec2, candidate: SnapCandidate): boolean {
  return !!candidate.guide && segmentSatisfiesGuide(start, end, candidate.guide) &&
    (candidate.kind !== 'FOOT' || distance(end, candidate.guide.contact) <= samePosition);
}

export function snapCandidates(
  doc: GeometryDocument,
  viewId: string,
  p: Vec2,
  cssPixelsPerMm: number,
  origin?: Vec2,
  options: SnapOptions = {},
): SnapCandidate[] {
  const threshold = (options.threshold ?? 10) / cssPixelsPerMm,
    candidates: SnapCandidate[] = [];
  const push = (
    position: Vec2,
    entityIds: string[],
    kind: SnapCandidate['kind'],
    reference?: GeometryTargetRef,
    label?: string,
    positionOnly = false,
    guide?: SnapGuide,
    tracks?: SnapCandidate['tracks'],
  ) => {
    const d = distance(position, p);
    const feature =
      positionOnly && ['TANGENT', 'QUADRANT', 'ENDPOINT'].includes(kind)
        ? ':' +
          (guide?.contact ?? position).x.toFixed(6) +
          ',' +
          (guide?.contact ?? position).y.toFixed(6)
        : '';
    const id =
      (reference ? `${kind}:${referenceKey(reference)}` : `${kind}:${entityIds.join(',')}`) +
      feature;
    if (d <= threshold * (options.previous?.id === id ? 1.5 : 1))
      candidates.push({
        id,
        position,
        entityIds,
        kind,
        distance: d,
        reference,
        label,
        positionOnly,
        ...(guide ? { guide } : {}),
        ...(tracks ? { tracks } : {}),
      });
  };
  if (options.axes !== false)
    for (const reference of referenceGeometry(doc)) {
      const q = closestReference(localToSheet(doc, viewId, p), reference);
      push(
        sheetToLocal(doc, viewId, q),
        [],
        reference.extent === 'point' ? 'ORIGIN' : 'POINT_ON_REFERENCE',
        reference.ref,
        reference.name,
      );
    }
  candidates.push(...intersectionCandidates(doc, viewId, p, cssPixelsPerMm, options));
  const index = snapIndex(doc, viewId);
  const entities = doc.entities.filter(
    (e) =>
      e.viewId === viewId &&
      !options.exclude?.includes(e.id) &&
      !options.hiddenLayers?.includes(e.layerId),
  );
  if (objectSnapEnabled(options, 'endpoint'))
    for (const e of entities)
      if (
        e.kind === 'point' &&
        (!index.centerPoints.has(e.id) || index.endpoints.has(e.id) || e.labelVisible)
      )
        push(e.position, [e.id], 'COINCIDENT', undefined, e.name ? '端点 · ' + e.name : '端点');
  for (const entry of nearbyEntries(doc, viewId, p, threshold * 1.5, options)) {
    const e = entry.entity;
    if (!e) continue;
    for (const c of curvedSnapPositions(entry, p, origin, options))
      push(c.position, [e.id], c.kind, undefined, c.label, true, c.guide);
    if (entry.shape.kind !== 'line') continue;
    const a = entry.shape.line;
    if (objectSnapEnabled(options, 'perpendicular') && (origin || options.objectTypes)) {
      const from = origin ?? p,
        t = dot(sub(from, a.a), a.d) / dot(a.d, a.d);
      if (!a.finite || (t >= 0 && t <= 1)) {
        const contact = add(a.a, scale(a.d, t));
        const guide =
          options.lineRelations && origin
            ? {
                kind: 'perpendicular' as const,
                sourceId: e.id,
                origin: a.a,
                contact,
                direction: unit(a.d),
              }
            : undefined;
        if (!guide || !origin || distance(contact, origin) > samePosition)
          push(contact, [e.id], 'FOOT', undefined, '垂足 · ' + entry.name, true, guide);
      }
    }
    if (!options.objectTypes)
      push(foot(p, a), [e.id], 'POINT_ON_LINE', undefined, '线上点', e.viewId !== viewId);
    if (a.finite && objectSnapEnabled(options, 'midpoint'))
      push(add(a.a, scale(a.d, 0.5)), [e.id], 'MIDPOINT', undefined, '中点');
  }
  if (
    origin &&
    options.lineRelations &&
    options.direction !== false &&
    objectSnapEnabled(options, 'tangent')
  ) {
    for (const entry of nearbyEntries(doc, viewId, origin, 1e-8, options)) {
      const guide = tangentAtCircleOrigin(entry, origin);
      if (!guide) continue;
      const end = directionalEndpoint(
        origin,
        p,
        guide.direction,
        cssPixelsPerMm,
        options.previous?.guide?.sourceId === guide.sourceId && options.previous.kind === 'TANGENT',
      );
      if (end)
        push(end, [guide.sourceId], 'TANGENT', undefined, '沿切线 · ' + entry.name, true, guide);
    }
  }
  if (origin && options.direction !== false && options.objects !== false) {
    for (const { entity: e, shape } of index.entries) {
      if (
        !e ||
        shape.kind !== 'line' ||
        options.exclude?.includes(e.id) ||
        options.hiddenLayers?.includes(e.layerId)
      )
        continue;
      const a = shape.line;
      for (const kind of ['PARALLEL', 'PERPENDICULAR'] as const) {
        if (
          options.lineRelations &&
          kind === 'PERPENDICULAR' &&
          !objectSnapEnabled(options, 'perpendicular')
        )
          continue;
        const sourceDirection = unit(a.d);
        const direction =
          kind === 'PARALLEL' ? sourceDirection : { x: -sourceDirection.y, y: sourceDirection.x };
        const end = options.lineRelations
          ? directionalEndpoint(
              origin,
              p,
              direction,
              cssPixelsPerMm,
              options.previous?.kind === kind && options.previous.guide?.sourceId === e.id,
            )
          : add(origin, scale(direction, dot(sub(p, origin), direction)));
        if (!end) continue;
        const guide: SnapGuide | undefined = options.lineRelations
          ? {
              kind: kind === 'PARALLEL' ? 'parallel' : 'perpendicular',
              sourceId: e.id,
              origin: a.a,
              contact: foot(origin, kind === 'PERPENDICULAR' ? { ...a, finite: false } : a),
              direction: sourceDirection,
            }
          : undefined;
        push(
          end,
          [e.id],
          kind,
          undefined,
          kind === 'PARALLEL' ? '平行方向' : '垂直方向',
          e.viewId !== viewId,
          guide,
        );
      }
    }
  }
  if (options.projection && orthographic(doc)) {
    const derived = new Set(doc.auxiliarySystems?.map((a) => a.newViewId)),
      view = doc.views.find((v) => v.id === viewId)!;
    if (!derived.has(viewId))
      for (const e of doc.entities)
        if (
          e.kind === 'point' &&
          e.viewId !== viewId &&
          !derived.has(e.viewId) &&
          !options.exclude?.includes(e.id) &&
          !options.hiddenLayers?.includes(e.layerId)
        ) {
          const other = doc.views.find((v) => v.id === e.viewId)!;
          for (const axis of view.mapping.filter((a) => other.mapping.includes(a))) {
            const i = view.mapping.indexOf(axis),
              j = other.mapping.indexOf(axis),
              value = (j === 0 ? e.position.x : e.position.y) * other.signs[j] * view.signs[i];
            const twoPlane = doc.editorType === 'VH_PROJECTION';
            push(
              i === 0 ? { x: value, y: p.y } : { x: p.x, y: value },
              [e.id],
              'PROJECTION_ALIGNMENT',
              undefined,
              twoPlane ? 'V-H 长对正' : undefined,
              false,
              undefined,
              twoPlane
                ? [{ point: sheetToLocal(doc, viewId, localToSheet(doc, other.id, e.position)), direction: { x: 0, y: 1 } }]
                : undefined,
            );
          }
        }
  }
  const grid =
    options.gridSpacing !== undefined &&
    Number.isFinite(options.gridSpacing) &&
    options.gridSpacing >= 0.1 &&
    options.gridSpacing <= 100
      ? options.gridSpacing
      : doc.settings.grid;
  if (options.grid)
    push({ x: Math.round(p.x / grid) * grid, y: Math.round(p.y / grid) * grid }, [], 'GRID');
  if (origin && options.direction !== false)
    for (const axis of Object.values(viewAxes(doc, viewId))) {
      const d = unit(axis);
      push(add(origin, scale(d, dot(sub(p, origin), d))), [], 'AXIS_DIRECTION');
    }
  const previous = options.previous;
  // Recompute candidates at the current pointer. Never reuse a stale foot on a continuous axis.
  const priority = (c: SnapCandidate) =>
    c.kind === 'COINCIDENT' || c.kind === 'ENDPOINT' || c.kind === 'CENTER'
      ? 0
      : c.kind === 'ORIGIN'
        ? 0.05
        : c.kind === 'INTERSECTION'
          ? 0.2
          : c.kind === 'MIDPOINT' ||
              c.kind === 'QUADRANT' ||
              c.kind === 'TANGENT' ||
              (c.kind === 'FOOT' && !!c.guide)
            ? 0.4
            : c.kind === 'GRID'
              ? 1.4
              : c.kind === 'AXIS_DIRECTION'
                ? 1.6
                : 0.65;
  const featureRadius = Math.min(4 / cssPixelsPerMm, threshold * 0.4);
  const score = (candidate: SnapCandidate) => {
    const rank = priority(candidate);
    // Release a tracked line near a vertex, origin or intersection. Distances use CSS pixels.
    const preciseFeature = rank <= 0.2 && candidate.distance <= featureRadius;
    const trackingBonus = previous?.id === candidate.id ? 0.18 : 0;
    return (
      candidate.distance / threshold + rank * 0.4 - trackingBonus - (preciseFeature ? 0.35 : 0)
    );
  };
  // Equal directions may arise from several parallel edges. Prefer the
  // reference nearest the start, while retaining the tracked candidate above.
  const referenceDistance = (c: SnapCandidate) =>
    origin && c.guide ? distance(origin, c.guide.contact) : Infinity;
  const sorted = candidates.sort(
    (a, b) =>
      score(a) - score(b) ||
      (a.guide && b.guide
        ? referenceDistance(a) - referenceDistance(b) ||
          a.guide.sourceId.localeCompare(b.guide.sourceId)
        : 0),
  );
  const result: SnapCandidate[] = [];
  const guides = origin && options.lineRelations ? sorted.filter((c) => c.guide) : [];
  const features = guides.length
    ? sorted
        .filter((c) => pointFeatureOrder[c.kind] !== undefined)
        .sort((a, b) => pointFeatureOrder[a.kind]! - pointFeatureOrder[b.kind]!)
    : [];
  for (const candidate of sorted) {
    if (result.some((other) => distance(other.position, candidate.position) < samePosition))
      continue;
    // Keep the node/reference and its exact coordinates. A visual relation is
    // valid only if the segment to that unchanged feature actually satisfies it.
    const feature = features.find((f) => distance(f.position, candidate.position) < samePosition);
    const guide =
      feature && origin
        ? guides.find((c) => acceptsGuide(origin, feature.position, c))?.guide
        : undefined;
    const winner = feature && (candidate.guide || guide) ? feature : candidate;
    result.push(guide ? { ...winner, guide } : winner);
    if (result.length === 8) break;
  }
  return result;
}
export function confirmSnap(
  before: GeometryDocument,
  after: GeometryDocument,
  candidate: SnapCandidate,
  sourceId?: string,
  role: 'teacher' | 'student' = 'teacher',
) {
  if (candidate.positionOnly) return after;
  if (candidate.references && sourceId)
    return transact(
      after,
      (d) => {
        for (const [index, reference] of candidate.references!.entries())
          writeReferenceRelation(
            d,
            sourceId,
            reference,
            'POINT_ON_REFERENCE',
            'POSITION',
            'SNAP_CONFIRMED',
            index === 0,
          );
      },
      role,
    );
  if (candidate.reference && sourceId)
    return transact(
      after,
      (d) =>
        writeReferenceRelation(
          d,
          sourceId,
          candidate.reference!,
          'POINT_ON_REFERENCE',
          'POSITION',
          'SNAP_CONFIRMED',
        ),
      role,
    );
  if (!candidate.entityIds.length) return after;
  const ids = new Set(before.entities.map((e) => e.id));
  if (candidate.kind === 'PARALLEL' || candidate.kind === 'PERPENDICULAR') {
    const segment = after.entities.find((e) => e.kind === 'segment' && !ids.has(e.id));
    if (!segment) return after;
    return transact(after, (d) =>
      d.constraints.push({
        id: createId(),
        kind: candidate.kind as 'PARALLEL' | 'PERPENDICULAR',
        entityIds: [...candidate.entityIds, segment.id],
        source: 'SNAP_CONFIRMED',
        ...(after.schemaVersion === 'tuheng.geometry/2.0.0' ? { mode: 'POSITION' as const } : {}),
      }),
    );
  }
  const created = after.entities.find(
    (e) =>
      e.kind === 'point' &&
      (sourceId
        ? e.id === sourceId
        : !ids.has(e.id) && distance(e.position, candidate.position) < 1e-7),
  );
  if (!created) return after;
  if (candidate.kind === 'COINCIDENT')
    return mergePoints(after, created.id, candidate.entityIds[0], role);
  return transact(after, (d) =>
    d.constraints.push({
      id: createId(),
      kind: candidate.kind as 'MIDPOINT' | 'INTERSECTION' | 'POINT_ON_LINE' | 'PROJECTION_ALIGNMENT',
      entityIds: [created.id, ...candidate.entityIds],
      source: 'SNAP_CONFIRMED',
    }),
  );
}

/** Real intersections in sheet coordinates, including finite segments and valid axis rays. */
export function intersectionCandidates(
  doc: GeometryDocument,
  viewId: string,
  position: Vec2,
  pixels: number,
  options: Parameters<typeof snapCandidates>[5] = {},
): SnapCandidate[] {
  return geometricIntersections(doc, viewId, position, (options.threshold ?? 10) / pixels, options);
}
