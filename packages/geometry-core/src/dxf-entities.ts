import {
  DXF_MAX_ENTITIES,
  dxfAppValue,
  dxfNormal,
  dxfNumber,
  dxfPoint,
  UnsupportedDxfEntity,
  type DxfRecord,
  type DxfTags,
} from './dxf-format';
import { readDxfHatch } from './dxf-hatch';
import {
  dxfArc,
  dxfCircle,
  dxfEllipse,
  dxfPolyline,
  dxfVertex,
  dxfVertices,
  type DxfShape,
} from './dxf-shapes';
import { readDxfSpline } from './dxf-spline';
import { readDxfDimension, readDxfText } from './dxf-text';

export type DxfEntityRecord = DxfRecord & { vertices?: DxfTags[] };

export function groupDxfEntities(records: DxfRecord[]): DxfEntityRecord[] {
  if (records.length > DXF_MAX_ENTITIES) throw Error('DXF 实体与顶点数量超过 20,000');
  const result: DxfEntityRecord[] = [];
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    if (!/^[\w]{1,64}$/.test(record.type)) throw Error('DXF 实体类型无效');
    if (record.type !== 'POLYLINE') {
      result.push(record);
      continue;
    }
    const vertices: DxfTags[] = [];
    while (records[index + 1]?.type === 'VERTEX') vertices.push(records[++index].tags);
    if (records[index + 1]?.type !== 'SEQEND') throw Error('DXF 的 POLYLINE 缺少 SEQEND');
    index++;
    result.push({ ...record, vertices });
  }
  return result;
}

export function readDxfShapes(record: DxfEntityRecord, metadata: DxfTags): DxfShape[] {
  const { type, tags } = record;
  switch (type) {
    case 'POINT':
      return [
        {
          kind: 'point',
          position: dxfPoint(tags),
          name: dxfAppValue(metadata, 'NAME')?.slice(0, 80),
          labelVisible: dxfAppValue(metadata, 'LABEL') === '1',
        },
      ];
    case 'LINE':
      if (Math.abs(dxfNumber(tags, 30, 0) - dxfNumber(tags, 31, 0)) > 1e-8)
        throw new UnsupportedDxfEntity('三维直线');
      return [{ kind: 'segment', start: dxfPoint(tags), end: dxfPoint(tags, 11) }];
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      const flags = dxfNumber(tags, 70, 0);
      if (type === 'POLYLINE' && flags & (8 | 16 | 64))
        throw new UnsupportedDxfEntity('三维多段线或网格');
      const records = record.vertices ?? dxfVertices(tags);
      if (type === 'LWPOLYLINE' && dxfNumber(tags, 90, records.length) !== records.length)
        throw Error('DXF 的 LWPOLYLINE 顶点数量与声明不符');
      const normal = dxfNormal(tags);
      return dxfPolyline(
        records.map((v) => dxfVertex(v, normal)),
        !!(flags & 1),
      );
    }
    case 'CIRCLE':
      return [dxfCircle(tags)];
    case 'ARC':
      return [dxfArc(tags)];
    case 'ELLIPSE':
      return [dxfEllipse(tags)];
    case 'SPLINE':
      return [readDxfSpline(tags, metadata)];
    case 'TEXT':
    case 'MTEXT':
      return [readDxfText(type, tags)];
    case 'HATCH':
      return readDxfHatch(tags);
    case 'DIMENSION':
      return readDxfDimension(tags);
    case 'INSERT':
      throw new UnsupportedDxfEntity('已跳过嵌套块，可先在 CAD 中分解');
    default:
      throw new UnsupportedDxfEntity('不支持的实体');
  }
}
