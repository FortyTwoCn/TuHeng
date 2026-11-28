import type { GeometryDocument, Vec2 } from '@tuheng/contracts';
import {
  commonTangentCandidates,
  nearestDraftingCandidate,
  trackingGuides,
  type TrackingBase,
} from './drafting-guides';
import { add, cross, distance, dot, scale, sub, unit } from './math';
import { shapeIntersections, type BoundaryShape } from './parametric-geometry';
import { referenceKey } from './references';
import {
  directionalEndpoint,
  extensionIntersections,
  nearbyEntries,
  objectSnapEnabled,
  type IndexEntry,
} from './snap-geometry';
import {
  interactionThresholds,
  isPointFeature,
  segmentSatisfiesGuide,
  snapCandidateSet,
  type SnapCandidate,
  type SnapOptions,
  type SnapTrack,
} from './snapping';
import { equalLengthSnaps } from './equal-length-snapping';

export interface DraftingSnapOptions extends SnapOptions {
  origins?: readonly Vec2[];
  enabled?: boolean;
  ortho?: boolean;
  trackingBases?: readonly TrackingBase[];
  equalLength?: boolean;
  commonTangent?: boolean;
  pairedTangent?: SnapCandidate['pairedTangent'];
  acceptsPoint?: (p: Vec2) => boolean;
  acceptsHoverPoint?: (p: Vec2) => boolean;
}

type Constraint = {
  track: SnapTrack;
  id: string;
  label: string;
};
type DirectionConstraint = Constraint & { ray: SnapCandidate };
type AlignmentConstraint = Constraint & { alignment: SnapCandidate };

const coincides = (a: Vec2, b: Vec2) => distance(a, b) < 1e-7;
const onTrack = ({ point, direction }: SnapTrack, p: Vec2) =>
  Math.abs(cross(sub(p, point), direction)) < 1e-8;
const lineOf = ({ point, direction }: SnapTrack): BoundaryShape => ({
  kind: 'line',
  line: { a: point, d: direction, finite: false },
});
const acceptsRay = (constraint: Constraint | DirectionConstraint, p: Vec2) =>
  !('ray' in constraint) ||
  (dot(sub(p, constraint.track.point), constraint.track.direction) > 1e-7 &&
    (!constraint.ray.guide ||
      segmentSatisfiesGuide(constraint.track.point, p, constraint.ray.guide)));

function rayFrom(point: Vec2, snap: SnapCandidate): DirectionConstraint | undefined {
  if (coincides(snap.position, point)) return;
  const direction = unit(sub(snap.position, point));
  const label = snap.guide
    ? { parallel: '平行', perpendicular: '垂直', tangent: '相切' }[snap.guide.kind]
    : Math.abs(direction.y) < 1e-8
      ? '水平'
      : Math.abs(direction.x) < 1e-8
        ? '竖直'
        : '轴向';
  return {
    track: { point, direction },
    ray: snap,
    label,
    id: `${snap.id ?? snap.kind}:${point.x},${point.y}:${label}`,
  };
}

function retainRays(rays: DirectionConstraint[], previous?: SnapCandidate) {
  const unique = new Map<string, DirectionConstraint>();
  for (const ray of rays) {
    const { point, direction } = ray.track;
    const key = `${point.x},${point.y}:${Math.atan2(direction.y, direction.x).toFixed(8)}`;
    const current = unique.get(key);
    if (
      !current ||
      (!current.ray.guide && ray.ray.guide) ||
      (ray.ray.guide && ray.ray.guide.sourceId === previous?.guide?.sourceId)
    )
      unique.set(key, ray);
  }
  return [...unique.values()];
}

function pairedTangent(
  doc: GeometryDocument,
  origin: Vec2,
  pointer: Vec2,
  radius: number,
  options: DraftingSnapOptions,
): SnapCandidate | undefined {
  if (!options.pairedTangent || !objectSnapEnabled(options, 'tangent')) return;
  const { sourceId, contact } = options.pairedTangent;
  const gap = distance(pointer, contact);
  if (
    gap > radius ||
    coincides(contact, origin) ||
    options.exclude?.includes(sourceId) ||
    !doc.entities.some((e) => e.id === sourceId && !options.hiddenLayers?.includes(e.layerId))
  )
    return;
  return {
    id: `TANGENT:${sourceId}:paired`,
    kind: 'TANGENT',
    label: '公切点',
    position: contact,
    entityIds: [sourceId],
    distance: gap,
    positionOnly: true,
    anchor: origin,
    guide: { kind: 'tangent', sourceId, origin, contact, direction: unit(sub(contact, origin)) },
  };
}

