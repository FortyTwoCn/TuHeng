import { GeometryTargetRef, type GeometryDocument, type Vec2 } from '@tuheng/contracts';
import { add, sub, dot, scale, unit, lineGeometry, clipLine, type Bounds } from './math';
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
    return GeometryTargetRef.parse({ kind: 'baseAxis', axisId: key.slice(5) });
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
      ? {
          X: { x: -1, y: 0 },
          Z: { x: 0, y: 1 },
          Y_H: { x: 0, y: -1 },
          Y_W: { x: 1, y: 0 },
          MITER_45: { x: 1, y: -1 },
        }
      : viewAxes(doc, doc.views[0].id);
    if (!directions[ref.axisId]) throw Error('基准轴不存在');
    return {
      ref,
      name: ref.axisId === 'MITER_45' ? '45° 传宽线' : `${ref.axisId} 轴`,
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
  const keys = orthographic(doc) ? (['X', 'Z', 'Y_H', 'Y_W', 'MITER_45'] as const) : (['x', 'y', 'z'] as const);
  const origins = doc.views.map((v) => resolveReference(doc, { kind: 'origin', frameId: v.id }));
  return [
    ...origins.filter(
      (r, i) =>
        origins.findIndex(
          (p) => Math.hypot(p.anchor.x - r.anchor.x, p.anchor.y - r.anchor.y) < 1e-9,
        ) === i,
    ),
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
  const absent = {
    selectable: false,
    snappable: false,
    referenceable: false,
    editable: false,
    deletable: false,
  };
  if (
    (ref.kind === 'origin' && !doc.views.some((v) => v.id === ref.frameId)) ||
    (ref.kind === 'projectionAxis' && !doc.auxiliarySystems?.some((a) => a.id === ref.systemId))
  )
    return absent;
  if (
    ref.kind === 'baseAxis' &&
    !(orthographic(doc) ? ['X', 'Z', 'Y_H', 'Y_W', 'MITER_45'] : ['x', 'y', 'z']).includes(ref.axisId)
  )
    return absent;
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
      snappable: ['point', 'segment', 'line', 'circle', 'arc', 'ellipse', 'curve'].includes(e.kind),
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
      !doc.auxiliarySystems?.some(
        (b) =>
          b.parentId === a?.id ||
          (b.referenceAxis?.kind === 'projectionAxis' && b.referenceAxis.systemId === a?.id),
      ) &&
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
export function clipReference(reference: ReferenceGeometry, box: Bounds): [Vec2, Vec2] | null {
  if (!reference.direction) return null;
  const d = reference.direction;
  const ends = clipLine({ a: reference.anchor, d, finite: reference.extent === 'segment' }, box);
  if (!ends || reference.extent !== 'ray') return ends;
  const t = ends.map((p) => dot(sub(p, reference.anchor), d) / dot(d, d));
  if (Math.max(...t) < 0) return null;
  return ends.map((p, i) => (t[i] < 0 ? reference.anchor : p)) as [Vec2, Vec2];
}
