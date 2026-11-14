import { z } from 'zod';
import { GeometryDocument as LegacyGeometryDocument } from './geometry-v1';
export { LegacyGeometryDocument };

export const EditorType = z.enum(['VHW_PROJECTION', 'THREE_VIEW', 'ISOMETRIC', 'OBLIQUE_DIMETRIC']);
export type EditorType = z.infer<typeof EditorType>;
export const LayerRole = z.enum(['PROBLEM_STEM', 'STUDENT_ANSWER', 'CONSTRUCTION']);
export const LineStyle = z.enum([
  'CONSTRUCTION',
  'ANSWER_VISIBLE',
  'ANSWER_HIDDEN',
  'PROBLEM_VISIBLE',
  'PROBLEM_HIDDEN',
]);
const id = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[\w.-]+$/);
const scalar = z.number().finite().min(-10000).max(10000);
export const Vec2 = z.object({ x: scalar, y: scalar }).strict();
export type Vec2 = z.infer<typeof Vec2>;
export const Vec3 = Vec2.extend({ z: scalar });
export type Vec3 = z.infer<typeof Vec3>;
const base = {
  id,
  viewId: id,
  layerId: id,
  lineStyle: LineStyle,
  scope: z.enum(['VIEW', 'SHEET']).optional(),
  sampling: z
    .object({
      cssPixelsPerMm: z.number().finite().positive().max(10000),
      origin: Vec2,
      xAxis: Vec2,
      yAxis: Vec2,
    })
    .strict()
    .optional(),
};
const stroke = z
  .array(Vec2.extend({ pressure: z.number().min(0).max(1) }))
  .min(2)
  .max(4096);
export const PenStrokeRecord = z
  .object({
    schemaVersion: z.literal('tuheng.stroke/1.0.0'),
    coordinateSpace: z.literal('VIEW_LOCAL_MM'),
    viewId: id,
    cssPixelsPerMm: z.number().finite().positive().max(10000),
    pointerType: z.enum(['mouse', 'pen', 'touch']),
    samples: stroke,
  })
  .strict();
export type PenStrokeRecord = z.infer<typeof PenStrokeRecord>;
export const GeometryEntity = z.discriminatedUnion('kind', [
  z
    .object({
      ...base,
      kind: z.literal('point'),
      position: Vec2,
      name: z.string().max(80),
      spatial: Vec3.nullable(),
      labelVisible: z.boolean(),
      aliases: z.array(z.string().max(80)).max(100).optional(),
      mergedFrom: z.array(id).max(100).optional(),
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal('segment'),
      startPoint: id,
      endPoint: id,
      samples: stroke.optional(),
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal('line'),
      anchor: Vec2,
      direction: Vec2,
      referenceEntityId: id.nullable(),
      samples: stroke.optional(),
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal('circle'),
      center: id,
      radius: scalar.positive(),
      samples: stroke.optional(),
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal('arc'),
      center: id,
      radius: scalar.positive(),
      startAngle: z.number().finite().min(-360).max(360),
      sweep: z
        .number()
        .finite()
        .min(-360)
        .max(360)
        .refine((n) => Math.abs(n) > 0.001),
      samples: stroke.optional(),
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal('polyline'),
      points: z.array(Vec2).min(2).max(4096),
      samples: stroke.optional(),
      fitStatus: z.literal('UNFITTED'),
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal('plane'),
      legacyReadOnly: z.boolean().optional(),
      origin: Vec3,
      normal: Vec3,
      orientation: Vec3,
      referencePlaneId: id.nullable(),
      relation: z.enum(['ARBITRARY', 'PARALLEL', 'PERPENDICULAR']),
    })
    .strict(),
]);
export type GeometryEntity = z.infer<typeof GeometryEntity>;
export const RelationKind = z.enum([
  'COINCIDENT',
  'PARALLEL',
  'PERPENDICULAR',
  'POINT_ON_LINE',
  'INTERSECTION',
  'COLLINEAR',
  'MIDPOINT',
  'TANGENT',
  'SAME_SPATIAL_POINT',
  'PROJECTION_ALIGNMENT',
]);
export const GeometryConstraint = z
  .object({
    id,
    kind: RelationKind,
    entityIds: z.array(id).min(2).max(8),
    source: z.enum(['USER', 'SNAP_CONFIRMED']),
    mode: z.enum(['POSITION', 'BINDING', 'ANALYSIS']).optional(),
    status: z.enum(['SATISFIED', 'INVALID', 'UNVERIFIED']).optional(),
  })
  .strict();