function mergeFeedback(snap: SnapCandidate, next: SnapCandidate): SnapCandidate {
  const tracks = [...(snap.tracks ?? [])];
  for (const track of next.tracks ?? []) {
    if (
      !tracks.some(
        (t) =>
          coincides(t.point, track.point) && Math.abs(cross(t.direction, track.direction)) < 1e-8,
      )
    )
      tracks.push(track);
  }
  return {
    ...snap,
    guide: snap.guide ?? next.guide,
    anchor: snap.guide ? snap.anchor : (next.anchor ?? snap.anchor),
    equalLength: snap.equalLength ?? next.equalLength,
    tracks: tracks.length ? tracks : undefined,
  };
}

function constrain(
  doc: GeometryDocument,
  viewId: string,
  pointer: Vec2,
  radius: number,
  options: SnapOptions,
  rays: readonly DirectionConstraint[],
  alignments: readonly AlignmentConstraint[],
  bases: readonly TrackingBase[],
  accepts: (p: Vec2) => boolean,
) {
  const { anchors, guides } = trackingGuides(doc, viewId, bases);
  const retained = guides
    .filter((g) => Math.abs(cross(sub(pointer, g.point), g.direction)) <= radius)
    .map((track): Constraint => ({
      track,
      label: track.label,
      id: `track:${track.point.x},${track.point.y}:${track.direction.x},${track.direction.y}`,
    }));
  type DraftingConstraint = DirectionConstraint | AlignmentConstraint | Constraint;
  const secondary = [...alignments, ...retained];
  const constraints: DraftingConstraint[] = [...rays, ...secondary];
  const candidates: SnapCandidate[] = [];
  const targets = constraints.length ? nearbyEntries(doc, viewId, pointer, radius, options) : [];
  function offer(
    a: DraftingConstraint,
    p: Vec2,
    id: string,
    b?: DraftingConstraint,
    target?: IndexEntry,
  ) {
    const gap = distance(p, pointer);
    const ray = 'ray' in a ? a : b && 'ray' in b ? b : undefined;
    const alignment =
      'alignment' in a ? a.alignment : b && 'alignment' in b ? b.alignment : undefined;
    if (
      gap > radius ||
      !accepts(p) ||
      !acceptsRay(a, p) ||
      (b && !acceptsRay(b, p)) ||
      (!ray && !alignment && anchors.some((q) => coincides(q, p)))
    )
      return;
    const directionSources =
      'ray' in a && b && 'ray' in b
        ? [...new Set([...a.ray.entityIds, ...b.ray.entityIds])]
        : undefined;
    candidates.push({
      id,
      kind: alignment && !target ? 'PROJECTION_ALIGNMENT' : 'TRACKING',
      composite: 'constraints',
      distance: gap,
      position: p,
      label: target
        ? ray || alignment
          ? `${a.label} ∩ ${target.name}`
          : target.entity
            ? '追踪交点'
            : `追踪交点 · ${target.name}`
        : b && (alignment || directionSources)
          ? `${a.label} ∩ ${b.label}`
          : '追踪交点',
      guide: ray?.ray.guide,
      anchor: ray?.track.point,
      entityIds: target?.entity
        ? [target.entity.id]
        : (alignment?.entityIds ?? directionSources ?? []),
      reference: target?.ref,
      positionOnly: !target && !alignment,
      tracks: b ? [b.track, a.track] : [a.track],
    });
  }
  for (const [i, a] of constraints.entries()) {
    const line = lineOf(a.track);
    const pairs =
      'ray' in a && rays[0].track.point === rays.at(-1)?.track.point
        ? secondary
        : constraints.slice(i + 1);
    for (const b of pairs) {
      if ('ray' in a && 'ray' in b && coincides(a.track.point, b.track.point)) continue;
      const [hit] = shapeIntersections(line, lineOf(b.track));
      if (hit) offer(a, hit.position, `${a.id}&${b.id}`, b);
    }
    for (const target of targets) {
      if (
        target.entity &&
        !('ray' in a) &&
        !('alignment' in a) &&
        !objectSnapEnabled(options, 'intersection')
      )
        continue;
      if (target.entity && 'ray' in a && a.ray.guide?.sourceId === target.entity.id) continue;
      for (const [index, hit] of shapeIntersections(line, target.shape).entries())
        if (!target.ray || hit.b >= -1e-8)
          offer(a, hit.position, `${a.id}&${referenceKey(target.ref)}:${index}`, undefined, target);
    }
  }
  const tracking = retained
    .flatMap(({ track, label }): SnapCandidate[] => {
      const p = add(
        track.point,
        scale(track.direction, dot(sub(pointer, track.point), track.direction)),
      );
      return accepts(p)
        ? [
            {
              kind: 'TRACKING',
              position: p,
              positionOnly: true,
              tracks: [track],
              distance: distance(p, pointer),
              entityIds: [],
              label,
            },
          ]
        : [];
    })
    .sort((a, b) => a.distance - b.distance)[0];
  return { candidates, tracking };
}

