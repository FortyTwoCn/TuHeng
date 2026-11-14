import type { GeometryDocument, Vec2 } from '@tuheng/contracts';
import { add, distance, foot, intersect, lineGeometry, scale, sub, dot, unit } from './math';
import { projectionAxes } from './projections';
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
    | 'PERPENDICULAR';
  distance: number;
}
export function snapCandidates(
  doc: GeometryDocument,
  viewId: string,
  p: Vec2,
  cssPixelsPerMm: number,
  origin?: Vec2,
): SnapCandidate[] {
  const threshold = 12 / cssPixelsPerMm,
    candidates: SnapCandidate[] = [];
  const push = (position: Vec2, entityIds: string[], kind: SnapCandidate['kind']) => {
    const d = distance(position, p);
    if (d <= threshold) candidates.push({ position, entityIds, kind, distance: d });
  };
  const entities = doc.entities.filter((e) => e.viewId === viewId),
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
  const grid = doc.settings.grid;
  push({ x: Math.round(p.x / grid) * grid, y: Math.round(p.y / grid) * grid }, [], 'GRID');
  if (origin)
    for (const axis of Object.values(projectionAxes(doc))) {
      const d = unit(axis);
      push(add(origin, scale(d, dot(sub(p, origin), d))), [], 'AXIS');
    }
  return candidates
    .sort((a, b) => a.distance - b.distance || a.kind.localeCompare(b.kind))
    .slice(0, 8);
}
export function confirmSnap(
  before: GeometryDocument,
  after: GeometryDocument,
  candidate: SnapCandidate,
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
      }),
    );
  }
  const created = after.entities.find(
    (e) => e.kind === 'point' && !ids.has(e.id) && distance(e.position, candidate.position) < 1e-7,
  );
  if (!created) return after;
  return transact(after, (d) =>
    d.constraints.push({
      id: crypto.randomUUID(),
      kind: candidate.kind as 'COINCIDENT' | 'MIDPOINT' | 'INTERSECTION' | 'POINT_ON_LINE',
      entityIds: [created.id, ...candidate.entityIds],
      source: 'SNAP_CONFIRMED',
    }),
  );
}
