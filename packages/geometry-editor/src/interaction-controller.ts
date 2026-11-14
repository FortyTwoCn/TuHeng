import type { GeometryDocument, Vec2 } from '@tuheng/contracts';
import {
  distance,
  hitDistance,
  localBounds,
  sheetToLocal,
  sheetDeltaToLocal,
  moveEntities,
  pointReferences,
  type Bounds,
} from '@tuheng/geometry-core';
export type InteractionState =
  | 'idle'
  | 'pressed'
  | 'draggingPoint'
  | 'draggingEndpoint'
  | 'draggingSelection'
  | 'panning'
  | 'drawingStroke'
  | 'pinching'
  | 'movingRuler';
export interface Hit {
  id: string;
  kind: 'point' | 'endpoint' | 'body';
  viewId: string;
}
export function hitTarget(
  doc: GeometryDocument,
  p: Vec2,
  scale: number,
  box: Bounds,
  hidden: string[],
  selected: string[],
): Hit | undefined {
  const visible = doc.entities.filter((e) => !hidden.includes(e.layerId));
  const points = visible
    .filter((e) => e.kind === 'point')
    .map((e) => ({
      e,
      d: e.kind === 'point' ? distance(e.position, sheetToLocal(doc, e.viewId, p)) : Infinity,
    }))
    .filter((v) => v.d * scale < 10);
  const preferred = (id: string) =>
    selected.includes(id) ||
    doc.entities.some((e) => selected.includes(e.id) && pointReferences(e).includes(id));
  points.sort((a, b) => Number(preferred(b.e.id)) - Number(preferred(a.e.id)) || a.d - b.d);
  if (points[0]) {
    const e = points[0].e;
    return {
      id: e.id,
      viewId: e.viewId,
      kind: doc.entities.some((v) => pointReferences(v).includes(e.id)) ? 'endpoint' : 'point',
    };
  }
  const body = visible
    .filter((e) => e.kind !== 'point')
    .map((e) => ({
      e,
      d: hitDistance(doc, e, sheetToLocal(doc, e.viewId, p), localBounds(doc, e.viewId, box)),
    }))
    .filter((v) => v.d * scale < 8)
    .sort((a, b) => a.d - b.d)[0]?.e;
  return body ? { id: body.id, viewId: body.viewId, kind: 'body' } : undefined;
}
export function movingIds(doc: GeometryDocument, ids: string[]) {
  const points = new Set(ids);
  for (const e of doc.entities.filter((e) => points.has(e.id)))
    for (const p of pointReferences(e)) points.add(p);
  const excluded = new Set(points);
  for (const e of doc.entities)
    if (pointReferences(e).some((id) => points.has(id))) excluded.add(e.id);
  return [...excluded];
}
export function dragDocument(
  base: GeometryDocument,
  ids: string[],
  delta: Vec2,
  role: 'teacher' | 'student',
) {
  // One point is transformed once, even if selected through several incident lines.
  const targets = new Set(ids);
  for (const e of base.entities.filter((e) => targets.has(e.id)))
    for (const p of pointReferences(e)) targets.add(p);
  let next = base;
  for (const view of base.views) {
    const local = base.entities.filter((e) => e.viewId === view.id && targets.has(e.id));
    next = moveEntities(
      next,
      local.map((e) => e.id),
      sheetDeltaToLocal(base, view.id, delta),
      role,
    );
  }
  return next;
}