function bestIntersection(candidates: SnapCandidate[], radius: number, previous?: SnapCandidate) {
  const score = (snap: SnapCandidate) =>
    snap.distance / radius -
    (snap.id === previous?.id ? 0.12 : 0) -
    (snap.equalLength ? 0.12 : 0) -
    (snap.guide ? 0.06 : 0);
  return candidates.sort(
    (a, b) =>
      score(a) - score(b) ||
      Number(b.composite === 'extension') - Number(a.composite === 'extension') ||
      (a.id ?? '').localeCompare(b.id ?? ''),
  )[0];
}

/** CAD picks and edits share the same constraint intersections, tolerances and priorities. */
export function solveDraftingSnap(
  doc: GeometryDocument,
  viewId: string,
  pointer: Vec2,
  pixels: number,
  options: DraftingSnapOptions = {},
): { position: Vec2; candidate?: SnapCandidate; hoverFeature?: SnapCandidate } {
  const { origins = [], ortho, previous, acceptsHoverPoint } = options;
  const origin = origins[0];
  const horizontal = !origin || Math.abs(pointer.x - origin.x) >= Math.abs(pointer.y - origin.y);
  const position =
    ortho && origin
      ? horizontal
        ? { x: pointer.x, y: origin.y }
        : { x: origin.x, y: pointer.y }
      : pointer;
  if (options.enabled === false) return { position };
  const accepts = (p: Vec2) =>
    (!options.acceptsPoint || options.acceptsPoint(p)) &&
    (!ortho || !origin || Math.abs(horizontal ? p.y - origin.y : p.x - origin.x) < 1e-8);
  const radius = (options.threshold ?? 10) / pixels;
  const settings = { ...options, lineRelations: true };
  // Reuse the same point features whenever the draft query is at the actual pointer.
  const atPointer = position.x === pointer.x && position.y === pointer.y;
  const sets = (origins.length ? origins : [undefined]).map((anchor, i) =>
    snapCandidateSet(
      doc,
      viewId,
      position,
      pixels,
      anchor,
      settings,
      accepts,
      atPointer && i === 0 ? acceptsHoverPoint : undefined,
    ),
  );
  const { ordinary, precise } = sets[0];
  const hoverFeature =
    acceptsHoverPoint && !atPointer
      ? snapCandidateSet(
          doc,
          viewId,
          pointer,
          pixels,
          undefined,
          { ...options, previous: undefined },
          undefined,
          acceptsHoverPoint,
        ).hoverFeature
      : sets[0].hoverFeature;
  const paired = origin ? pairedTangent(doc, origin, position, radius, settings) : undefined;
  const rays = origins.flatMap((anchor, i) =>
    sets[i].directions.flatMap((c) => {
      const ray = rayFrom(anchor, c);
      if (
        ray &&
        (c.kind !== 'AXIS_DIRECTION' ||
          directionalEndpoint(anchor, position, ray.track.direction, pixels, false))
      )
        return [ray];
      return [];
    }),
  );
  if (ortho && origin) {
    const locked = rayFrom(origin, {
      kind: 'AXIS_DIRECTION',
      position,
      entityIds: [],
      distance: 0,
    });
    if (locked) rays.push(locked);
  }
  if (paired && origin && options.direction !== false) {
    const ray = rayFrom(origin, paired);
    if (ray) rays.push(ray);
  }
  const active = retainRays(
    rays.filter((ray) => accepts(ray.ray.position)),
    previous,
  );
  const alignments = sets[0].alignments.map((alignment): AlignmentConstraint => ({
    alignment,
    track: alignment.tracks![0],
    label: alignment.label!,
    id: alignment.id!,
  }));
  const bases =
    options.trackingBases && (options.direction !== false || ortho)
      ? [...options.trackingBases, ...origins.map((p) => ({ position: p }))]
      : (options.trackingBases ?? []);
  const { candidates, tracking } = constrain(
    doc,
    viewId,
    position,
    radius,
    settings,
    active,
    alignments,
    bases,
    accepts,
  );
  // Keep virtual crossings under the same screen radius on coarse pointers.
  const extensionRadius = Math.min(radius, interactionThresholds.mouse.snap / pixels);
  for (const extension of extensionIntersections(doc, viewId, pointer, extensionRadius, settings))
    if (accepts(extension.position))
      candidates.push(
        ordinary.find(
          (snap) => snap.kind === 'INTERSECTION' && coincides(snap.position, extension.position),
        ) ?? extension,
      );
  if (origin && options.equalLength && options.objects !== false)
    candidates.push(
      ...equalLengthSnaps(
        doc,
        viewId,
        position,
        radius,
        settings,
        active.map((r) => ({ track: r.track, snap: r.ray })),
        options.trackingBases ?? [],
        accepts,
      ),
    );
  const weak = (c?: SnapCandidate) =>
    !c || c.kind === 'AXIS_DIRECTION' || c.kind === 'AXIS' || c.kind === 'GRID';
  const intersection = bestIntersection(candidates, radius, previous);
  // The analytic contact of a common tangent is also the exact root on the second circle.
  const commonContact =
    paired &&
    accepts(paired.position) &&
    (!intersection ||
      coincides(intersection.position, paired.position) ||
      (intersection.guide?.kind === 'tangent' &&
        intersection.entityIds.includes(paired.entityIds[0])));
  let candidate = precise ?? (commonContact ? paired : (intersection ?? ordinary[0]));
  if (options.commonTangent && (weak(candidate) || candidate?.kind === 'FOOT'))
    candidate = commonTangentCandidates(doc, viewId, position, radius, settings)[0] ?? candidate;
  if (weak(candidate))
    candidate =
      tracking ??
      nearestDraftingCandidate(doc, viewId, position, radius, settings, accepts) ??
      candidate;
  if (candidate) {
    for (const match of candidates)
      if (match !== candidate && coincides(match.position, candidate.position))
        candidate = mergeFeedback(candidate, match);
    if (tracking && tracking !== candidate && coincides(tracking.position, candidate.position))
      candidate = mergeFeedback(candidate, tracking);
    const ray = active.find(
      (r) => onTrack(r.track, candidate!.position) && acceptsRay(r, candidate!.position),
    );
    if (ray)
      candidate = mergeFeedback(candidate, {
        ...ray.ray,
        anchor: ray.track.point,
        tracks: isPointFeature(candidate) ? [ray.track] : undefined,
      });
    if (candidate.guide && !candidate.anchor) {
      const anchor = origins.find((p) =>
        segmentSatisfiesGuide(p, candidate!.position, candidate!.guide!),
      );
      candidate = { ...candidate, anchor };
    }
  }
  return { position: candidate?.position ?? position, candidate, hoverFeature };
}

export function trackingCandidate(
  doc: GeometryDocument,
  viewId: string,
  pointer: Vec2,
  bases: readonly TrackingBase[],
  radius: number,
  options: SnapOptions,
  accepts: (p: Vec2) => boolean = () => true,
) {
  const { candidates, tracking } = constrain(
    doc,
    viewId,
    pointer,
    radius,
    options,
    [],
    [],
    bases,
    accepts,
  );
  const hit = bestIntersection(candidates, radius, options.previous);
  return hit
    ? { ...hit, tracks: hit.tracks!, intersection: true }
    : tracking && { ...tracking, tracks: tracking.tracks!, intersection: false };
}
