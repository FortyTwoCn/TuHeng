import {
  createId,
  GEOMETRY_DOCUMENT_VERSION,
  GeometryDocument,
  type GeometryEntity,
  type Vec2,
} from '@tuheng/contracts';
import { evaluateDependencies } from './dependencies';
import { appendSelectionCopies, pointReferences } from './document';
import { mapEntityCoordinates } from './entity-coordinates';
import { add, cross, planeOutline, type Bounds } from './math';
import {
  compatibleView,
  copyFixedReference,
  copyPlacement,
  sameSpatialProjection,
} from './reference-copy-frames';
import {
  localToSheet,
  sheetBounds,
  sheetToLocal,
  upgradeGeometryDocument,
  viewTransform,
} from './sheet';

type CopyOptions = {
  role: 'teacher' | 'student';
  activeViewId?: string;
  visibleBounds?: Bounds;
};

function dependencies(doc: GeometryDocument, ids: readonly string[]) {
  const entities = new Map(doc.entities.map((entity) => [entity.id, entity]));
  const selected = new Set(ids);
  const bindings = doc.constraints.filter((constraint) => constraint.mode === 'BINDING');
  const relations = doc.referenceRelations ?? [];
  // Set 的遍历会继续处理后续加入的依赖，多个对象共享的节点只复制一次。
  for (const id of selected) {
    const entity = entities.get(id);
    if (!entity) throw Error('参考图中找不到选中的对象');
    for (const pointId of pointReferences(entity)) selected.add(pointId);
    if (entity.kind === 'dimension') for (const ref of entity.referenceIds) selected.add(ref);
    if (entity.kind === 'hatch') for (const ref of entity.loops.flat()) selected.add(ref);
    if (entity.kind === 'line' && entity.referenceEntityId) selected.add(entity.referenceEntityId);
    if (entity.kind === 'plane' && entity.referencePlaneId) selected.add(entity.referencePlaneId);
    for (const constraint of bindings)
      if (constraint.entityIds[0] === id) for (const ref of constraint.entityIds) selected.add(ref);
    for (const relation of relations)
      if (relation.targetId === id && relation.reference.kind === 'entity')
        selected.add(relation.reference.entityId);
  }
  return doc.entities.filter(({ id }) => selected.has(id));
}

function assignLayer(target: GeometryDocument, entity: GeometryEntity, role: CopyOptions['role']) {
  const permittedRole =
    entity.lineStyle === 'CONSTRUCTION' || (entity.kind === 'line' && role === 'student')
      ? 'CONSTRUCTION'
      : entity.lineStyle.startsWith('PROBLEM') && role === 'teacher'
        ? 'PROBLEM_STEM'
        : 'STUDENT_ANSWER';
  const layer = target.layers.find((candidate) => candidate.role === permittedRole);
  if (!layer) throw Error('主画框缺少可用于复制的图层');
  entity.layerId = layer.id;
  if (permittedRole === 'CONSTRUCTION') {
    if (entity.lineStyle.endsWith('_HIDDEN') && !entity.appearance?.pattern)
      entity.appearance = { ...entity.appearance, pattern: 'DASHED' };
    entity.lineStyle = 'CONSTRUCTION';
  } else if (permittedRole === 'STUDENT_ANSWER') {
    entity.lineStyle = entity.lineStyle.endsWith('_HIDDEN') ? 'ANSWER_HIDDEN' : 'ANSWER_VISIBLE';
  }
}

function unusedId(source: GeometryDocument, target: GeometryDocument) {
  const occupied = new Set(
    [source, target].flatMap((doc) =>
      [
        ...doc.views,
        ...doc.layers,
        ...doc.entities,
        ...doc.constraints,
        ...doc.projectionGroups,
        ...(doc.referenceRelations ?? []),
        ...(doc.auxiliarySystems ?? []),
      ].map(({ id }) => id),
    ),
  );
  return () => {
    let id = createId();
    while (occupied.has(id)) id = createId();
    occupied.add(id);
    return id;
  };
}

