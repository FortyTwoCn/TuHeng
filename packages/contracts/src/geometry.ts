import { z } from 'zod';
import {
  simpleHatchPolygon,
  hatchPatternExtent,
  HATCH_ROW_LIMIT,
  HATCH_WORK_LIMIT,
} from './hatch-validation';
export { HATCH_ROW_LIMIT, HATCH_WORK_LIMIT, simpleHatchPolygon } from './hatch-validation';
import { GeometryDocument as LegacyGeometryDocument } from './geometry-v1';
import { EditorType, geometryId as id, geometryScalar as scalar, Vec2 } from './geometry-values';
import { ConstructionAnimationDocument, checkConstructionAnimationReferences } from './construction-animation';
export { LegacyGeometryDocument };
export { EditorType, Vec2 } from './geometry-values';
export const GEOMETRY_DOCUMENT_VERSION = 'tuheng.geometry/3.0.0';
export const GEOMETRY_DOCUMENT_MAX_BYTES = 2_000_000;
export const GEOMETRY_DOCUMENT_MAX_ENTITIES = 2000;
export const LayerRole = z.enum(['PROBLEM_STEM', 'STUDENT_ANSWER', 'CONSTRUCTION']);
export type LayerRole = z.infer<typeof LayerRole>;
export const LineStyle = z.enum([
  'CONSTRUCTION',
  'ANSWER_VISIBLE',
  'ANSWER_HIDDEN',
  'PROBLEM_VISIBLE',
  'PROBLEM_HIDDEN',
]);
const degrees = z.number().finite().min(-360).max(360);
const signedSweep = degrees.refine((n) => Math.abs(n) > 0.001, '扫角必须非零');
const paperSize = scalar.positive().max(100);
export const GeometryTargetRef = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('entity'), entityId: id }).strict(),
  z
    .object({
      kind: z.literal('baseAxis'),
      axisId: z.enum(['X', 'Z', 'Y_H', 'Y_W', 'MITER_45', 'x', 'y', 'z']),
    })
    .strict(),
  z.object({ kind: z.literal('projectionAxis'), systemId: id }).strict(),
  z.object({ kind: z.literal('origin'), frameId: id }).strict(),
]);
export type GeometryTargetRef = z.infer<typeof GeometryTargetRef>;
type BaseAxisId = Extract<GeometryTargetRef, { kind: 'baseAxis' }>['axisId'];
const threePlaneAxes = ['X', 'Z', 'Y_H', 'Y_W', 'MITER_45'] as const;
const axonometricAxes = ['x', 'y', 'z'] as const;
export const geometryEditorTopology = {
  VHW_PROJECTION: { orthographic: true, baseViewCount: 3, baseAxes: threePlaneAxes },
  VH_PROJECTION: { orthographic: true, baseViewCount: 2, baseAxes: ['X'] },
  THREE_VIEW: { orthographic: true, baseViewCount: 3, baseAxes: threePlaneAxes },
  ISOMETRIC: { orthographic: false, baseViewCount: 1, baseAxes: axonometricAxes },
  OBLIQUE_DIMETRIC: { orthographic: false, baseViewCount: 1, baseAxes: axonometricAxes },
} as const satisfies Record<
  EditorType,
  { orthographic: boolean; baseViewCount: number; baseAxes: readonly BaseAxisId[] }
>;
export function hasGeometryBaseAxis(editorType: EditorType, axisId: BaseAxisId) {
  return geometryEditorTopology[editorType].baseAxes.some((axis) => axis === axisId);
}
export const ReferenceRelation = z
  .object({
    id,
    targetId: id,
    reference: GeometryTargetRef,
    kind: z.enum(['POINT_ON_REFERENCE', 'THROUGH_POINT', 'PARALLEL', 'PERPENDICULAR']),
    mode: z.enum(['POSITION', 'BINDING']),
    source: z.enum(['USER', 'SNAP_CONFIRMED']),
    status: z.enum(['SATISFIED', 'INVALID', 'UNVERIFIED']).optional(),
  })
  .strict();
