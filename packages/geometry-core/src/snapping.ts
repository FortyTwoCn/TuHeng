import type { GeometryDocument, Vec2 } from '@tuheng/contracts';
import { add, distance, foot, intersect, lineGeometry, scale, sub, dot, unit } from './math';
import { viewAxes } from './projections';
import { mergePoints } from './topology';
import { transact } from './document';
export interface SnapCandidate {
  position: Vec2;
  entityIds: string[];
  kind:
    | 'COINCIDENT'
    | 'MIDPOINT'
    | 'INTERSECTION'
    | 'POINT_ON_LINE'
    | 'GRID'
    | 'AXIS'
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
  } = {},
): SnapCandidate[] {
  const threshold = (options.threshold ?? 10) / cssPixelsPerMm,
    candidates: SnapCandidate[] = [];
  const push = (position: Vec2, entityIds: string[], kind: SnapCandidate['kind']) => {
    const d = distance(position, p);
    if (d <= threshold) candidates.push({ position, entityIds, kind, distance: d });
  };
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
    for (const other of lines.slice(i + 1)) {
      const at = intersect(a, lineGeometry(doc, other));
      if (at) push(at, [e.id, other.id], 'INTERSECTION');
    }
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
      push(add(origin, scale(d, dot(sub(p, origin), d))), [], 'AXIS');
    }
  const previous = options.previous;
  if (
    previous &&
    distance(previous.position, p) <= threshold * 1.5 &&
    previous.entityIds.every((id) => entities.some((e) => e.id === id))
  )
    candidates.push({ ...previous, distance: distance(previous.position, p) });
  const priority = (c: SnapCandidate) =>
    c.kind === 'COINCIDENT'
      ? 0
      : c.kind === 'INTERSECTION'
        ? 1
        : c.kind === 'MIDPOINT'
          ? 2
          : c.kind === 'GRID'
            ? 5
            : 3;
  const sticky = (c: SnapCandidate) =>
    previous && c.kind === previous.kind && c.entityIds.join(',') === previous.entityIds.join(',')
      ? -1
      : 0;
  return candidates
    .sort((a, b) => priority(a) - priority(b) || sticky(a) - sticky(b) || a.distance - b.distance)
    .slice(0, 8);
}
export function confirmSnap(
  before: GeometryDocument,
  after: GeometryDocument,
  candidate: SnapCandidate,
  sourceId?: string,
  role: 'teacher' | 'student' = 'teacher',
) {
  if (!candidate.entityIds.length) return after;
  const ids = new Set(before.entities.map((e) => e.id));
  if (candidate.kind === 'PARALLEL' || candidate.kind === 'PERPENDICULAR') {
    const segment = after.entities.find((e) => e.kind === 'segment' && !ids.has(e.id));
    if (!segment) return after;
    return transact(after, (d) =>
      d.constraints.push({
        id: crypto.randomUUID(),
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
      id: crypto.randomUUID(),
      kind: candidate.kind as 'COINCIDENT' | 'MIDPOINT' | 'INTERSECTION' | 'POINT_ON_LINE',
      entityIds: [created.id, ...candidate.entityIds],
      source: 'SNAP_CONFIRMED',
    }),
  );
}
