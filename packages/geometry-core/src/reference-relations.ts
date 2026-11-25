import { createId } from '@tuheng/contracts';
import type {
  GeometryDocument,
  GeometryTargetRef,
  ReferenceRelation,
  Vec2,
} from '@tuheng/contracts';
import { closestReference, resolveReference, referenceKey } from './references';
import { localToSheet, sheetToLocal, sheetDeltaToLocal } from './sheet';
import { add, scale, unit, lineGeometry, distance, dot, cross } from './math';
export function referenceRelationGeometry(doc: GeometryDocument, r: ReferenceRelation) {
  const e = doc.entities.find((e) => e.id === r.targetId);
  if (!e) throw Error('关系目标不存在');
  const ref = resolveReference(doc, r.reference);
  if (r.kind === 'POINT_ON_REFERENCE' && e.kind === 'point') {
    const p = localToSheet(doc, e.viewId, e.position),
      next = closestReference(p, ref);
    return {
      valid: distance(p, next) <= doc.settings.tolerance,
      pointId: e.id,
      position: sheetToLocal(doc, e.viewId, next),
    };
  }
  if (r.kind === 'THROUGH_POINT' && e.kind === 'line')
    return {
      valid: distance(localToSheet(doc, e.viewId, e.anchor), ref.anchor) <= doc.settings.tolerance,
      lineId: e.id,
      anchor: sheetToLocal(doc, e.viewId, ref.anchor),
    };
  if (!ref.direction || !['segment', 'line'].includes(e.kind)) throw Error('方向关系需要线或轴');
  const l = lineGeometry(doc, e),
    d = unit(sheetDeltaToLocal(doc, e.viewId, ref.direction));
  const direction = r.kind === 'PERPENDICULAR' ? { x: -d.y, y: d.x } : d;
  const orient = dot(l.d, direction) < 0 ? scale(direction, -1) : direction;
  const valid = Math.abs(cross(unit(l.d), orient)) < 0.001;
  return e.kind === 'segment'
    ? { valid, pointId: e.endPoint, position: add(l.a, scale(orient, Math.hypot(l.d.x, l.d.y))) }
    : { valid, lineId: e.id, direction: orient };
}
export function writeReferenceRelation(
  doc: GeometryDocument,
  targetId: string,
  reference: GeometryTargetRef,
  kind: ReferenceRelation['kind'],
  mode: ReferenceRelation['mode'],
  source: ReferenceRelation['source'] = 'USER',
  replacePosition = true,
) {
  if (doc.schemaVersion === 'tuheng.geometry/2.0.0') doc.schemaVersion = 'tuheng.geometry/2.1.0';
  doc.referenceRelations ??= [];
  // A new explicit placement replaces the previous observation of the same kind, not unrelated bindings.
  doc.referenceRelations = doc.referenceRelations.filter(
    (r) =>
      !(
        r.targetId === targetId &&
        r.kind === kind &&
        r.mode === 'POSITION' &&
        (replacePosition || referenceKey(r.reference) === referenceKey(reference))
      ),
  );
  doc.referenceRelations.push({ id: createId(), targetId, reference, kind, mode, source });
}
export function applyReferenceResult(
  doc: GeometryDocument,
  result: ReturnType<typeof referenceRelationGeometry>,
) {
  if ('pointId' in result) {
    const p = doc.entities.find((e) => e.id === result.pointId);
    if (p?.kind === 'point' && result.position) {
      if (p.lineStyle.startsWith('PROBLEM')) throw Error('绑定不能移动题干');
      p.position = result.position;
      p.spatial = null;
    }
  }
  if ('lineId' in result) {
    const l = doc.entities.find((e) => e.id === result.lineId);
    if (l?.kind === 'line') {
      if (l.lineStyle.startsWith('PROBLEM')) throw Error('绑定不能移动题干');
      if ('anchor' in result && result.anchor) l.anchor = result.anchor;
      if ('direction' in result && result.direction) l.direction = result.direction;
    }
  }
}
export function referenceDependencyIds(
  doc: GeometryDocument,
  reference: GeometryTargetRef,
): string[] {
  if (reference.kind !== 'entity') return [];
  const e = doc.entities.find((e) => e.id === reference.entityId);
  return e?.kind === 'segment' ? [e.id, e.startPoint, e.endPoint] : [reference.entityId];
}
export function referenceDirection(
  doc: GeometryDocument,
  viewId: string,
  reference: GeometryTargetRef,
  mode: 'PARALLEL' | 'PERPENDICULAR',
): Vec2 {
  const ref = resolveReference(doc, reference);
  if (!ref.direction) throw Error('请选择线或轴作为参考');
  const e =
    reference.kind === 'entity' ? doc.entities.find((e) => e.id === reference.entityId) : undefined;
  if (e && e.viewId !== viewId && e.scope !== 'SHEET') throw Error('方向关系不能跨投影框架');
  const d = sheetDeltaToLocal(doc, viewId, ref.direction);
  return unit(mode === 'PARALLEL' ? d : { x: -d.y, y: d.x });
}
