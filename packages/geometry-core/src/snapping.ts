import { createId } from '@tuheng/contracts';
import type { GeometryDocument, Vec2, GeometryTargetRef } from '@tuheng/contracts';
import { add, distance, foot, intersect, lineGeometry, scale, sub, dot, unit } from './math';
import { viewAxes } from './projections';
import { mergePoints } from './topology';
import { transact } from './document';
import { referenceGeometry, referenceKey, closestReference, resolveReference } from './references';
import { localToSheet, sheetToLocal } from './sheet';
import { writeReferenceRelation } from './reference-relations';
export const interactionThresholds = {
  mouse: { drag: 4, snap: 10, hit: 10 },
  pen: { drag: 3, snap: 12, hit: 12 },
  touch: { drag: 7, snap: 16, hit: 18 },
};
export interface SnapCandidate {
  id?: string;
  label?: string;
  reference?: GeometryTargetRef;
  references?: GeometryTargetRef[];
  position: Vec2;
  entityIds: string[];
  kind:
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
}
export function snapCandidates(
  doc: GeometryDocument,
  viewId: string,
  p: Vec2,
  cssPixelsPerMm: number,
  origin?: Vec2,
  options: {
    exclude?: string[];
    hiddenLayers?: string[];
    grid?: boolean;
    projection?: boolean;
    threshold?: number;
    previous?: SnapCandidate;
    axes?: boolean;
  } = {},
): SnapCandidate[] {
  const threshold = (options.threshold ?? 10) / cssPixelsPerMm,
    candidates: SnapCandidate[] = [];
  const push = (
    position: Vec2,
    entityIds: string[],
    kind: SnapCandidate['kind'],
    reference?: GeometryTargetRef,
    label?: string,
  ) => {
    const d = distance(position, p);
    const id = reference ? `${kind}:${referenceKey(reference)}` : `${kind}:${entityIds.join(',')}`;
    if (d <= threshold * (options.previous?.id === id ? 1.5 : 1))
      candidates.push({ id, position, entityIds, kind, distance: d, reference, label });
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
  const entities = doc.entities.filter(
      (e) =>
        e.viewId === viewId &&
        !options.exclude?.includes(e.id) &&
        !options.hiddenLayers?.includes(e.layerId),
    ),
    lines = entities.filter((e) => e.kind === 'line' || e.kind === 'segment');
  for (const e of entities) if (e.kind === 'point') push(e.position, [e.id], 'COINCIDENT');
  for (let i = 0; i < lines.length; i++) {
    const e = lines[i],
      a = lineGeometry(doc, e);
    if (origin) {
      for (const kind of ['PARALLEL', 'PERPENDICULAR'] as const) {
        const direction = unit(kind === 'PARALLEL' ? a.d : { x: -a.d.y, y: a.d.x });
        push(add(origin, scale(direction, dot(sub(p, origin), direction))), [e.id], kind);
      }
    }
    push(foot(p, a), [e.id], 'POINT_ON_LINE');
    if (a.finite) push(add(a.a, scale(a.d, 0.5)), [e.id], 'MIDPOINT');
  }
  if (options.projection && ['VHW_PROJECTION', 'THREE_VIEW'].includes(doc.editorType)) {
    const derived = new Set(doc.auxiliarySystems?.map((a) => a.newViewId)),
      view = doc.views.find((v) => v.id === viewId)!;
    if (!derived.has(viewId))
      for (const e of doc.entities)
        if (
          e.kind === 'point' &&
          e.viewId !== viewId &&
          !derived.has(e.viewId) &&
          !options.hiddenLayers?.includes(e.layerId)
        ) {
          const other = doc.views.find((v) => v.id === e.viewId)!;
          for (const axis of view.mapping.filter((a) => other.mapping.includes(a))) {
            const i = view.mapping.indexOf(axis),
              j = other.mapping.indexOf(axis),
              value = (j === 0 ? e.position.x : e.position.y) * other.signs[j] * view.signs[i];
            push(
              i === 0 ? { x: value, y: p.y } : { x: p.x, y: value },
              [e.id],
              'PROJECTION_ALIGNMENT',
            );
          }
        }
  }
  const grid = doc.settings.grid;
  if (options.grid)
    push({ x: Math.round(p.x / grid) * grid, y: Math.round(p.y / grid) * grid }, [], 'GRID');
  if (origin)
    for (const axis of Object.values(viewAxes(doc, viewId))) {
      const d = unit(axis);
      push(add(origin, scale(d, dot(sub(p, origin), d))), [], 'AXIS_DIRECTION');
    }
  const previous = options.previous;
  // Recompute candidates at the current pointer. Never reuse a stale foot on a continuous axis.
  const priority = (c: SnapCandidate) =>
    c.kind === 'COINCIDENT'
      ? 0
      : c.kind === 'ORIGIN'
        ? 0.05
        : c.kind === 'INTERSECTION'
          ? 0.2
          : c.kind === 'MIDPOINT'
            ? 0.4
            : c.kind === 'GRID'
              ? 1.4
              : c.kind === 'AXIS_DIRECTION'
                ? 1.6
                : 0.65;
  const sticky = (c: SnapCandidate) => (previous && c.id === previous.id ? -0.18 : 0);
  const sorted = candidates.sort(
    (a, b) =>
      a.distance / threshold +
      priority(a) * 0.4 +
      sticky(a) -
      (b.distance / threshold + priority(b) * 0.4 + sticky(b)),
  );
  return sorted
    .filter((c, i) => !sorted.slice(0, i).some((p) => distance(c.position, p.position) < 1e-7))
    .slice(0, 8);
}
export function confirmSnap(
  before: GeometryDocument,
  after: GeometryDocument,
  candidate: SnapCandidate,
  sourceId?: string,
  role: 'teacher' | 'student' = 'teacher',
) {
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
      kind: candidate.kind as 'COINCIDENT' | 'MIDPOINT' | 'INTERSECTION' | 'POINT_ON_LINE',
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
  const p = localToSheet(doc, viewId, position),
    threshold = (options.threshold ?? 10) / pixels;
  const references = [
    ...(options.axes === false ? [] : referenceGeometry(doc).filter((r) => r.direction)),
    ...doc.entities
      .filter(
        (e) =>
          (e.viewId === viewId || e.scope === 'SHEET') &&
          ['line', 'segment'].includes(e.kind) &&
          !options.exclude?.includes(e.id) &&
          !options.hiddenLayers?.includes(e.layerId),
      )
      .map((e) => resolveReference(doc, { kind: 'entity', entityId: e.id })),
  ].filter((r) => distance(p, closestReference(p, r)) <= threshold * 1.5);
  const result: SnapCandidate[] = [];
  for (let i = 0; i < references.length; i++)
    for (let j = i + 1; j < references.length; j++) {
      const a = references[i],
        b = references[j];
      if (!a.direction || !b.direction) continue;
      const q = intersect(
        { a: a.anchor, d: a.direction, finite: a.extent === 'segment' },
        { a: b.anchor, d: b.direction, finite: b.extent === 'segment' },
      );
      if (
        !q ||
        distance(q, closestReference(q, a)) > 1e-7 ||
        distance(q, closestReference(q, b)) > 1e-7
      )
        continue;
      const d = distance(p, q);
      const refs = [a.ref, b.ref].sort((a, b) => referenceKey(a).localeCompare(referenceKey(b)));
      const id = 'INTERSECTION:' + refs.map(referenceKey).join(',');
      if (d > threshold * (options.previous?.id === id ? 1.5 : 1)) continue;
      const legacy =
        a.ref.kind === 'entity' &&
        b.ref.kind === 'entity' &&
        a.viewId === viewId &&
        b.viewId === viewId;
      result.push({
        id,
        kind: 'INTERSECTION',
        label: `交点 · ${a.name} / ${b.name}`,
        position: sheetToLocal(doc, viewId, q),
        distance: d,
        entityIds: legacy ? refs.flatMap((r) => (r.kind === 'entity' ? [r.entityId] : [])) : [],
        ...(legacy ? {} : { references: refs }),
      });
    }
  return result
    .sort((a, b) => a.distance - b.distance || a.id!.localeCompare(b.id!))
    .filter((c, i, all) => !all.slice(0, i).some((p) => distance(p.position, c.position) < 1e-7));
}
