import {
  createId,
  type GeometryDocument,
  type GeometryEntity,
  type LayerRole,
  type Vec2,
} from '@tuheng/contracts';
import { angleVector, dxfShapeBoundsPoints, type DxfShape } from './dxf-shapes';
import { drawingViewAt, sheetDeltaToLocal, sheetToLocal, viewTransform } from './sheet';
import { angle, cross, distance, length, scale, sub } from './vectors';

type Point = Extract<GeometryEntity, { kind: 'point' }>;
export type DxfEntityStyle = Pick<GeometryEntity, 'lineStyle' | 'appearance'> & {
  layerRole: LayerRole;
};
export interface DxfBatch {
  type: string;
  sourceIndex: number;
  shapes: DxfShape[];
  style: DxfEntityStyle;
  frameHint?: string;
}

function boundsCenter(shapes: readonly DxfShape[]): Vec2 {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const shape of shapes)
    for (const p of dxfShapeBoundsPoints(shape)) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  return { x: minX + (maxX - minX) / 2, y: minY + (maxY - minY) / 2 };
}

export function materializeDxf(
  doc: GeometryDocument,
  batches: readonly DxfBatch[],
  unitScale: number,
  centerDrawing: boolean,
  capacity: number,
  report: (type: string, message: string) => void,
) {
  const center = centerDrawing
    ? boundsCenter(batches.flatMap((batch) => batch.shapes))
    : { x: 0, y: 0 };
  const sheet = (p: Vec2) => scale(sub(p, center), unitScale);
  const layers = new Map(doc.layers.map((layer) => [layer.role, layer.id]));
  const availableFrames = new Map(
    doc.views.map((view) => [doc.editorType + '/' + view.id, view.id]),
  );
  const points = new Map<string, Point[]>();
  const added: GeometryEntity[] = [];
  const imported = new Set<DxfBatch>();
  const append = <T extends GeometryEntity>(entity: T) => {
    if (added.length >= capacity) throw Error('导入后的图元和节点数量超过当前图纸上限');
    added.push(entity);
    return entity;
  };

  // 明确的 POINT 先登记。LINE、圆心和样条可复用后出现的点及其文字属性。
  const ordered = [
    ...batches.filter((batch) => batch.type === 'POINT'),
    ...batches.filter((batch) => batch.type !== 'POINT'),
  ];
  for (const batch of ordered) {
    const hint = !centerDrawing ? availableFrames.get(batch.frameHint ?? '') : undefined;
    const viewId = hint ?? drawingViewAt(doc, sheet(boundsCenter(batch.shapes)));
    const { xAxis, yAxis } = viewTransform(doc, viewId);
    const mirror = cross(xAxis, yAxis) < 0 ? -1 : 1;
    const { layerRole, ...style } = batch.style;
    const base = { viewId, layerId: layers.get(layerRole)!, ...style };
    // 图衡的辅助直线是无限线。DXF LINE 有两个有限端点，保留线段和外观。
    const segmentBase: typeof base =
      layerRole === 'CONSTRUCTION'
        ? {
            ...base,
            layerId: layers.get('STUDENT_ANSWER')!,
            lineStyle: style.appearance?.pattern === 'DASHED' ? 'ANSWER_HIDDEN' : 'ANSWER_VISIBLE',
          }
        : base;
    const localAngle = (degrees: number, readingSign = 1) =>
      angle(sheetDeltaToLocal(doc, viewId, scale(angleVector(degrees), readingSign)));
    const at = (p: Vec2) => {
      const local = sheetToLocal(doc, viewId, sheet(p));
      if (
        !Number.isFinite(local.x) ||
        !Number.isFinite(local.y) ||
        Math.abs(local.x) > 10000 ||
        Math.abs(local.y) > 10000
      )
        throw Error('DXF 对象超出图衡的局部坐标范围 ±10000 mm，可尝试居中导入');
      return local;
    };
    const pointId = (
      position: Vec2,
      explicit?: PointFields,
      used?: ReadonlySet<string>,
      target = base,
    ) => {
      const key =
        target.layerId +
        '/' +
        viewId +
        '/' +
        Math.round(position.x * 1e8) +
        '/' +
        Math.round(position.y * 1e8);
      const bucket = points.get(key) ?? [];
      const node =
        !explicit && bucket.find((p) => !used?.has(p.id) && distance(position, p.position) <= 1e-8);
      if (node) return node.id;
      const created = append({
        ...target,
        id: createId(),
        kind: 'point',
        position,
        name: explicit?.name ?? '',
        labelVisible: explicit?.labelVisible ?? false,
        spatial: null,
      });
      bucket.push(created);
      points.set(key, bucket);
      return created.id;
    };
    const radiusMm = (radius: number) => {
      const size = radius * unitScale;
      if (!(size > 0 && size <= 10_000)) throw Error('DXF 曲线半径超出图衡的毫米范围');
      return size;
    };
    let finiteOnAnswerLayer = false;
    const segment = (start: Vec2, end: Vec2) => {
      if (distance(start, end) < 1e-8) return;
      finiteOnAnswerLayer ||= segmentBase !== base;
      const startPoint = pointId(start, undefined, undefined, segmentBase);
      let endPoint = pointId(end, undefined, undefined, segmentBase);
      if (startPoint === endPoint)
        endPoint = pointId(end, undefined, new Set([startPoint]), segmentBase);
      append({
        ...segmentBase,
        id: createId(),
        kind: 'segment',
        startPoint,
        endPoint,
      });
    };
    const before = added.length;
    for (const shape of batch.shapes) {
      if (shape.kind === 'point') {
        pointId(at(shape.position), shape);
        continue;
      }
      const identity = { ...base, id: createId() };
      switch (shape.kind) {
        case 'segment':
          segment(at(shape.start), at(shape.end));
          break;
        case 'polyline': {
          const positions = shape.points.map(at);
          if (shape.closed && distance(positions[0], positions.at(-1)!) > 1e-8) {
            if (positions.length < 4096) positions.push(positions[0]);
            else segment(positions.at(-1)!, positions[0]);
          }
          append({ ...identity, kind: 'polyline', points: positions, fitStatus: 'UNFITTED' });
          break;
        }
        case 'circle':
        case 'arc': {
          const common = {
            ...identity,
            center: pointId(at(shape.center)),
            radius: radiusMm(shape.radius),
          };
          if (shape.kind === 'circle') append({ ...common, kind: 'circle' });
          else
            append({
              ...common,
              kind: 'arc',
              startAngle: localAngle(shape.startAngle),
              sweep: shape.sweep * mirror,
            });
          break;
        }
        case 'ellipse': {
          const majorRadius = radiusMm(length(shape.major));
          append({
            ...identity,
            kind: 'ellipse',
            center: pointId(at(shape.center)),
            majorRadius,
            minorRadius: majorRadius * shape.ratio,
            angle: localAngle(angle(shape.major)),
            startAngle: angle(angleVector(shape.startAngle * mirror)),
            sweep: shape.sweep * mirror,
          });
          break;
        }
        case 'curve': {
          const positions: Vec2[] = [];
          for (const position of shape.points.map(at))
            if (!positions.length || distance(positions.at(-1)!, position) >= 1e-8)
              positions.push(position);
          if (positions.length === 2) segment(positions[0], positions[1]);
          if (positions.length < 3) break;
          const used = new Set<string>();
          const pointIds = positions.map((position) => {
            const id = pointId(position, undefined, used);
            used.add(id);
            return id;
          });
          append({
            ...identity,
            kind: 'curve',
            pointIds,
            interpolation: shape.interpolation,
            parameterRange: shape.range,
          });
          break;
        }
        case 'text': {
          if (!shape.content) break;
          const size = shape.size * unitScale;
          if (!(size > 0)) throw Error('DXF 文字字高必须大于零');
          if (size > 100) report(batch.type, '字高已限制为 100 mm');
          if (shape.content.length > 400) report(batch.type, '文字已截取为 400 字符');
          append({
            ...identity,
            kind: 'text',
            position: at(shape.position),
            angle: localAngle(shape.angle, mirror),
            size: Math.min(100, size),
            content: shape.content.slice(0, 400).trim(),
          });
          break;
        }
      }
    }
    if (added.length > before) imported.add(batch);
    if (finiteOnAnswerLayer) report(batch.type, '有限辅助线已作为线段放入答案图层');
  }
  return { added, imported };
}

type PointFields = Pick<Extract<DxfShape, { kind: 'point' }>, 'name' | 'labelVisible'>;