export const ProjectionGroup = z
  .object({
    id,
    kind: z.enum(['POINT', 'SEGMENT']),
    entityIds: z.array(id).min(2).max(8),
    source: z.literal('USER'),
  })
  .strict();
export const GeometryRelation = z.object({
  id: z.string(),
  kind: RelationKind,
  entityIds: z.array(id),
  source: z.literal('COMPUTED'),
  tolerance: z.number().nonnegative(),
  deviation: z.number().finite().nullable(),
  description: z.string(),
});
export type GeometryRelation = z.infer<typeof GeometryRelation>;
const axis = z.object({
  angle: z.number().finite().min(-360).max(360),
  scale: z.number().positive().max(10),
});
export const SheetTransform = z.object({ origin: Vec2, xAxis: Vec2, yAxis: Vec2 }).strict();
export const ProjectionAxis = z
  .object({
    id,
    name: z.string().min(1).max(40),
    version: z.literal(1),
    owner: z.enum(['SYSTEM', 'TEACHER', 'STUDENT']),
    locked: z.boolean(),
    referenceStatus: z.enum(['SATISFIED', 'INVALID', 'UNVERIFIED']).optional(),
    parentId: id.nullable(),
    retainedViewId: id,
    replacedViewId: id,
    newViewId: id,
    anchor: Vec2,
    tangent: Vec2,
    side: z.union([z.literal(1), z.literal(-1)]),
    positiveNormal: Vec2,
    oldAxis: z.object({ anchor: Vec2, tangent: Vec2, positiveNormal: Vec2 }).strict(),
    method: z.enum(['FREE', 'PARALLEL', 'PERPENDICULAR']),
    referenceEntityId: id.nullable(),
  })
  .strict();
