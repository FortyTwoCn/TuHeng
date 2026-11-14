import { z } from 'zod';

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
const base = { id, viewId: id, layerId: id, lineStyle: LineStyle };
const stroke = z
  .array(Vec2.extend({ pressure: z.number().min(0).max(1) }))
  .min(2)
  .max(4096);
export const GeometryEntity = z.discriminatedUnion('kind', [
  z
    .object({
      ...base,
      kind: z.literal('point'),
      position: Vec2,
      name: z.string().max(80),
      spatial: Vec3.nullable(),
      labelVisible: z.boolean(),
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
export const GeometryDocument = z
  .object({
    schemaVersion: z.literal('tuheng.geometry/1.0.0'),
    editorType: EditorType,
    units: z.literal('mm'),
    coordinateSystem: z.literal('VIEW_LOCAL_X_RIGHT_Y_UP'),
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
            mapping: z.tuple([z.enum(['x', 'y', 'z']), z.enum(['x', 'y', 'z'])]),
            signs: z.tuple([
              z.union([z.literal(1), z.literal(-1)]),
              z.union([z.literal(1), z.literal(-1)]),
            ]),
          })
          .strict(),
      )
      .min(1)
      .max(8),
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
    const all = [
      ...doc.views,
      ...doc.layers,
      ...doc.entities,
      ...doc.constraints,
      ...doc.projectionGroups,
    ];
    if (new Set(all.map((e) => e.id)).size !== all.length) fail('对象或关系 ID 重复');
    if (new Set(doc.layers.map((l) => l.role)).size !== 3) fail('图层角色必须唯一');
    const orthographic = ['VHW_PROJECTION', 'THREE_VIEW'].includes(doc.editorType);
    if (doc.views.length !== (orthographic ? 3 : 1)) fail('视图数量与编辑器类型不一致');
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
    const entities = new Map(doc.entities.map((e) => [e.id, e]));
    const views = new Set(doc.views.map((v) => v.id));
    const layers = new Map(doc.layers.map((l) => [l.id, l.role]));
    const edges = new Map<string, string[]>();
    let samples = 0;
    for (const e of doc.entities) {
      if (!views.has(e.viewId) || !layers.has(e.layerId)) fail('对象引用不存在的视图或图层');
      const role = layers.get(e.layerId);
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
export const GeometryEvidence = z.object({
  schemaVersion: z.literal('tuheng.geometry/1.0.0'),
  editorType: EditorType,
  problemDocument: GeometryDocument,
  answerDocument: GeometryDocument,
  derivedRelations: z.array(GeometryRelation).max(10000),
  narrative: z.string().max(1000000),
});
export const GeometryAnnotation = z.object({
  errorId: z.string().nullable(),
  entityIds: z.array(id).min(1).max(30),
  relationIds: z.array(z.string()).max(30),
  explanation: z.string().max(2000),
});
