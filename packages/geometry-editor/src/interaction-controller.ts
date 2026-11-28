import type { GeometryDocument, Vec2 } from '@tuheng/contracts';
import {
  distance,
  hitDistance,
  localBounds,
  sheetToLocal,
  sheetDeltaToLocal,
  moveEntities,
  pointReferences,
  referenceGeometry,
  referenceKey,
  closestReference,
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
export type SessionInteraction =
  | InteractionState
  | 'marqueeSelecting'
  | 'drawingPrimitive'
  | 'pickingReference'
  | 'placingParallel'
  | 'placingPerpendicular'
  | 'placingAxis'
  | 'editingProperties';
export interface Hit {
  id: string;
  kind: 'point' | 'endpoint' | 'body' | 'reference';
  viewId: string;
}
export function hitTarget(
  doc: GeometryDocument,
  p: Vec2,
  scale: number,
  box: Bounds,
  hidden: string[],
  selected: string[],
  axes = true,
  threshold = 10,
): Hit | undefined {
  return hitTargets(doc, p, scale, box, hidden, selected, axes, threshold)[0];
}
export function hitTargets(
  doc: GeometryDocument,
  p: Vec2,
  scale: number,
  box: Bounds,
  hidden: string[],
  selected: string[],
  axes = true,
  threshold = 10,
): Hit[] {
  const visible = doc.entities.filter((e) => !hidden.includes(e.layerId));
  const points = visible
    .filter((e) => e.kind === 'point')
    .map((e) => ({
      e,
      d: e.kind === 'point' ? distance(e.position, sheetToLocal(doc, e.viewId, p)) : Infinity,
    }))
    .filter((v) => v.d * scale < threshold);
  const preferred = (id: string) =>
    selected.includes(id) ||
    doc.entities.some((e) => selected.includes(e.id) && pointReferences(e).includes(id));
  points.sort((a, b) => Number(preferred(b.e.id)) - Number(preferred(a.e.id)) || a.d - b.d);
  const pointHits = points.map(({ e, d }) => ({
    d: d * scale,
    hit: {
      id: e.id,
      viewId: e.viewId,
      kind: doc.entities.some((v) => pointReferences(v).includes(e.id)) ? 'endpoint' : 'point',
    } satisfies Hit,
  }));
  const body = visible
    .filter((e) => e.kind !== 'point')
    .map((e) => ({
      e,
      d: hitDistance(doc, e, sheetToLocal(doc, e.viewId, p), localBounds(doc, e.viewId, box)),
    }))
    .filter((v) => v.d * scale < threshold)
    .sort((a, b) =>
      Math.abs(a.d - b.d) < 1e-8
        ? Number(selected.includes(b.e.id)) - Number(selected.includes(a.e.id))
        : a.d - b.d,
    );
  // 触摸命中区较大。明确命中线身时，优先允许整段移动，避免被较远的端点抢占。
  const coreRadius = Math.max(4, threshold * 0.42);
  const nearBody = body.length && body[0].d * scale <= 2;
  const first = pointHits.filter((v) => !nearBody || v.d <= coreRadius);
  const others = pointHits.filter((v) => nearBody && v.d > coreRadius);
  const hits: Hit[] = [
    ...first.map((v) => v.hit),
    ...body.map(({ e }) => ({ id: e.id, viewId: e.viewId, kind: 'body' as const })),
    ...others.map((v) => v.hit),
  ];
  if (axes)
    hits.push(
      ...referenceGeometry(doc)
        .filter((r) => distance(p, closestReference(p, r)) * scale < threshold)
        .map((r) => ({
          id: referenceKey(r.ref),
          viewId: doc.views[0].id,
          kind: 'reference' as const,
        })),
    );
  return hits;
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
  // 多根选中线段引用同一点时，只变换一次该节点。
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