export type ReferenceRelation = z.infer<typeof ReferenceRelation>;
export const Vec3 = Vec2.extend({ z: scalar });
export type Vec3 = z.infer<typeof Vec3>;
const base = {
  id,
  viewId: id,
  layerId: id,
  lineStyle: LineStyle,
  appearance: z
    .object({
      widthMm: z.number().finite().min(0.05).max(5).optional(),
      color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional(),
      pattern: z.enum(['SOLID', 'DASHED', 'CENTER', 'PHANTOM', 'GUIDE']).optional(),
    })
    .strict()
    .optional(),
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
      kind: z.literal('curve'),
      pointIds: z.array(id).min(3).max(128),
      interpolation: z.enum(['CUBIC_HERMITE','QUADRATIC_BSPLINE']),
      parameterRange: z
        .tuple([z.number().min(0).max(1), z.number().min(0).max(1)])
        .refine(([from, to]) => from < to, '样条参数区间无效')
        .optional(),
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
      kind: z.literal('ellipse'),
      center: id,
      majorRadius: scalar.positive(),
      minorRadius: scalar.positive(),
      angle: degrees,
      startAngle: degrees,
      sweep: signedSweep,
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal('text'),
      position: Vec2,
      angle: degrees,
      size: paperSize,
      content: z.string().trim().min(1).max(400),
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal('symbol'),
      position: Vec2,
      angle: degrees,
      size: paperSize,
      symbolType: z.enum(['DIRECTION', 'LEFT_ROTATION', 'RIGHT_ROTATION']),
      label: z.string().trim().max(40).optional(),
      labelPosition: Vec2.optional(),
      arrowLength: z.number().finite().positive().max(30000).optional(),
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal('dimension'),
      dimensionType: z.enum(['LINEAR', 'ALIGNED', 'ANGULAR', 'RADIUS', 'DIAMETER']),
      linearAxis: z.enum(['X', 'Y']).optional(),
      linearAngle: degrees.optional(),
      referenceIds: z.array(id).min(1).max(3),
      position: Vec2,
      precision: z.number().int().min(0).max(6),
      textOverride: z.string().max(100),
      textSize: paperSize,
      arrowStyle: z.enum(['CLOSED', 'OPEN']),
      tolerance: z.object({
        code: z.string().trim().max(20), upper: z.string().trim().max(24), lower: z.string().trim().max(24),
        showCode: z.boolean(), showDeviation: z.boolean(),
      }).strict().optional(),
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal('engineeringAnnotation'),
      position: Vec2,
      angle: degrees,
      size: paperSize,
      annotationType: z.enum(['DATUM', 'ROUGHNESS', 'GEOMETRIC_TOLERANCE', 'TOLERANCE_TEXT']),
      roughnessMode: z.enum(['BASIC', 'REMOVAL_REQUIRED', 'REMOVAL_PROHIBITED']).optional(),
      leader: Vec2.optional(),
      roughnessDetails: z.object({
        accessory: z.enum(['NONE','BAR','ALL_AROUND','AFTER_WELD']),
        texture: z.enum(['NONE','PARALLEL','PERPENDICULAR','CROSSED','MULTIDIRECTIONAL','CIRCULAR','RADIAL','NON_DIRECTIONAL']),
        method: z.string().trim().max(60), extent: z.enum(['NONE','ALL','REMAINDER']),
      }).strict().optional(),
      toleranceRows: z.array(z.array(z.string().trim().max(80)).length(6)).min(1).max(3).optional(),
      fields: z.array(z.string().trim().max(80)).min(1).max(6),
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal('hatch'),
      loops: z.array(z.array(id).min(1).max(256)).min(1).max(16),
      spans: z.array(z.array(z.object({entityId:id, from:z.number().finite().min(-1e7).max(1e7), to:z.number().finite().min(-1e7).max(1e7)}).strict()).min(1).max(256)).min(1).max(16).optional(),
      origin: Vec2,
      angle: degrees,
      spacing: z.number().finite().min(0.1).max(500),
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
export type CadEntity = Extract<
  GeometryEntity,
  {
    kind: 'ellipse' | 'text' | 'symbol' | 'dimension' | 'engineeringAnnotation' | 'hatch';
  }
>;
export function isCadEntity(entity: GeometryEntity): entity is CadEntity {
  return ['ellipse', 'text', 'symbol', 'dimension', 'engineeringAnnotation', 'hatch'].includes(
    entity.kind,
  );
}
/** Return the ordered point cycle for a set of boundary segments; require one connected ring. */
export function hatchRing(edges: Extract<GeometryEntity, { kind: 'segment' }>[]): string[] {
  const adjacent = new Map<string, string[]>();
  for (const e of edges) {
    for (const [a, b] of [
      [e.startPoint, e.endPoint],
      [e.endPoint, e.startPoint],
    ]) {
      const list = adjacent.get(a) ?? [];
      list.push(b);
      adjacent.set(a, list);
    }
  }
  if (edges.length < 3 || [...adjacent.values()].some((list) => list.length !== 2)) return [];
  const first = edges[0].startPoint,
    ordered = [first],
    visited = new Set(ordered);
  let previous = first,
    current = edges[0].endPoint;
  while (current !== first) {
    if (visited.has(current)) return [];
    visited.add(current);
    ordered.push(current);
    const next = adjacent.get(current)!.find((p) => p !== previous);
    if (!next) return [];
    previous = current;
    current = next;
  }
  return ordered.length === edges.length ? ordered : [];
}
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
    referenceAxis: z
      .discriminatedUnion('kind', [
        z
          .object({ kind: z.literal('baseAxis'), axisId: z.enum(['X', 'Z', 'Y_H', 'Y_W', 'MITER_45']) })
          .strict(),
        z.object({ kind: z.literal('projectionAxis'), systemId: id }).strict(),
      ])
      .optional(),
  })
  .strict();
