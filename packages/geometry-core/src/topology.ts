import { createId } from '@tuheng/contracts';
import type { GeometryDocument } from '@tuheng/contracts';
import { editable, pointReferences, transact } from './document';

export function mergePoints(
  doc: GeometryDocument,
  sourceId: string,
  targetId: string,
  role: 'teacher' | 'student',
) {
  if (sourceId === targetId) return doc;
  const source = doc.entities.find((e) => e.id === sourceId),
    target = doc.entities.find((e) => e.id === targetId);
  if (source?.kind !== 'point' || target?.kind !== 'point' || source.viewId !== target.viewId)
    throw new Error('只能合并同一投影框架的点');
  if (!editable(doc, source, role)) throw new Error('题干点只读');
  if (doc.entities.some((e) => pointReferences(e).includes(sourceId) && !editable(doc, e, role)))
    throw new Error('题干引用不能改变');
  return transact(
    doc,
    (d) => {
      for (const e of d.entities) {
        if (e.kind === 'segment') {
          if (e.startPoint === sourceId) e.startPoint = targetId;
          if (e.endPoint === sourceId) e.endPoint = targetId;
        }
        if (e.kind === 'curve')
          e.pointIds = e.pointIds.map((id) => (id === sourceId ? targetId : id));
        if ((e.kind === 'circle' || e.kind === 'arc') && e.center === sourceId) e.center = targetId;
      }
      // Constraints that collapse to identity are removed; incompatible projection identity is rejected by Schema.
      d.constraints = d.constraints
        .map((r) => ({
          ...r,
          entityIds: [...new Set(r.entityIds.map((id) => (id === sourceId ? targetId : id)))],
        }))
        .filter((r) => r.entityIds.length >= 2);
      d.constraints = d.constraints.filter(
        (r, i, all) =>
          all.findIndex(
            (a) => a.kind === r.kind && a.entityIds.join(',') === r.entityIds.join(','),
          ) === i,
      );
      d.projectionGroups = d.projectionGroups.map((r) => ({
        ...r,
        entityIds: r.entityIds.map((id) => (id === sourceId ? targetId : id)),
      }));
      if (d.referenceRelations)
        d.referenceRelations = d.referenceRelations.map((r) => ({
          ...r,
          targetId: r.targetId === sourceId ? targetId : r.targetId,
          reference:
            r.reference.kind === 'entity' && r.reference.entityId === sourceId
              ? { kind: 'entity', entityId: targetId }
              : r.reference,
        }));
      const canonical = d.entities.find((e) => e.id === targetId)!;
      if (canonical.kind === 'point' && editable(doc, target, role)) {
        canonical.aliases = [
          ...new Set(
            [...(target.aliases ?? []), ...(source.aliases ?? []), source.name].filter(
              (n) => n && n !== target.name,
            ),
          ),
        ];
        canonical.mergedFrom = [
          ...new Set([...(target.mergedFrom ?? []), ...(source.mergedFrom ?? []), sourceId]),
        ];
      }
      d.entities = d.entities.filter((e) => e.id !== sourceId);
    },
    role,
  );
}
export function disconnectEndpoint(
  doc: GeometryDocument,
  entityId: string,
  pointId: string,
  role: 'teacher' | 'student',
) {
  const e = doc.entities.find((e) => e.id === entityId),
    p = doc.entities.find((e) => e.id === pointId);
  if (!e || !editable(doc, e, role) || p?.kind !== 'point' || !pointReferences(e).includes(pointId))
    throw new Error('请选择要解除连接的答案对象及端点');
  return transact(
    doc,
    (d) => {
      const id = createId();
      d.entities.push({
        ...p,
        id,
        layerId: e.layerId,
        lineStyle: e.lineStyle,
        aliases: [],
        mergedFrom: [],
      });
      const target = d.entities.find((v) => v.id === entityId)!;
      if (target.kind === 'segment') {
        if (target.startPoint === pointId) target.startPoint = id;
        if (target.endPoint === pointId) target.endPoint = id;
      }
      if (target.kind === 'curve')
        target.pointIds = target.pointIds.map((p) => (p === pointId ? id : p));
      if (target.kind === 'circle' || target.kind === 'arc') target.center = id;
    },
    role,
  );
}
