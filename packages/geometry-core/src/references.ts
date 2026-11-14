import type { GeometryDocument, GeometryTargetRef, Vec2 } from '@tuheng/contracts';
import { add, sub, dot, scale, unit, lineGeometry } from './math';
import { localToSheet, orthographic, viewTransform } from './sheet';
import { viewAxes } from './projections';
export type ReferenceGeometry = {
  ref: GeometryTargetRef;
  name: string;
  anchor: Vec2;
  direction?: Vec2;
  extent: 'point' | 'ray' | 'line' | 'segment';
  viewId?: string;
};
export function referenceKey(ref: GeometryTargetRef) {
  return ref.kind === 'entity'
    ? ref.entityId
    : ref.kind === 'baseAxis'
      ? `axis:${ref.axisId}`
      : ref.kind === 'origin'
        ? `origin:${ref.frameId}`
        : `system:${ref.systemId}`;
}
export function targetFromKey(key: string): GeometryTargetRef {
  if (key.startsWith('axis:'))
    return {
      kind: 'baseAxis',
      axisId: key.slice(5) as Extract<GeometryTargetRef, { kind: 'baseAxis' }>['axisId'],
    };
  if (key.startsWith('origin:')) return { kind: 'origin', frameId: key.slice(7) };
  if (key.startsWith('system:')) return { kind: 'projectionAxis', systemId: key.slice(7) };
  return { kind: 'entity', entityId: key };
}
export function resolveReference(doc: GeometryDocument, ref: GeometryTargetRef): ReferenceGeometry {
  if (ref.kind === 'origin')
    return {
      ref,
      name:
        ref.frameId === doc.views[0].id
          ? '原点 O'
          : `原点 ${doc.views.find((v) => v.id === ref.frameId)?.name}`,
      anchor: viewTransform(doc, ref.frameId).origin,
      extent: 'point',
    };
  if (ref.kind === 'baseAxis') {
    const directions: Record<string, Vec2> = orthographic(doc)
      ? { X: { x: -1, y: 0 }, Z: { x: 0, y: 1 }, Y_H: { x: 0, y: -1 }, Y_W: { x: 1, y: 0 } }
      : viewAxes(doc, doc.views[0].id);
    if (!directions[ref.axisId]) throw Error('基准轴不存在');
    return {
      ref,
      name: `${ref.axisId} 轴`,
      anchor: doc.sheet?.origin ?? { x: 0, y: 0 },
      direction: unit(directions[ref.axisId]),
      extent: 'ray',
    };
  }
  if (ref.kind === 'projectionAxis') {
    const a = doc.auxiliarySystems?.find((a) => a.id === ref.systemId);
    if (!a) throw Error('投影轴不存在');
    return { ref, name: a.name, anchor: a.anchor, direction: a.tangent, extent: 'line' };
  }
  const e = doc.entities.find((e) => e.id === ref.entityId);
  if (!e) throw Error('参考对象不存在');
  if (e.kind === 'point')
    return {
      ref,
      name: e.name || '点',
      anchor: localToSheet(doc, e.viewId, e.position),
      extent: 'point',
      viewId: e.viewId,
    };
  if (e.kind !== 'segment' && e.kind !== 'line') throw Error('请选择线、轴或点');
  const l = lineGeometry(doc, e),
    a = localToSheet(doc, e.viewId, l.a),
    b = localToSheet(doc, e.viewId, add(l.a, l.d));
  return {
    ref,
    name: e.kind === 'line' ? '辅助线' : '线段',
    anchor: a,
    direction: sub(b, a),
    extent: l.finite ? 'segment' : 'line',
    viewId: e.viewId,
  };
}
export function referenceGeometry(doc: GeometryDocument) {
  const keys = orthographic(doc) ? (['X', 'Z', 'Y_H', 'Y_W'] as const) : (['x', 'y', 'z'] as const);
  return [
    resolveReference(doc, { kind: 'origin', frameId: doc.views[0].id }),
    ...keys.map((axisId) => resolveReference(doc, { kind: 'baseAxis', axisId })),
    ...(doc.auxiliarySystems ?? []).map((a) =>
      resolveReference(doc, { kind: 'projectionAxis', systemId: a.id }),
    ),
  ];
}
export function closestReference(p: Vec2, reference: ReferenceGeometry) {
  if (!reference.direction) return reference.anchor;
  const d = reference.direction,
    square = dot(d, d);
  if (square < 1e-14) throw Error('参考方向不能为零');
  let t = dot(sub(p, reference.anchor), d) / square;
  if (reference.extent === 'ray') t = Math.max(0, t);
  if (reference.extent === 'segment') t = Math.max(0, Math.min(1, t));
  return add(reference.anchor, scale(d, t));
}
export function targetCapabilities(
  doc: GeometryDocument,
  ref: GeometryTargetRef,
  role: 'teacher' | 'student',
  readOnly = false,
) {
  let editable = false,
    deletable = false;
  if (ref.kind === 'entity') {
    const e = doc.entities.find((e) => e.id === ref.entityId);
    if (!e)
      return {
        selectable: false,
        snappable: false,
        referenceable: false,
        editable: false,
        deletable: false,
      };
    editable =
      !(e.kind === 'plane' && e.legacyReadOnly) &&
      (role === 'teacher' || !e.lineStyle.startsWith('PROBLEM'));
    deletable = editable;
    return {
      selectable: true,
      snappable: ['point', 'segment', 'line'].includes(e.kind),
      referenceable: ['point', 'segment', 'line'].includes(e.kind),
      editable: editable && !readOnly,
      deletable: deletable && !readOnly,
    };
  }
  if (ref.kind === 'projectionAxis') {
    const a = doc.auxiliarySystems?.find((a) => a.id === ref.systemId);
    editable =
      !!a &&
      (role === 'teacher' ||
        (a.owner === 'STUDENT' && !a.locked && !!doc.sheet?.allowAuxiliaryViews));
    deletable =
      editable &&
      !doc.auxiliarySystems?.some((b) => b.parentId === a?.id) &&
      !doc.entities.some((e) => e.viewId === a?.newViewId) &&
      !doc.referenceRelations?.some(
        (r) => r.reference.kind === 'projectionAxis' && r.reference.systemId === a?.id,
      );
  }
  return {
    selectable: true,
    snappable: true,
    referenceable: ref.kind !== 'origin',
    editable: editable && !readOnly,
    deletable: deletable && !readOnly,
  };
}