export type ProjectionAxis = z.infer<typeof ProjectionAxis>;
export const GeometryDocument = z
  .object({
    schemaVersion: z.enum(['tuheng.geometry/1.0.0', 'tuheng.geometry/2.0.0']),
    editorType: EditorType,
    units: z.literal('mm'),
    coordinateSystem: z.enum(['VIEW_LOCAL_X_RIGHT_Y_UP', 'VIEW_LOCAL_WITH_SHEET_TRANSFORM']),
    sheet: z.object({ origin: Vec2, allowAuxiliaryViews: z.boolean() }).strict().optional(),
    auxiliarySystems: z.array(ProjectionAxis).max(24).optional(),
    projectionConfig: z
      .object({
        convention: z.enum(['FIRST_ANGLE_LEFT', 'THIRD_ANGLE_RIGHT']),
        axes: z.object({ x: axis, y: axis, z: axis }),
        depthAngle: z.number().min(-180).max(180),
        depthScale: z.number().positive().max(2),
      })
      .strict(),
    views: z
      .array(
        z
          .object({
            id,
            name: z.string().max(80),
            transform: SheetTransform.optional(),
            mapping: z.tuple([z.enum(['x', 'y', 'z']), z.enum(['x', 'y', 'z'])]),
            signs: z.tuple([
              z.union([z.literal(1), z.literal(-1)]),
              z.union([z.literal(1), z.literal(-1)]),
            ]),
          })
          .strict(),
      )
      .min(1)
      .max(27),
    layers: z
      .array(z.object({ id, role: LayerRole }).strict())
      .min(3)
      .max(3),
    entities: z.array(GeometryEntity).max(2000),
    constraints: z.array(GeometryConstraint).max(1000),
    projectionGroups: z.array(ProjectionGroup).max(500),
    settings: z
      .object({
        grid: z.number().positive().max(100),
        tolerance: z.number().positive().max(1),
        labels: z.boolean(),
      })
      .strict(),
    metadata: z.object({ title: z.string().max(200) }).strict(),
  })
  .strict()
  .superRefine((doc, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (new TextEncoder().encode(JSON.stringify(doc)).length > 2_000_000) fail('几何文档超过 2MB');
    if (doc.schemaVersion === 'tuheng.geometry/1.0.0') {
      const legacy = LegacyGeometryDocument.safeParse(doc);
      if (!legacy.success) fail('v1 文档不允许使用 v2 字段');
    } else {
      if (
        doc.coordinateSystem !== 'VIEW_LOCAL_WITH_SHEET_TRANSFORM' ||
        !doc.sheet ||
        !doc.auxiliarySystems ||
        doc.views.some((v) => !v.transform)
      )
        fail('v2 缺少展开图纸与坐标变换');
      if (doc.sheet && (doc.sheet.origin.x !== 0 || doc.sheet.origin.y !== 0))
        fail('基准原点必须为零');
    }
    const all = [
      ...(doc.auxiliarySystems ?? []),
      ...doc.views,
      ...doc.layers,
      ...doc.entities,
      ...doc.constraints,
      ...doc.projectionGroups,
    ];
    if (new Set(all.map((e) => e.id)).size !== all.length) fail('对象或关系 ID 重复');
    if (new Set(doc.layers.map((l) => l.role)).size !== 3) fail('图层角色必须唯一');
    const orthographic = ['VHW_PROJECTION', 'THREE_VIEW'].includes(doc.editorType);
    if (doc.views.length !== (orthographic ? 3 + (doc.auxiliarySystems?.length ?? 0) : 1))
      fail('视图数量与编辑器类型不一致');
    if (doc.views.some((view) => view.mapping[0] === view.mapping[1]))
      fail('视图的两个映射轴不能相同');
    if (doc.editorType === 'ISOMETRIC') {
      const vectors = Object.values(doc.projectionConfig.axes).map((a) => ({
        x: Math.cos((a.angle * Math.PI) / 180) * a.scale,
        y: Math.sin((a.angle * Math.PI) / 180) * a.scale,
      }));
      const xx = vectors.reduce((sum, a) => sum + a.x * a.x, 0);
      const xy = vectors.reduce((sum, a) => sum + a.x * a.y, 0);
      const yy = vectors.reduce((sum, a) => sum + a.y * a.y, 0);
      if (xx * yy - xy * xy < 1e-10) fail('投影轴不能全部共线或退化');
    }
    for (const v of doc.views)
      if (v.transform) {
        const { xAxis: x, yAxis: y } = v.transform;
        if (
          Math.abs(Math.hypot(x.x, x.y) - 1) > 1e-7 ||
          Math.abs(Math.hypot(y.x, y.y) - 1) > 1e-7 ||
          Math.abs(x.x * y.x + x.y * y.y) > 1e-7
        )
          fail('图纸变换必须保持毫米比例且正交');
      }
    const systems = doc.auxiliarySystems ?? [];
    if (!orthographic && systems.length) fail('轴测图不支持换面');
    const createdViews = new Set(systems.map((a) => a.newViewId));
    if (
      createdViews.size !== systems.length ||
      new Set(systems.map((a) => a.name)).size !== systems.length
    )
      fail('新投影面或轴名称重复');
    const entities = new Map(doc.entities.map((e) => [e.id, e]));
    const views = new Set(doc.views.map((v) => v.id));
    const layers = new Map(doc.layers.map((l) => [l.id, l.role]));
    const edges = new Map<string, string[]>();
    for (const a of systems) {
      const near = (u: Vec2, v: Vec2) => Math.hypot(u.x - v.x, u.y - v.y) < 1e-7;
      if (
        ![a.retainedViewId, a.replacedViewId, a.newViewId].every((v) => views.has(v)) ||
        new Set([a.retainedViewId, a.replacedViewId, a.newViewId]).size !== 3
      )
        fail('换面视图引用无效');
      if (
        Math.abs(Math.hypot(a.tangent.x, a.tangent.y) - 1) > 1e-7 ||
        !near(a.positiveNormal, { x: -a.tangent.y * a.side, y: a.tangent.x * a.side })
      )
        fail('新轴方向或展开侧无效');
      if (
        Math.abs(Math.hypot(a.oldAxis.tangent.x, a.oldAxis.tangent.y) - 1) > 1e-7 ||
        Math.abs(Math.hypot(a.oldAxis.positiveNormal.x, a.oldAxis.positiveNormal.y) - 1) > 1e-7 ||
        Math.abs(
          a.oldAxis.tangent.x * a.oldAxis.positiveNormal.x +
            a.oldAxis.tangent.y * a.oldAxis.positiveNormal.y,
        ) > 1e-7
      )
        fail('旧轴方向无效');
      if (a.owner !== 'STUDENT' && !a.locked) fail('基准与教师轴必须锁定');
      if (a.owner === 'STUDENT' && a.locked) fail('学生不能声明题干轴');
      const v = doc.views.find((v) => v.id === a.newViewId)?.transform;
      if (
        !v ||
        !near(v.origin, a.anchor) ||
        !near(v.xAxis, a.tangent) ||
        !near(v.yAxis, a.positiveNormal)
      )
        fail('新视图坐标与轴不一致');
      const parent = systems.find((b) => b.id === a.parentId);
      if (
        a.parentId &&
        (!parent ||
          ![parent.retainedViewId, parent.newViewId].includes(a.retainedViewId) ||
          ![parent.retainedViewId, parent.newViewId].includes(a.replacedViewId))
      )
        fail('父投影系无效');
      if (parent) {
        const expected =
          a.replacedViewId === parent.newViewId
            ? parent.positiveNormal
            : { x: -parent.positiveNormal.x, y: -parent.positiveNormal.y };
        if (
          !near(a.oldAxis.anchor, parent.anchor) ||
          !near(a.oldAxis.tangent, parent.tangent) ||
          !near(a.oldAxis.positiveNormal, expected)
        )
          fail('旧轴必须来自父投影系');
        if (a.owner !== 'STUDENT' && parent.owner === 'STUDENT') fail('题干轴不能依赖学生轴');
      } else {
        const retained = doc.views.find((v) => v.id === a.retainedViewId),
          replaced = doc.views.find((v) => v.id === a.replacedViewId);
        const common = retained?.mapping.find((k) => replaced?.mapping.includes(k));
        if (!common || common === 'y') fail('基准换面必须选择 V/H 或 V/W');
        if (replaced?.transform && common) {
          const index = replaced.mapping.indexOf(common),
            direction = index === 0 ? replaced.transform.yAxis : replaced.transform.xAxis,
            sign = replaced.signs[index === 0 ? 1 : 0];
          if (
            !near(a.oldAxis.anchor, { x: 0, y: 0 }) ||
            !near(a.oldAxis.tangent, common === 'x' ? { x: -1, y: 0 } : { x: 0, y: 1 }) ||
            !near(a.oldAxis.positiveNormal, { x: direction.x * sign, y: direction.y * sign })
          )
            fail('旧轴与基准投影系不一致');
        }
      }
      if (!a.parentId && (createdViews.has(a.retainedViewId) || createdViews.has(a.replacedViewId)))
        fail('派生视图必须指明父投影系');
      if (a.method !== 'FREE') {
        const r = entities.get(a.referenceEntityId ?? '');
        if (!r || !['line', 'segment'].includes(r.kind) || r.viewId !== a.retainedViewId)
          fail('新轴参考线无效');
        if (a.owner !== 'STUDENT' && r && layers.get(r.layerId) !== 'PROBLEM_STEM')
          fail('教师轴不能依赖学生图形');
      } else if (a.referenceEntityId) fail('普通轴不能声明参考线');
      edges.set(a.id, a.parentId ? [a.parentId] : []);
    }
    let samples = 0;
    for (const e of doc.entities) {
      if (!views.has(e.viewId) || !layers.has(e.layerId)) fail('对象引用不存在的视图或图层');
      const role = layers.get(e.layerId);
      if (e.scope === 'SHEET' && (e.kind !== 'line' || e.lineStyle !== 'CONSTRUCTION'))
        fail('图纸级对象必须为辅助线');
      if (
        (role === 'PROBLEM_STEM') !== e.lineStyle.startsWith('PROBLEM_') ||
        (role === 'CONSTRUCTION') !== (e.lineStyle === 'CONSTRUCTION')
      )
        fail('图层与线型不一致');
      const refs =
        e.kind === 'segment'
          ? [e.startPoint, e.endPoint]
          : e.kind === 'circle' || e.kind === 'arc'
            ? [e.center]
            : [];
      for (const ref of refs) {
        const point = entities.get(ref);
        if (point?.kind !== 'point' || point.viewId !== e.viewId)
          fail('端点或圆心必须引用同视图的点');
        if (role === 'PROBLEM_STEM' && point?.layerId !== e.layerId)
          fail('题干不能引用可编辑答案点');
      }
      if (e.kind === 'segment') {
        if (e.lineStyle === 'CONSTRUCTION') fail('辅助直线必须使用无限线类型');
        const a = entities.get(e.startPoint),
          b = entities.get(e.endPoint);
        if (
          a?.kind === 'point' &&
          b?.kind === 'point' &&
          Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y) < 1e-8
        )
          fail('线段长度必须大于零');
      }
      if (e.kind === 'line') {
        if (e.lineStyle.startsWith('ANSWER')) fail('答案直线必须使用有限线段类型');
        if (Math.hypot(e.direction.x, e.direction.y) < 1e-8) fail('无限线方向不能为零');
        if (e.referenceEntityId) {
          const ref = entities.get(e.referenceEntityId);
          if (!ref || !['line', 'segment'].includes(ref.kind) || ref.viewId !== e.viewId)
            fail('参考线无效');
          refs.push(e.referenceEntityId);
        }
      }
      if (e.kind === 'plane') {
        const n = e.normal,
          u = e.orientation;
        if (
          Math.hypot(n.x, n.y, n.z) < 1e-8 ||
          Math.hypot(u.x, u.y, u.z) < 1e-8 ||
          Math.abs(n.x * u.x + n.y * u.y + n.z * u.z) > 1e-6
        )
          fail('平面法向与方向必须非零且正交');
        if (e.referencePlaneId) {
          if (entities.get(e.referencePlaneId)?.kind !== 'plane') fail('参考平面无效');
          refs.push(e.referencePlaneId);
        }
      }
      edges.set(e.id, refs);
      if ('samples' in e) samples += e.samples?.length ?? 0;
      if (e.kind === 'polyline') samples += e.points.length;
    }
    if (samples > 30000) fail('笔迹采样总数超出限制');
    for (const c of doc.constraints)
      if (c.mode === 'BINDING') {
        if (c.kind !== 'INTERSECTION') fail('本版持续绑定仅支持显式交点');
        const target = entities.get(c.entityIds[0]);
        if (target && layers.get(target.layerId) === 'PROBLEM_STEM') fail('不能绑定并驱动题干点');
        edges.set(c.entityIds[0], [...(edges.get(c.entityIds[0]) ?? []), ...c.entityIds.slice(1)]);
      }
    const visited = new Set<string>();
    const visiting = new Set<string>();
    function visit(key: string) {
      if (visiting.has(key)) {
        fail('几何引用不能循环');
        return;
      }
      if (visited.has(key)) return;
      visiting.add(key);
      for (const next of edges.get(key) ?? []) visit(next);
      visiting.delete(key);
      visited.add(key);
    }
    for (const key of edges.keys()) visit(key);
    for (const relation of [...doc.constraints, ...doc.projectionGroups]) {
      if (
        new Set(relation.entityIds).size !== relation.entityIds.length ||
        relation.entityIds.some((key) => !entities.has(key))
      )
        fail('关系引用缺失或重复');
    }
    for (const group of doc.projectionGroups) {
      const members = group.entityIds.map((key) => entities.get(key));
      if (
        members.some((e) => e?.kind !== (group.kind === 'POINT' ? 'point' : 'segment')) ||
        new Set(members.map((e) => e?.viewId)).size !== members.length
      )
        fail('投影关联必须引用不同视图的同类对象');
    }
    for (const constraint of doc.constraints) {
      const members = constraint.entityIds.map((key) => entities.get(key));
      if (members.some((e) => !e)) continue;
      const kinds = members.map((e) => e!.kind);
      const lineKinds = (kind: string) => kind === 'segment' || kind === 'line';
      if (
        ['PARALLEL', 'PERPENDICULAR', 'COLLINEAR'].includes(constraint.kind) &&
        !kinds.every(lineKinds)
      )
        fail('线方向约束必须引用线对象');
      if (
        ['COINCIDENT', 'SAME_SPATIAL_POINT'].includes(constraint.kind) &&
        !kinds.every((kind) => kind === 'point')
      )
        fail('点约束必须引用点对象');
      if (
        ['POINT_ON_LINE', 'MIDPOINT'].includes(constraint.kind) &&
        (kinds.length !== 2 || kinds[0] !== 'point' || !lineKinds(kinds[1]))
      )
        fail('点线约束引用类型错误');
      if (
        constraint.kind === 'INTERSECTION' &&
        (kinds.length !== 3 || kinds[0] !== 'point' || !kinds.slice(1).every(lineKinds))
      )
        fail('交点约束必须引用一个点和两条线');
      if (
        constraint.kind === 'TANGENT' &&
        (kinds.length !== 2 || kinds[0] !== 'circle' || !lineKinds(kinds[1]))
      )
        fail('相切约束必须引用圆和线');
      if (
        !['SAME_SPATIAL_POINT', 'PROJECTION_ALIGNMENT'].includes(constraint.kind) &&
        new Set(members.map((e) => e!.viewId)).size !== 1
      )
        fail('平面几何约束不能跨视图');
    }
  });
export type GeometryDocument = z.infer<typeof GeometryDocument>;
export const GeometryEvidence = z
  .object({
    schemaVersion: z.enum(['tuheng.geometry/1.0.0', 'tuheng.geometry/2.0.0']),
    editorType: EditorType,
    problemDocument: GeometryDocument,
    answerDocument: GeometryDocument,
    derivedRelations: z.array(GeometryRelation).max(10000),
    narrative: z.string().max(1000000),
  })
  .refine(
    (e) =>
      e.schemaVersion === e.answerDocument.schemaVersion &&
      e.editorType === e.answerDocument.editorType &&
      e.editorType === e.problemDocument.editorType,
    '几何证据版本与实际文档不一致',
  );
export const GeometryAnnotation = z.object({
  errorId: z.string().nullable(),
  entityIds: z.array(id).min(1).max(30),
  relationIds: z.array(z.string()).max(30),
  explanation: z.string().max(2000),
});