export type ProjectionAxis = z.infer<typeof ProjectionAxis>;
export const GeometryDocument = z
  .object({
    schemaVersion: z.enum([
      'tuheng.geometry/1.0.0',
      'tuheng.geometry/2.0.0',
      'tuheng.geometry/2.1.0',
      'tuheng.geometry/2.2.0',
      GEOMETRY_DOCUMENT_VERSION,
    ]),
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
    entities: z.array(GeometryEntity).max(GEOMETRY_DOCUMENT_MAX_ENTITIES),
    constraints: z.array(GeometryConstraint).max(1000),
    referenceRelations: z.array(ReferenceRelation).max(1000).optional(),
    projectionGroups: z.array(ProjectionGroup).max(500),
    settings: z
      .object({
        grid: z.number().positive().max(100),
        tolerance: z.number().positive().max(1),
        labels: z.boolean(),
      })
      .strict(),
    metadata: z.object({ title: z.string().max(200) }).strict(),
    constructionAnimation: ConstructionAnimationDocument.optional(),
  })
  .strict()
  .superRefine((doc, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (doc.constructionAnimation) {
      if (doc.schemaVersion !== GEOMETRY_DOCUMENT_VERSION)
        ctx.addIssue({ code: 'custom', path: ['constructionAnimation'], message: '内嵌动画需要 3.0 图纸' });
      checkConstructionAnimationReferences(doc.constructionAnimation, doc, (path, message) =>
        ctx.addIssue({ code: 'custom', path: ['constructionAnimation', ...path], message }),
      );
    }
    if (new TextEncoder().encode(JSON.stringify(doc)).length > GEOMETRY_DOCUMENT_MAX_BYTES)
      fail('几何文档超过 2MB');
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
      ...(doc.referenceRelations ?? []),
      ...(doc.auxiliarySystems ?? []),
      ...doc.views,
      ...doc.layers,
      ...doc.entities,
      ...doc.constraints,
      ...doc.projectionGroups,
    ];
    if (new Set(all.map((e) => e.id)).size !== all.length) fail('对象或关系 ID 重复');
    if (new Set(doc.layers.map((l) => l.role)).size !== 3) fail('图层角色必须唯一');
    const { orthographic, baseViewCount } = geometryEditorTopology[doc.editorType];
    if (
      doc.referenceRelations &&
      !['tuheng.geometry/2.1.0', 'tuheng.geometry/2.2.0', 'tuheng.geometry/3.0.0'].includes(
        doc.schemaVersion,
      )
    )
      fail('类型化参考关系需要 2.1 文档');
    if (doc.views.length !== baseViewCount + (doc.auxiliarySystems?.length ?? 0))
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
    if (doc.editorType === 'VH_PROJECTION') {
      if (doc.schemaVersion !== GEOMETRY_DOCUMENT_VERSION) fail('两面投影需要 3.0 文档');
      const baseViews = doc.views.filter((v) => !createdViews.has(v.id));
      for (const [name, mapping, verticalSign] of [
        ['V', 'x,z', 1],
        ['H', 'x,y', -1],
      ] as const) {
        const view = baseViews.find((v) => v.name === name && v.mapping.join(',') === mapping);
        const frame = view?.transform;
        if (
          !view ||
          !frame ||
          frame.origin.x !== 0 ||
          frame.origin.y !== 0 ||
          frame.xAxis.x * view.signs[0] !== -1 ||
          frame.xAxis.y !== 0 ||
          frame.yAxis.x !== 0 ||
          frame.yAxis.y * view.signs[1] !== verticalSign
        )
          fail('两面投影必须沿 X-O 轴展开 V/H');
      }
    }
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
      const axisDependencies = a.parentId ? [a.parentId] : [];
      if (a.referenceAxis) {
        if (
          a.method === 'FREE' ||
          a.referenceEntityId ||
          doc.schemaVersion !== 'tuheng.geometry/3.0.0'
        )
          fail('平行或垂直新轴只能选择一个参考');
        if (
          a.referenceAxis.kind === 'baseAxis' &&
          !hasGeometryBaseAxis(doc.editorType, a.referenceAxis.axisId)
        )
          fail('基准轴不属于当前投影体系');
        if (a.referenceAxis.kind === 'projectionAxis') {
          const referenceId = a.referenceAxis.systemId;
          const ref = systems.find((s) => s.id === referenceId);
          if (!ref || ![ref.retainedViewId, ref.newViewId].includes(a.retainedViewId))
            fail('参考轴与保留面不属于同一投影系');
          if (a.owner !== 'STUDENT' && ref?.owner === 'STUDENT') fail('教师轴不能依赖学生轴');
          axisDependencies.push(referenceId);
        }
      } else if (a.method !== 'FREE') {
        const r = entities.get(a.referenceEntityId ?? '');
        if (!r || !['line', 'segment'].includes(r.kind) || r.viewId !== a.retainedViewId)
          fail('新轴参考线无效');
        if (a.owner !== 'STUDENT' && r && layers.get(r.layerId) !== 'PROBLEM_STEM')
          fail('教师轴不能依赖学生图形');
      } else if (a.referenceEntityId) fail('普通轴不能声明参考线');
      edges.set(a.id, axisDependencies);
    }
    let samples = 0;
    let hatchWork = 0;
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
          : e.kind === 'circle' || e.kind === 'arc' || e.kind === 'ellipse'
            ? [e.center]
            : e.kind === 'curve'
              ? [...e.pointIds]
              : [];
      for (const ref of refs) {
        const point = entities.get(ref);
        if (point?.kind !== 'point' || point.viewId !== e.viewId)
          fail('端点或圆心必须引用同视图的点');
        if (role === 'PROBLEM_STEM' && point?.layerId !== e.layerId)
          fail('题干不能引用可编辑答案点');
      }
      if (e.kind === 'curve') {
        if (!['tuheng.geometry/2.2.0', 'tuheng.geometry/3.0.0'].includes(doc.schemaVersion))
          fail('插值曲线需要 2.2 或更新文档');
        if (new Set(e.pointIds).size !== e.pointIds.length) fail('曲线经过点引用不能重复');
        for (let i = 1; i < e.pointIds.length; i++) {
          const a = entities.get(e.pointIds[i - 1]),
            b = entities.get(e.pointIds[i]);
          if (
            a?.kind === 'point' &&
            b?.kind === 'point' &&
            Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y) < 1e-8
          )
            fail('相邻曲线经过点不能重合');
        }
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
      if (
        (isCadEntity(e) || e.appearance || (e.kind === 'curve' && e.parameterRange)) &&
        doc.schemaVersion !== 'tuheng.geometry/3.0.0'
      )
        fail('CAD 图元与绘图样式需要 3.0 文档');
      if (e.kind === 'ellipse' && e.majorRadius < e.minorRadius) fail('长半轴不得小于短半轴');
      if (e.kind === 'engineeringAnnotation') {
        if (e.annotationType !== 'ROUGHNESS' && (e.roughnessMode || e.roughnessDetails))
          fail('表面加工方式仅适用于粗糙度标注');
        if (e.toleranceRows && (e.annotationType !== 'GEOMETRIC_TOLERANCE' || e.toleranceRows.some(row=>!row[0] || !row[1])))
          fail('形位公差每行至少需填写特征和公差值');
        if (e.annotationType === 'TOLERANCE_TEXT') {
          if (e.fields.length !== 3 || !e.fields[0] || !(e.fields[1] || e.fields[2]))
            fail('公差文字需填写基本尺寸与至少一侧偏差');
        } else if (e.fields.some((f) => !f)) fail('工程标注字段不能为空');
      }
      if (e.kind === 'dimension' || e.kind === 'hatch') {
        const dependencies = e.kind === 'dimension' ? e.referenceIds : e.loops.flat();
        if (new Set(dependencies).size !== dependencies.length) fail('标注或剖面边界引用重复');
        for (const ref of dependencies) {
          const value = entities.get(ref);
          if (!value || value.viewId !== e.viewId) fail('CAD 引用不存在或跨越视图');
          if (role === 'PROBLEM_STEM' && value?.layerId !== e.layerId) fail('题干不能引用作答对象');
        }
        refs.push(...dependencies);
      }
      if (e.kind === 'dimension') {
        const sources = e.referenceIds.map((id) => entities.get(id));
        const radial = e.dimensionType === 'RADIUS' || e.dimensionType === 'DIAMETER';
        const angularLines = e.dimensionType === 'ANGULAR' && sources.length === 2;
        const required = radial ? 1 : e.dimensionType === 'ANGULAR' && !angularLines ? 3 : 2;
        if (sources.length !== required || sources.some(source => radial
          ? source?.kind !== 'circle' && source?.kind !== 'arc'
          : angularLines ? source?.kind !== 'segment' && source?.kind !== 'line'
          : source?.kind !== 'point'))
          fail('尺寸标注测量引用无效');
        if (e.dimensionType === 'ANGULAR' && sources[0]?.kind === 'point') {
          const vertex = sources[0].position;
          if (
            sources
              .slice(1)
              .some(
                (v) =>
                  v?.kind === 'point' &&
                  Math.hypot(v.position.x - vertex.x, v.position.y - vertex.y) < 1e-8,
              )
          )
            fail('角度标注不能使用零长射线');
        }
      }
      if (e.kind === 'hatch') {
        if (e.spans) {
          if (e.spans.length !== e.loops.length) fail('剖面区间与边界环不对应');
          for (const [i,spans] of e.spans.entries()) {
            const loop = e.loops[i] ?? [];
            if (new Set(spans.map(s=>s.entityId)).size !== loop.length ||
              spans.some(s=>!loop.includes(s.entityId))) fail('剖面区间引用与边界不一致');
            for (const span of spans) {
              const source=entities.get(span.entityId);
              const [lo,hi]=source?.kind==='curve' ? source.parameterRange ?? [0,1] : [0,1];
              if (!source || !['segment','line','circle','arc','ellipse','curve'].includes(source.kind) ||
                Math.abs(span.from-span.to)<=1e-8 ||
                (source.kind!=='line' && (Math.abs(span.from-span.to)>1+1e-8 ||
                  (source.kind==='circle' ? Math.min(span.from,span.to)<-1 || Math.max(span.from,span.to)>2
                    : Math.min(span.from,span.to)<lo-1e-8 || Math.max(span.from,span.to)>hi+1e-8))))
                fail('剖面边界的参数区间无效');
            }
          }
        } else for (const ring of e.loops) {
          const borders = ring.map((id) => entities.get(id));
          if (
            borders.length === 1 &&
            (borders[0]?.kind === 'circle' ||
              (borders[0]?.kind === 'ellipse' && Math.abs(borders[0].sweep) === 360))
          )
            continue;
          const segments = borders.filter((b) => b?.kind === 'segment');
          const vertices = hatchRing(segments)
            .map((id) => entities.get(id))
            .filter((p) => p?.kind === 'point')
            .map((p) => p.position);
          if (
            segments.length !== borders.length ||
            vertices.length !== segments.length ||
            !simpleHatchPolygon(vertices)
          )
            fail('剖面边界必须闭合且连通');
        }
        const rows = hatchPatternExtent(e, entities);
        if (rows > HATCH_ROW_LIMIT) fail('剖面线超过 4096 排，请增加间距');
        hatchWork += rows * e.loops.reduce((n, ring) => n + ring.length, 0);
      }
      edges.set(e.id, refs);
      if ('samples' in e) samples += e.samples?.length ?? 0;
      if (e.kind === 'polyline') samples += e.points.length;
    }
    if (samples > 30000) fail('笔迹采样总数超出限制');
    if (hatchWork > HATCH_WORK_LIMIT) fail('剖面边界与间距组合超过单图计算限制');
    for (const c of doc.constraints)
      if (c.mode === 'BINDING') {
        if (c.kind !== 'INTERSECTION') fail('本版持续绑定仅支持显式交点');
        const target = entities.get(c.entityIds[0]);
        if (target && layers.get(target.layerId) === 'PROBLEM_STEM') fail('不能绑定并驱动题干点');
        edges.set(c.entityIds[0], [...(edges.get(c.entityIds[0]) ?? []), ...c.entityIds.slice(1)]);
      }
    const drivers = new Set(
      doc.constraints.filter((c) => c.mode === 'BINDING').map((c) => c.entityIds[0]),
    );
    const relationKeys = new Set<string>();
    for (const r of doc.referenceRelations ?? []) {
      const target = entities.get(r.targetId),
        ref = r.reference;
      const source = ref.kind === 'entity' ? entities.get(ref.entityId) : undefined;
      if (!target) {
        fail('参考关系目标不存在');
        continue;
      }
      if (ref.kind === 'entity' && (!source || source.id === target.id))
        fail('参考对象不存在或自引用');
      if (ref.kind === 'baseAxis' && !hasGeometryBaseAxis(doc.editorType, ref.axisId))
        fail('基准轴不属于当前投影体系');
      if (ref.kind === 'origin' && !doc.views.some((v) => v.id === ref.frameId))
        fail('原点框架不存在');
      if (ref.kind === 'projectionAxis' && !systems.some((a) => a.id === ref.systemId))
        fail('投影轴引用不存在');
      if (
        source &&
        source.viewId !== target.viewId &&
        source.scope !== 'SHEET' &&
        target.scope !== 'SHEET'
      )
        fail('关系不能跨投影框架');
      if (
        r.kind === 'POINT_ON_REFERENCE' &&
        (target.kind !== 'point' || (source && !['point', 'segment', 'line'].includes(source.kind)))
      )
        fail('贴轴关系需要点和线/原点');
      if (r.kind === 'THROUGH_POINT' && (target.kind !== 'line' || source?.kind !== 'point'))
        fail('过点关系需要辅助线和点');
      if (
        ['PARALLEL', 'PERPENDICULAR'].includes(r.kind) &&
        (!['line', 'segment'].includes(target.kind) ||
          ref.kind === 'origin' ||
          (source && !['line', 'segment'].includes(source.kind)))
      )
        fail('方向关系必须引用线或轴');
      const key = `${r.targetId}:${r.kind}:${JSON.stringify(ref)}`;
      if (relationKeys.has(key)) fail('重复参考关系');
      relationKeys.add(key);
      if (r.mode === 'BINDING') {
        const driven = target.kind === 'segment' ? target.endPoint : target.id;
        if (drivers.has(driven)) fail('一个对象不能有多个驱动约束');
        drivers.add(driven);
        if (
          layers.get(target.layerId) === 'PROBLEM_STEM' ||
          (target.kind === 'segment' &&
            layers.get(entities.get(target.endPoint)?.layerId ?? '') === 'PROBLEM_STEM')
        )
          fail('不能通过绑定驱动题干');
        if (
          target.kind === 'segment' &&
          doc.entities.some(
            (e) =>
              e.id !== target.id &&
              ((e.kind === 'segment' && [e.startPoint, e.endPoint].includes(target.endPoint)) ||
                ((e.kind === 'circle' || e.kind === 'arc') && e.center === target.endPoint) ||
                (e.kind === 'curve' && e.pointIds.includes(target.endPoint))),
          )
        )
          fail('方向绑定会影响共享端点，请先解除连接');
        if (source) edges.set(driven, [...(edges.get(driven) ?? []), source.id]);
      }
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
export const GEOMETRY_EVIDENCE_NARRATIVE_LIMIT = 1_000_000;
export const GeometryEvidence = z
  .object({
    schemaVersion: z.enum([
      'tuheng.geometry/1.0.0',
      'tuheng.geometry/2.0.0',
      'tuheng.geometry/2.1.0',
      'tuheng.geometry/2.2.0',
      'tuheng.geometry/3.0.0',
    ]),
    editorType: EditorType,
    problemDocument: GeometryDocument,
    answerDocument: GeometryDocument,
    derivedRelations: z.array(GeometryRelation).max(10000),
    narrative: z.string().max(GEOMETRY_EVIDENCE_NARRATIVE_LIMIT),
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
