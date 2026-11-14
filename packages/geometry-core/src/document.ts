import { GeometryDocument, type GeometryEntity, type Vec2 } from '@tuheng/contracts';
import { add } from './math';
import { spatialTranslation } from './projections';
export const validateGeometryDocument = (input: unknown) => GeometryDocument.safeParse(input);
export function loadGeometryDocument(text: string) {
  if (new TextEncoder().encode(text).length > 2_000_000) throw new Error('几何文档超过 2MB');
  return GeometryDocument.parse(JSON.parse(text));
}
export const serializeGeometryDocument = (doc: GeometryDocument) =>
  JSON.stringify(GeometryDocument.parse(doc), null, 2);
export function editable(doc: GeometryDocument, e: GeometryEntity, role: 'teacher' | 'student') {
  return role === 'teacher' || doc.layers.find((l) => l.id === e.layerId)?.role !== 'PROBLEM_STEM';
}
export function combineAnswer(stem: GeometryDocument, input: unknown): GeometryDocument {
  stem = GeometryDocument.parse(stem);
  const answer = GeometryDocument.parse(input);
  for (const key of [
    'editorType',
    'views',
    'layers',
    'projectionConfig',
    'coordinateSystem',
    'units',
  ] as const) {
    if (JSON.stringify(answer[key]) !== JSON.stringify(stem[key]))
      throw new Error('GEOMETRY_STEM_CHANGED');
  }
  const locked = stem.entities;
  for (const entity of locked) {
    if (JSON.stringify(answer.entities.find((e) => e.id === entity.id)) !== JSON.stringify(entity))
      throw new Error('GEOMETRY_STEM_CHANGED');
  }
  const ids = new Set(locked.map((e) => e.id));
  if (answer.entities.some((e) => !ids.has(e.id) && !editable(answer, e, 'student')))
    throw new Error('GEOMETRY_STEM_CHANGED');
  for (const key of ['constraints', 'projectionGroups'] as const)
    for (const relation of stem[key]) {
      if (
        JSON.stringify(answer[key].find((r) => r.id === relation.id)) !== JSON.stringify(relation)
      )
        throw new Error('GEOMETRY_STEM_CHANGED');
    }
  return GeometryDocument.parse({
    ...answer,
    entities: [...locked, ...answer.entities.filter((e) => !ids.has(e.id))],
  });
}
export function transact(
  doc: GeometryDocument,
  change: (draft: GeometryDocument) => void,
  role: 'teacher' | 'student' = 'teacher',
) {
  const draft = structuredClone(doc);
  change(draft);
  const next = GeometryDocument.parse(draft);
  if (role === 'student') {
    for (const entity of doc.entities.filter((e) => !editable(doc, e, role))) {
      if (JSON.stringify(next.entities.find((e) => e.id === entity.id)) !== JSON.stringify(entity))
        throw new Error('题干对象只读');
    }
  }
  return next;
}
export function pointReferences(e: GeometryEntity): string[] {
  if (e.kind === 'segment') return [e.startPoint, e.endPoint];
  if (e.kind === 'circle' || e.kind === 'arc') return [e.center];
  return [];
}
export function moveEntities(
  doc: GeometryDocument,
  ids: string[],
  delta: Vec2,
  role: 'teacher' | 'student',
) {
  const targets = new Set(ids);
  for (const e of doc.entities.filter((e) => targets.has(e.id)))
    for (const id of pointReferences(e)) targets.add(id);
  return transact(
    doc,
    (d) => {
      for (const e of d.entities.filter((e) => targets.has(e.id))) {
        if (!editable(doc, e, role)) throw new Error('移动涉及只读题干点');
        if (e.kind === 'point') {
          e.position = add(e.position, delta);
          e.spatial = null;
        }
        if (e.kind === 'line') e.anchor = add(e.anchor, delta);
        if (e.kind === 'polyline') e.points = e.points.map((p) => add(p, delta));
        if (e.kind === 'plane') {
          const shift = spatialTranslation(doc, e.viewId, delta);
          e.origin = { x: e.origin.x + shift.x, y: e.origin.y + shift.y, z: e.origin.z + shift.z };
        }
        if ('samples' in e && e.samples)
          e.samples = e.samples.map((p) => ({ ...add(p, delta), pressure: p.pressure }));
      }
    },
    role,
  );
}
export function deleteEntities(doc: GeometryDocument, ids: string[], role: 'teacher' | 'student') {
  const removed = new Set(ids);
  let added = true;
  while (added) {
    added = false;
    for (const e of doc.entities)
      if (!removed.has(e.id) && pointReferences(e).some((id) => removed.has(id))) {
        removed.add(e.id);
        added = true;
      }
  }
  if (doc.entities.some((e) => removed.has(e.id) && !editable(doc, e, role)))
    throw new Error('题干对象只读');
  return transact(
    doc,
    (d) => {
      d.entities = d.entities
        .filter((e) => !removed.has(e.id))
        .map((e) =>
          e.kind === 'line' && e.referenceEntityId && removed.has(e.referenceEntityId)
            ? { ...e, referenceEntityId: null }
            : e.kind === 'plane' && e.referencePlaneId && removed.has(e.referencePlaneId)
              ? { ...e, referencePlaneId: null, relation: 'ARBITRARY' }
              : e,
        );
      d.constraints = d.constraints.filter((r) => r.entityIds.every((id) => !removed.has(id)));
      d.projectionGroups = d.projectionGroups.filter((r) =>
        r.entityIds.every((id) => !removed.has(id)),
      );
    },
    role,
  );
}
export function copyEntities(doc: GeometryDocument, ids: string[], role: 'teacher' | 'student') {
  const targets = new Set(ids);
  for (const e of doc.entities.filter((e) => targets.has(e.id)))
    for (const id of pointReferences(e)) targets.add(id);
  const selected = doc.entities.filter((e) => targets.has(e.id));
  if (selected.some((e) => !editable(doc, e, role))) throw new Error('请仅复制可编辑对象');
  const mapping = new Map(selected.map((e) => [e.id, crypto.randomUUID()]));
  const next = transact(
    doc,
    (d) => {
      for (const original of selected) {
        const e = structuredClone(original);
        e.id = mapping.get(e.id)!;
        if (e.kind === 'segment') {
          e.startPoint = mapping.get(e.startPoint)!;
          e.endPoint = mapping.get(e.endPoint)!;
        }
        if (e.kind === 'circle' || e.kind === 'arc') e.center = mapping.get(e.center)!;
        if (e.kind === 'line' && e.referenceEntityId)
          e.referenceEntityId = mapping.get(e.referenceEntityId) ?? e.referenceEntityId;
        if (e.kind === 'plane' && e.referencePlaneId)
          e.referencePlaneId = mapping.get(e.referencePlaneId) ?? e.referencePlaneId;
        d.entities.push(e);
      }
      for (const relation of doc.constraints.filter((r) =>
        r.entityIds.every((id) => mapping.has(id)),
      ))
        d.constraints.push({
          ...relation,
          id: crypto.randomUUID(),
          entityIds: relation.entityIds.map((id) => mapping.get(id)!),
        });
      for (const relation of doc.projectionGroups.filter((r) =>
        r.entityIds.every((id) => mapping.has(id)),
      ))
        d.projectionGroups.push({
          ...relation,
          id: crypto.randomUUID(),
          entityIds: relation.entityIds.map((id) => mapping.get(id)!),
        });
    },
    role,
  );
  return moveEntities(next, [...mapping.values()], { x: 5, y: 5 }, role);
}
export class DocumentHistory {
  private past: GeometryDocument[] = [];
  private future: GeometryDocument[] = [];
  constructor(
    public current: GeometryDocument,
    private limit = 100,
  ) {
    this.current = GeometryDocument.parse(current);
  }
  commit(next: GeometryDocument) {
    next = GeometryDocument.parse(next);
    if (JSON.stringify(next) === JSON.stringify(this.current)) return this.current;
    this.past.push(this.current);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    this.current = next;
    return next;
  }
  undo() {
    const next = this.past.pop();
    if (next) {
      this.future.push(this.current);
      this.current = next;
    }
    return this.current;
  }
  redo() {
    const next = this.future.pop();
    if (next) {
      this.past.push(this.current);
      this.current = next;
    }
    return this.current;
  }
}
