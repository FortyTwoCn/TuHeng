import type { GeometryDocument, GeometryEntity, Vec2 } from '@tuheng/contracts';
import { add, sub, scale, dot, unit, distance } from './math';
import {
  appendSelectionCopies,
  copySelectionEntities,
  editable,
  pointReferences,
  transact,
} from './document';
import { localToSheet, sheetToLocal } from './sheet';
import { spatialTranslation } from './projections';
import { evaluateDependencies } from './dependencies';
import { mapEntityCoordinates } from './entity-coordinates';

export type CadRole = 'teacher' | 'student';
export type CadTransform =
  | { kind: 'move' | 'copy'; from: Vec2; to: Vec2 }
  | { kind: 'rotate'; center: Vec2; degrees: number }
  | { kind: 'mirror'; a: Vec2; b: Vec2; keepSource: boolean };
export function cadMutation(
  doc: GeometryDocument,
  role: CadRole,
  preview: boolean,
  changed: Set<string>,
  change: (draft: GeometryDocument) => void,
): GeometryDocument {
  if (!preview) return transact(doc, change, role);
  // Constraint evaluation can move a follower outside the selection. Detach only
  // writable entities before resolving, so previews never alter the authoritative snapshot.
  const writable = new Set(changed);
  for (const c of doc.constraints)
    if (c.kind === 'INTERSECTION' && c.mode === 'BINDING') writable.add(c.entityIds[0]);
  for (const relation of doc.referenceRelations ?? []) {
    if (relation.mode !== 'BINDING') continue;
    writable.add(relation.targetId);
    const target = doc.entities.find((e) => e.id === relation.targetId);
    if (target?.kind === 'segment') writable.add(target.endPoint);
  }
  const draft = {
    ...doc,
    entities: doc.entities.map((e) => (writable.has(e.id) ? { ...e } : e)),
    constraints: doc.constraints.map((c) => ({ ...c })),
    referenceRelations: doc.referenceRelations?.map((r) => ({ ...r })),
    auxiliarySystems: doc.auxiliarySystems?.map((s) => ({ ...s })),
    projectionGroups: [...doc.projectionGroups],
  };
  change(draft);
  if (
    draft.constraints.length ||
    draft.referenceRelations?.length ||
    draft.auxiliarySystems?.length
  )
    evaluateDependencies(draft);
  return draft;
}
const dir = (degrees: number) => ({
  x: Math.cos((degrees * Math.PI) / 180),
  y: Math.sin((degrees * Math.PI) / 180),
});
function sheetMap(s: CadTransform) {
  if (s.kind === 'mirror') {
    if (distance(s.a, s.b) < 1e-8) throw Error('镜像轴必须有两个不同的点');
    const u = unit(sub(s.b, s.a));
    return (p: Vec2) => {
      const d = sub(p, s.a);
      return add(s.a, sub(scale(u, 2 * dot(d, u)), d));
    };
  }
  if (s.kind === 'rotate') {
    if (!Number.isFinite(s.degrees)) throw Error('请输入有效旋转角');
    const r = dir(s.degrees);
    return (p: Vec2) => {
      const d = sub(p, s.center);
      return add(s.center, { x: r.x * d.x - r.y * d.y, y: r.y * d.x + r.x * d.y });
    };
  }
  const d = sub(s.to, s.from);
  return (p: Vec2) => add(p, d);
}
function applyTransform(
  doc: GeometryDocument,
  e: GeometryEntity,
  s: CadTransform,
  map: (p: Vec2) => Vec2,
  circularSpans: ReadonlySet<string>,
) {
  const at = (p: Vec2) => sheetToLocal(doc, e.viewId, map(localToSheet(doc, e.viewId, p)));
  const reorient = s.kind === 'rotate' || s.kind === 'mirror';
  mapEntityCoordinates(e, at, { reorient, reflected: s.kind === 'mirror', circularSpans });
  if (e.kind === 'plane') {
    if (s.kind === 'mirror' || s.kind === 'rotate')
      throw Error('三维参考平面不能使用二维旋转或镜像');
    const d = spatialTranslation(doc, e.viewId, at({ x: 0, y: 0 }));
    e.origin = { x: e.origin.x + d.x, y: e.origin.y + d.y, z: e.origin.z + d.z };
  }
}
/** Bases and vectors are in unfolded sheet millimetres. Every point ID is transformed once. */
export function transformSelection(
  doc: GeometryDocument,
  ids: string[],
  spec: CadTransform,
  role: CadRole,
  preview = false,
) {
  if (!ids.length) throw Error('请选择要变换的对象');
  const map = sheetMap(spec);
  const targets = new Set(ids);
  for (const e of doc.entities)
    if (targets.has(e.id) && e.kind === 'hatch')
      for (const loop of e.loops) for (const id of loop) targets.add(id);
  for (const e of doc.entities)
    if (targets.has(e.id)) for (const id of pointReferences(e)) targets.add(id);
  const copying = spec.kind === 'copy' || (spec.kind === 'mirror' && spec.keepSource);
  const selected = copying
    ? copySelectionEntities(doc, [...targets], role)
    : doc.entities.filter((e) => targets.has(e.id));
  if (selected.length !== targets.size || selected.some((e) => !editable(doc, e, role)))
    throw Error('变换涉及只读题干或不存在的对象');
  if (
    !copying &&
    doc.entities.some(
      (e) => !editable(doc, e, role) && pointReferences(e).some((id) => targets.has(id)),
    )
  )
    throw Error('变换会修改被题干引用的节点');
  if (
    doc.constraints.some(
      (c) =>
        c.mode === 'BINDING' &&
        targets.has(c.entityIds[0]) &&
        !c.entityIds.every((id) => targets.has(id)),
    ) ||
    doc.referenceRelations?.some(
      (r) =>
        r.mode === 'BINDING' &&
        targets.has(r.targetId) &&
        (r.reference.kind !== 'entity' || !targets.has(r.reference.entityId)),
    )
  )
    throw Error('选集含有外部绑定，需同时选择参考对象或解除绑定');
  if (
    !copying &&
    doc.auxiliarySystems?.some((s) => s.referenceEntityId && targets.has(s.referenceEntityId))
  )
    throw Error('所选参考线被换面轴使用，请先处理换面关系');
  return cadMutation(doc, role, preview, targets, (d) => {
    const changed = copying ? new Set(appendSelectionCopies(d, doc, selected).values()) : targets;
    const circularSpans = new Set(d.entities.filter(e=>e.kind==='circle').map(e=>e.id));
    for (const e of d.entities) if (changed.has(e.id)) applyTransform(doc, e, spec, map, circularSpans);
  });
}

/** Context-card duplicate uses the same command as a copy at a picked displacement. */
export function copyEntities(doc: GeometryDocument, ids: string[], role: CadRole) {
  return transformSelection(
    doc,
    ids,
    { kind: 'copy', from: { x: 0, y: 0 }, to: { x: 5, y: 5 } },
    role,
  );
}
