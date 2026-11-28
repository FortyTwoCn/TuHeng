import type { GeometryDocument, GeometryEntity, Vec2, Vec3 } from '@tuheng/contracts';
import {
  angle,
  dimensionValue,
  distance,
  length,
  lineGeometry,
  localToSheet,
  point,
} from '@tuheng/geometry-core';
import { entityNames, styleLabels } from '../../PropertyFields';

const patterns = {
  SOLID: '实线',
  DASHED: '虚线',
  CENTER: '中心线',
  PHANTOM: '双点画线',
  GUIDE: '辅助线',
};
const coordinate = ({ x, y, ...rest }: Vec2 | Vec3) =>
  `(${x}, ${y}${'z' in rest ? `, ${rest.z}` : ''})`;
type Field = [label: string, value: string | number];

function geometryFields(doc: GeometryDocument, entity: GeometryEntity): Field[] {
  const mm = (p: Vec2 | Vec3) => coordinate(p) + ' mm';
  const degrees = (value: number) => `${Number(value.toFixed(10))}°`;
  switch (entity.kind) {
    case 'point':
      return [
        ['点名', entity.name || '—'],
        ['局部坐标', mm(entity.position)],
        ['图纸坐标', mm(localToSheet(doc, entity.viewId, entity.position))],
      ];
    case 'segment': {
      const line = lineGeometry(doc, entity);
      const end = point(doc, entity.endPoint);
      return [
        ['起点坐标', mm(line.a)],
        ['终点坐标', mm(end)],
        ['长度', `${length(line.d)} mm`],
        ['方向角', degrees(angle(line.d))],
        ['图纸起点', mm(localToSheet(doc, entity.viewId, line.a))],
        ['图纸终点', mm(localToSheet(doc, entity.viewId, end))],
      ];
    }
    case 'line':
      return [
        ['锚点坐标', mm(entity.anchor)],
        ['方向角', degrees(angle(entity.direction))],
      ];
    case 'circle':
    case 'arc': {
      const fields: Field[] = [
        ['圆心坐标', mm(point(doc, entity.center))],
        ['半径', `${entity.radius} mm`],
      ];
      if (entity.kind === 'arc')
        fields.push(['起始角', degrees(entity.startAngle)], ['扫角', degrees(entity.sweep)]);
      return fields;
    }
    case 'ellipse':
      return [
        ['圆心坐标', mm(point(doc, entity.center))],
        ['长半轴', `${entity.majorRadius} mm`],
        ['短半轴', `${entity.minorRadius} mm`],
        ['方向角', degrees(entity.angle)],
        ['起始角', degrees(entity.startAngle)],
        ['扫角', degrees(entity.sweep)],
      ];
    case 'curve':
      return [
        ['通过点', entity.pointIds.length],
        ...entity.pointIds.map((id, i): Field => [`点 ${i + 1}`, mm(point(doc, id))]),
      ];
    case 'polyline': {
      const total = entity.points
        .slice(1)
        .reduce((sum, p, i) => sum + distance(p, entity.points[i]), 0);
      return [
        ['顶点数', entity.points.length],
        ['长度', `${total} mm`],
        ['起点坐标', mm(entity.points[0])],
        ['终点坐标', mm(entity.points.at(-1)!)],
      ];
    }
    case 'text':
      return [
        ['内容', entity.content],
        ['位置', mm(entity.position)],
        ['字高', `${entity.size} mm`],
        ['方向角', degrees(entity.angle)],
      ];
    case 'dimension': {
      let measurement = '—';
      try {
        const value = dimensionValue(doc, entity);
        measurement = entity.dimensionType === 'ANGULAR' ? degrees(value) : `${value} mm`;
      } catch {
        // 退化的标注仍可显示图纸记录的位置与文字。
      }
      return [
        ['测量值', measurement],
        ['位置', mm(entity.position)],
        ...(entity.textOverride ? [['标注文字', entity.textOverride] satisfies Field] : []),
      ];
    }
    case 'engineeringAnnotation':
      return [
        [
          '内容',
          entity.toleranceRows?.map((row) => row.filter(Boolean).join(' · ')).join(' / ') ??
            entity.fields.join(' · '),
        ],
        ['位置', mm(entity.position)],
        ['方向角', degrees(entity.angle)],
      ];
    case 'symbol':
      return [
        ['标记', entity.label || '—'],
        ['位置', mm(entity.position)],
        ['方向角', degrees(entity.angle)],
      ];
    case 'hatch':
      return [
        ['边界环数', entity.loops.length],
        ['图案原点', mm(entity.origin)],
        ['间距', `${entity.spacing} mm`],
        ['方向角', degrees(entity.angle)],
      ];
    case 'plane':
      return [
        ['空间原点', mm(entity.origin)],
        ['法向', coordinate(entity.normal)],
        ['方向', coordinate(entity.orientation)],
      ];
  }
}

export function ReferenceProperties({
  doc,
  entities,
}: {
  doc: GeometryDocument;
  entities: GeometryEntity[];
}) {
  return (
    <div className="geo-reference-properties" role="region" aria-label="参考图元属性">
      {entities.map((entity) => {
        const fields: Field[] = [
          ['投影视图', doc.views.find(({ id }) => id === entity.viewId)!.name],
          [
            '线型',
            entity.appearance?.pattern
              ? patterns[entity.appearance.pattern]
              : styleLabels[entity.lineStyle],
          ],
          ...geometryFields(doc, entity),
        ];
        return (
          <section key={entity.id} aria-label={entityNames[entity.kind]}>
            <h4>{entityNames[entity.kind]}</h4>
            <dl>
              {fields.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        );
      })}
    </div>
  );
}
