import { createId } from '@tuheng/contracts';
import { GeometryDocument, type GeometryEntity, type Vec2 } from '@tuheng/contracts';
import { upgradeGeometryDocument } from './sheet';
import { evaluateDependencies } from './dependencies';
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
  return (
    !(e.kind === 'plane' && e.legacyReadOnly) &&
    (role === 'teacher' || doc.layers.find((l) => l.id === e.layerId)?.role !== 'PROBLEM_STEM')
  );
}
export function combineAnswer(stem: GeometryDocument, input: unknown): GeometryDocument {
  stem = GeometryDocument.parse(stem);
  const answer = GeometryDocument.parse(input);
  if (answer.schemaVersion !== 'tuheng.geometry/1.0.0') {
    stem = upgradeGeometryDocument(stem);
    // Derived statuses are recomputed on new copies, never trusted or compared to absent v1 fields.
    // Submission validation must not silently move a student's point to satisfy a declared binding.
    evaluateDependencies(stem, { resolveBindings: false });
    evaluateDependencies(answer, { resolveBindings: false });
  }
  for (const key of [
    'editorType',
    'layers',
    'projectionConfig',
    'coordinateSystem',
    'units',
    'sheet',
  ] as const) {
    if (JSON.stringify(answer[key]) !== JSON.stringify(stem[key]))
      throw new Error('GEOMETRY_STEM_CHANGED');
  }
  for (const key of ['views', 'auxiliarySystems'] as const) {
    const originals = stem[key] ?? [],
      values = answer[key] ?? [];
    for (const original of originals)
      if (JSON.stringify(values.find((v) => v.id === original.id)) !== JSON.stringify(original))
        throw new Error('GEOMETRY_STEM_CHANGED');
  }
  const extraAxes = (answer.auxiliarySystems ?? []).filter(
    (a) => !(stem.auxiliarySystems ?? []).some((b) => b.id === a.id),
  );
  if (
    extraAxes.some((a) => a.owner !== 'STUDENT' || a.locked) ||
    (extraAxes.length && !stem.sheet?.allowAuxiliaryViews)
  )
    throw new Error('GEOMETRY_STEM_CHANGED');
  const extraViews = answer.views.filter((v) => !stem.views.some((w) => w.id === v.id));
  if (
    extraViews.length !== extraAxes.length ||
    extraViews.some((v) => !extraAxes.some((a) => a.newViewId === v.id))
  )
    throw new Error('GEOMETRY_STEM_CHANGED');
  const locked = stem.entities;
  for (const relation of stem.referenceRelations ?? [])
    if (
      JSON.stringify(answer.referenceRelations?.find((r) => r.id === relation.id)) !==
      JSON.stringify(relation)
    )
      throw new Error('GEOMETRY_STEM_CHANGED');
  for (const entity of locked) {
    if (JSON.stringify(answer.entities.find((e) => e.id === entity.id)) !== JSON.stringify(entity))
      throw new Error('GEOMETRY_STEM_CHANGED');
  }
  const ids = new Set(locked.map((e) => e.id));
  if (
    answer.referenceRelations?.some(
      (r) => ids.has(r.targetId) && !stem.referenceRelations?.some((p) => p.id === r.id),
    )
  )
    throw new Error('GEOMETRY_STEM_CHANGED');
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
  doc = upgradeGeometryDocument(doc);
  const draft = structuredClone(doc);
  draft.schemaVersion = 'tuheng.geometry/3.0.0';
  change(draft);
  evaluateDependencies(draft);
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
  if (e.kind === 'curve') return e.pointIds;
  if (e.kind === 'circle' || e.kind === 'arc' || e.kind === 'ellipse') return [e.center];
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
        if (
          e.kind === 'dimension' ||
          e.kind === 'text' ||
          e.kind === 'symbol' ||
          e.kind === 'engineeringAnnotation'
        )
          e.position = add(e.position, delta);
        if (e.kind==='engineeringAnnotation' && e.leader) e.leader=add(e.leader,delta);
        if (e.kind==='symbol' && e.labelPosition) e.labelPosition=add(e.labelPosition,delta);
        if (e.kind === 'hatch') e.origin = add(e.origin, delta);
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
export function deletionSet(doc: GeometryDocument, ids: string[], role: 'teacher' | 'student') {
  if (doc.auxiliarySystems?.some((a) => ids.includes(a.referenceEntityId ?? '')))
    throw new Error('参考线被换面轴依赖，请先处理该轴');
  const removed = new Set(ids);
  let added = true;
  while (added) {
    added = false;
    for (const e of doc.entities)
      if (
        !removed.has(e.id) &&
        (pointReferences(e).some((id) => removed.has(id)) ||
          (e.kind === 'dimension' && e.referenceIds.some((id) => removed.has(id))) ||
          (e.kind === 'hatch' && e.loops.some((loop) => loop.some((id) => removed.has(id)))))
      ) {
        removed.add(e.id);
        added = true;
      }
  }
  if (
    doc.auxiliarySystems?.some((a) => removed.has(a.referenceEntityId ?? '')) ||
    doc.entities.some(
      (e) =>
        !removed.has(e.id) &&
        ((e.kind === 'line' && removed.has(e.referenceEntityId ?? '')) ||
          (e.kind === 'plane' && removed.has(e.referencePlaneId ?? ''))),
    ) ||
    doc.constraints.some(
      (c) =>
        c.mode === 'BINDING' &&
        !removed.has(c.entityIds[0]) &&
        c.entityIds.some((id) => removed.has(id)),
    )
  )
    throw Error('仍有对象依赖该参考，请先处理绑定');
  if (doc.entities.some((e) => removed.has(e.id) && !editable(doc, e, role)))
    throw new Error('题干对象只读');
  if (
    doc.referenceRelations?.some(
      (r) =>
        !removed.has(r.targetId) &&
        r.reference.kind === 'entity' &&
        removed.has(r.reference.entityId),
    )
  )
    throw new Error('参考对象被关系依赖，请先解除关系');
  return removed;
}
export function deleteEntities(doc: GeometryDocument, ids: string[], role: 'teacher' | 'student') {
  const removed = deletionSet(doc, ids, role);
  const possibleOrphans = new Set(
    doc.entities.filter((e) => removed.has(e.id)).flatMap((e) => pointReferences(e)),
  );
  return transact(
    doc,
    (d) => {
      d.entities = d.entities.filter((e) => !removed.has(e.id));
      d.constraints = d.constraints.filter((r) => r.entityIds.every((id) => !removed.has(id)));
      if (d.referenceRelations)
        d.referenceRelations = d.referenceRelations.filter((r) => !removed.has(r.targetId));
      d.projectionGroups = d.projectionGroups.filter((r) =>
        r.entityIds.every((id) => !removed.has(id)),
      );
      removeUnusedControlPoints(d, possibleOrphans, role);
    },
    role,
  );
}
/** Never remove labelled, protected or independently referenced points with their former owner. */
export function removeUnusedControlPoints(
  doc: GeometryDocument,
  candidates: ReadonlySet<string>,
  role: 'teacher' | 'student',
) {
  if (!candidates.size) return;
  const retained = new Set<string>();
  for (const e of doc.entities) {
    for (const id of pointReferences(e)) retained.add(id);
    if (e.kind === 'dimension') for (const id of e.referenceIds) retained.add(id);
  }
  for (const relation of [...doc.constraints, ...doc.projectionGroups])
    for (const id of relation.entityIds) retained.add(id);
  for (const r of doc.referenceRelations ?? []) {
    retained.add(r.targetId);
    if (r.reference.kind === 'entity') retained.add(r.reference.entityId);
  }
  doc.entities = doc.entities.filter(
    (e) =>
      e.kind !== 'point' ||
      !candidates.has(e.id) ||
      retained.has(e.id) ||
      e.labelVisible ||
      !editable(doc, e, role),
  );
}
export function copySelectionEntities(
  doc: GeometryDocument,
  ids: string[],
  role: 'teacher' | 'student',
) {
  if (ids.some((id) => !doc.entities.some((e) => e.id === id))) throw Error('所选参考对象不能复制');
  const targets = new Set(ids);
  for (const e of doc.entities.filter((e) => targets.has(e.id)))
    for (const id of pointReferences(e)) targets.add(id);
  if (
    doc.constraints.some(
      (c) =>
        c.mode === 'BINDING' &&
        targets.has(c.entityIds[0]) &&
        !c.entityIds.every((id) => targets.has(id)),
    )
  )
    throw Error('复制涉及外部绑定，请先处理绑定');
  const selected = doc.entities.filter((e) => targets.has(e.id));
  if (selected.some((e) => !editable(doc, e, role))) throw new Error('请仅复制可编辑对象');
  if (
    doc.referenceRelations?.some(
      (r) =>
        targets.has(r.targetId) &&
        r.mode === 'BINDING' &&
        (r.reference.kind !== 'entity' || !targets.has(r.reference.entityId)),
    )
  )
    throw Error('复制涉及外部绑定，请先解除绑定或同时选中参考对象');
  return selected;
}
export function appendSelectionCopies(
  d: GeometryDocument,
  doc: GeometryDocument,
  selected: GeometryEntity[],
) {
  const mapping = new Map(selected.map((e) => [e.id, createId()]));
  for (const original of selected) {
    const e = structuredClone(original);
    e.id = mapping.get(e.id)!;
    if (e.kind === 'segment') {
      e.startPoint = mapping.get(e.startPoint)!;
      e.endPoint = mapping.get(e.endPoint)!;
    }
    if (e.kind === 'circle' || e.kind === 'arc' || e.kind === 'ellipse')
      e.center = mapping.get(e.center)!;
    if (e.kind === 'dimension') e.referenceIds = e.referenceIds.map((id) => mapping.get(id) ?? id);
    if (e.kind === 'hatch') {
      e.loops = e.loops.map((loop) => loop.map((id) => mapping.get(id) ?? id));
      if (e.spans) e.spans=e.spans.map(ring=>ring.map(span=>({...span,entityId:mapping.get(span.entityId) ?? span.entityId})));
    }
    if (e.kind === 'curve') e.pointIds = e.pointIds.map((id) => mapping.get(id)!);
    if (e.kind === 'line' && e.referenceEntityId)
      e.referenceEntityId = mapping.get(e.referenceEntityId) ?? e.referenceEntityId;
    if (e.kind === 'plane' && e.referencePlaneId)
      e.referencePlaneId = mapping.get(e.referencePlaneId) ?? e.referencePlaneId;
    d.entities.push(e);
  }
  for (const relation of doc.constraints.filter((r) => r.entityIds.every((id) => mapping.has(id))))
    d.constraints.push({
      ...relation,
      id: createId(),
      entityIds: relation.entityIds.map((id) => mapping.get(id)!),
    });
  for (const r of doc.referenceRelations ?? [])
    if (mapping.has(r.targetId)) {
      d.referenceRelations ??= [];
      d.referenceRelations.push({
        ...r,
        id: createId(),
        targetId: mapping.get(r.targetId)!,
        reference:
          r.reference.kind === 'entity'
            ? {
                kind: 'entity',
                entityId: mapping.get(r.reference.entityId) ?? r.reference.entityId,
              }
            : r.reference,
      });
    }
  for (const relation of doc.projectionGroups.filter((r) =>
    r.entityIds.every((id) => mapping.has(id)),
  ))
    d.projectionGroups.push({
      ...relation,
      id: createId(),
      entityIds: relation.entityIds.map((id) => mapping.get(id)!),
    });
  return mapping;
}
export class DocumentHistory {
  private past: { document: GeometryDocument; label: string }[] = [];
  private future: { document: GeometryDocument; label: string }[] = [];
  get operations() {
    return [
      ...this.past.map(({ label }) => ({ label, applied: true })),
      ...this.future
        .slice()
        .reverse()
        .map(({ label }) => ({ label, applied: false })),
    ];
  }
  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
  constructor(
    public current: GeometryDocument,
    private limit = 100,
  ) {
    this.current = GeometryDocument.parse(current);
  }
  commit(next: GeometryDocument, label = '编辑图形') {
    next = GeometryDocument.parse(next);
    if (JSON.stringify(next) === JSON.stringify(this.current)) return this.current;
    this.past.push({ document: this.current, label });
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    this.current = next;
    return next;
  }
  replaceCurrent(next: GeometryDocument) {
    this.current = GeometryDocument.parse(next);
    this.future = [];
    return this.current;
  }
  undo() {
    const next = this.past.pop();
    if (next) {
      this.future.push({ document: this.current, label: next.label });
      this.current = next.document;
    }
    return this.current;
  }
  redo() {
    const next = this.future.pop();
    if (next) {
      this.past.push({ document: this.current, label: next.label });
      this.current = next.document;
    }
    return this.current;
  }
}
