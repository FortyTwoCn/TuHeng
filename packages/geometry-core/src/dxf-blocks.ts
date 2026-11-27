import type { Vec2 } from '@tuheng/contracts';
import { groupDxfEntities } from './dxf-entities';
import {
  DXF_MAX_ENTITIES,
  dxfName,
  dxfNormal,
  dxfNumber,
  dxfPoint,
  dxfRecords,
  UnsupportedDxfEntity,
  type DxfTags,
} from './dxf-format';
import { angleVector, ocsPoint, type DxfShape } from './dxf-shapes';
import { add, angle, sub } from './vectors';

type DxfBlock = {
  origin: Vec2;
  external: boolean;
  entities: ReturnType<typeof groupDxfEntities>;
};

export function readDxfBlocks(tags: DxfTags) {
  const blocks = new Map<string, DxfBlock>();
  const records = dxfRecords(tags);
  if (records.length > DXF_MAX_ENTITIES) throw Error('DXF 块内图元数量超过 20,000');
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    if (record.type !== 'BLOCK') throw Error('DXF 的 BLOCKS 段缺少块定义');
    const name = dxfName(record.tags, 2);
    const start = ++index;
    while (index < records.length && !['BLOCK', 'ENDBLK'].includes(records[index].type)) index++;
    if (records[index]?.type !== 'ENDBLK') throw Error('DXF 的块定义缺少 ENDBLK');
    if (!name || blocks.has(name)) throw Error('DXF 块名称缺失或重复');
    blocks.set(name, {
      origin: { x: dxfNumber(record.tags, 10, 0), y: dxfNumber(record.tags, 20, 0) },
      external: !!(dxfNumber(record.tags, 70, 0) & (4 | 8 | 16)),
      entities: groupDxfEntities(records.slice(start, index)),
    });
  }
  return blocks;
}

/** 展开单层二维块。各方向等比缩放时，圆和椭圆仍可保留精确参数。 */
export function dxfInsert(blocks: Map<string, DxfBlock>, tags: DxfTags) {
  const block = blocks.get(dxfName(tags, 2) ?? '');
  if (!block) throw new UnsupportedDxfEntity('未找到块定义，可先在 CAD 中分解');
  if (block.external) throw new UnsupportedDxfEntity('已跳过外部参照块');
  const sx = dxfNumber(tags, 41, 1),
    sy = dxfNumber(tags, 42, 1);
  const factor = Math.abs(sx);
  if (
    !factor ||
    !sy ||
    Math.abs(factor - Math.abs(sy)) > factor * 1e-9 ||
    dxfNumber(tags, 70, 1) > 1 ||
    dxfNumber(tags, 71, 1) > 1
  )
    throw new UnsupportedDxfEntity('非等比块或块阵列可先在 CAD 中分解');

  const normal = dxfNormal(tags);
  const insertion = ocsPoint(dxfPoint(tags), normal);
  const rotation = angleVector(dxfNumber(tags, 50, 0));
  const mirror = Math.sign(sx * sy) * normal;
  const delta = (p: Vec2) =>
    ocsPoint(
      {
        x: p.x * sx * rotation.x - p.y * sy * rotation.y,
        y: p.x * sx * rotation.y + p.y * sy * rotation.x,
      },
      normal,
    );
  const at = (p: Vec2) => add(insertion, delta(sub(p, block.origin)));
  const direction = (degrees: number) => angle(delta(angleVector(degrees)));
  function transform(shape: DxfShape): DxfShape {
    switch (shape.kind) {
      case 'point':
        return { ...shape, position: at(shape.position) };
      case 'text':
        return {
          ...shape,
          position: at(shape.position),
          angle: direction(shape.angle),
          size: shape.size * factor,
        };
      case 'segment':
        return { ...shape, start: at(shape.start), end: at(shape.end) };
      case 'polyline':
      case 'curve':
        return { ...shape, points: shape.points.map(at) };
      case 'circle':
        return { ...shape, center: at(shape.center), radius: shape.radius * factor };
      case 'arc':
        return {
          ...shape,
          center: at(shape.center),
          radius: shape.radius * factor,
          startAngle: direction(shape.startAngle),
          sweep: shape.sweep * mirror,
        };
      case 'ellipse':
        return {
          ...shape,
          center: at(shape.center),
          major: delta(shape.major),
          startAngle: shape.startAngle * mirror,
          sweep: shape.sweep * mirror,
        };
    }
  }
  return { block, factor, transform };
}