/** 在毫米坐标中复制图元及其内部引用，返回可一次提交的正式文档。 */
export function copyEntitiesFromReferenceDocument(
  source: GeometryDocument,
  target: GeometryDocument,
  entityIds: readonly string[],
  options: CopyOptions,
) {
  if (!entityIds.length) throw Error('请先选择要复制的参考对象');
  target = upgradeGeometryDocument(target);
  const original = dependencies(source, entityIds);
  const byId = new Map(original.map((entity) => [entity.id, entity]));
  const frames = new Map(
    source.views.map((view) => [view.id, compatibleView(source, target, view)]),
  );
  const active = target.views.find(({ id }) => id === options.activeViewId) ?? target.views[0];
  const unmatched = original.filter(({ viewId }) => !frames.get(viewId));
  const delta = unmatched.length
    ? copyPlacement(
        target,
        active,
        sheetBounds({ ...source, entities: unmatched }, { drawingOnly: true }),
        options.visibleBounds,
      )
    : { x: 0, y: 0 };
  const destination = (viewId: string) => frames.get(viewId)?.id ?? active.id;
  const toSheet = (viewId: string, point: Vec2) => {
    const match = frames.get(viewId);
    return match
      ? localToSheet(target, match.id, sheetToLocal(source, viewId, point))
      : add(point, delta);
  };
  const keepSpatial = (viewId: string) =>
    !!frames.get(viewId) && sameSpatialProjection(source, target, viewId, destination(viewId));
  const canKeepPlane = (entity: Extract<GeometryEntity, { kind: 'plane' }>): boolean => {
    if (!keepSpatial(entity.viewId)) return false;
    const parent = entity.referencePlaneId && byId.get(entity.referencePlaneId);
    return !parent || (parent.kind === 'plane' && canKeepPlane(parent));
  };
  const circularSpans = new Set(
    original.filter(({ kind }) => kind === 'circle').map(({ id }) => id),
  );
  const entities = original.map((entity) => {
    let copy = structuredClone(entity);
    if (copy.kind === 'plane') {
      if (canKeepPlane(copy)) delete copy.legacyReadOnly;
      else {
        const { id, layerId, viewId, lineStyle, appearance } = copy;
        copy = {
          id,
          layerId,
          viewId,
          lineStyle,
          appearance,
          kind: 'polyline',
          points: planeOutline(source, copy),
          fitStatus: 'UNFITTED',
        };
      }
    }
    if (!frames.get(entity.viewId)) {
      const at = (point: Vec2) =>
        sheetToLocal(target, active.id, add(localToSheet(source, entity.viewId, point), delta));
      const a = viewTransform(source, entity.viewId),
        b = viewTransform(target, active.id);
      mapEntityCoordinates(copy, at, {
        reorient: true,
        reflected: cross(a.xAxis, a.yAxis) * cross(b.xAxis, b.yAxis) < 0,
        circularSpans,
      });
    }
    if (copy.kind === 'point') {
      delete copy.mergedFrom;
      if (!keepSpatial(entity.viewId)) copy.spatial = null;
    }
    copy.viewId = destination(entity.viewId);
    if (copy.sampling)
      copy.sampling = {
        cssPixelsPerMm: copy.sampling.cssPixelsPerMm,
        ...viewTransform(target, copy.viewId),
      };
    assignLayer(target, copy, options.role);
    return copy;
  });
  const keepMultiView = (ids: string[]) => {
    const views = ids.map((id) => byId.get(id)?.viewId);
    return (
      views.every((view) => view && keepSpatial(view)) &&
      new Set(views.map((view) => destination(view!))).size === views.length
    );
  };
  const relationships: GeometryDocument = {
    ...source,
    constraints: source.constraints.filter(
      (relation) =>
        !['SAME_SPATIAL_POINT', 'PROJECTION_ALIGNMENT'].includes(relation.kind) ||
        keepMultiView(relation.entityIds),
    ),
    projectionGroups: source.projectionGroups.filter((group) => keepMultiView(group.entityIds)),
    referenceRelations: source.referenceRelations?.flatMap((relation) => {
      const subject = byId.get(relation.targetId);
      if (!subject) return [];
      const reference = copyFixedReference(source, target, relation, frames, (point) =>
        toSheet(subject.viewId, point),
      );
      return reference ? [{ ...relation, reference }] : [];
    }),
  };
  const next: GeometryDocument = {
    ...target,
    schemaVersion: GEOMETRY_DOCUMENT_VERSION,
    entities: [...target.entities],
    constraints: [...target.constraints],
    projectionGroups: [...target.projectionGroups],
    referenceRelations: target.referenceRelations?.slice(),
  };
  const mapping = appendSelectionCopies(next, relationships, entities, unusedId(source, target));
  // 复制已记录的坐标。只评估新关系，既有题干和未确认的几何不会被驱动。
  evaluateDependencies(
    {
      ...next,
      auxiliarySystems: next.auxiliarySystems?.map((axis) => ({ ...axis })),
      constraints: next.constraints.slice(target.constraints.length),
      referenceRelations: next.referenceRelations?.slice(target.referenceRelations?.length ?? 0),
    },
    { resolveBindings: false },
  );
  const document = GeometryDocument.parse(next);
  return {
    document,
    selectedIds: [...new Set(entityIds)].map((id) => mapping.get(id)!),
    bounds: sheetBounds(
      { ...document, entities: document.entities.slice(target.entities.length) },
      { drawingOnly: true },
    ),
  };
}
