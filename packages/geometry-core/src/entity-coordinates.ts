import type { GeometryEntity, Vec2 } from '@tuheng/contracts';
import { angle, sub } from './math';

// 替换图元的局部坐标，同时处理镜像后的角度和曲线参数。
export function mapEntityCoordinates(
  e: GeometryEntity,
  at: (p: Vec2) => Vec2,
  {
    reorient,
    reflected,
    circularSpans,
  }: {
    reorient: boolean;
    reflected: boolean;
    circularSpans: ReadonlySet<string>;
  },
) {
  const origin = at({ x: 0, y: 0 });
  const vector = (v: Vec2) => sub(at(v), origin);
  const bearing = (theta: number) => {
    const radians = (theta * Math.PI) / 180;
    return reorient ? angle(vector({ x: Math.cos(radians), y: Math.sin(radians) })) : theta;
  };
  if ('position' in e) e.position = at(e.position);
  if (e.kind === 'point') e.spatial = null;
  if (e.kind === 'line') {
    e.anchor = at(e.anchor);
    if (reorient) e.direction = vector(e.direction);
  }
  if (e.kind === 'polyline') e.points = e.points.map(at);
  if (e.kind === 'dimension' && e.dimensionType === 'LINEAR' && reorient) {
    e.linearAngle = bearing(e.linearAngle ?? (e.linearAxis === 'Y' ? 90 : 0));
  }
  if (e.kind === 'arc') {
    e.startAngle = bearing(e.startAngle);
    if (reflected) e.sweep *= -1;
  }
  if (e.kind === 'ellipse') {
    e.angle = bearing(e.angle);
    if (reflected) {
      e.startAngle = -e.startAngle;
      e.sweep = -e.sweep;
    }
  }
  if (e.kind === 'text' || e.kind === 'symbol' || e.kind === 'engineeringAnnotation')
    e.angle = bearing(e.angle);
  if (e.kind === 'engineeringAnnotation' && e.leader) e.leader = at(e.leader);
  if (e.kind === 'symbol' && e.labelPosition) e.labelPosition = at(e.labelPosition);
  if (e.kind === 'symbol' && reflected) {
    if (e.symbolType === 'LEFT_ROTATION') e.symbolType = 'RIGHT_ROTATION';
    else if (e.symbolType === 'RIGHT_ROTATION') e.symbolType = 'LEFT_ROTATION';
  }
  if (e.kind === 'hatch') {
    e.origin = at(e.origin);
    e.angle = bearing(e.angle);
    if (reorient && e.spans) {
      const sign = reflected ? -1 : 1;
      const offset = bearing(0) / 360;
      e.spans = e.spans.map((ring) =>
        ring.map((span) => {
          if (!circularSpans.has(span.entityId)) return span;
          const translated = offset + span.from * sign;
          return {
            ...span,
            from: translated - Math.floor(translated),
            to: offset + span.to * sign - Math.floor(translated),
          };
        }),
      );
    }
  }
  if ('samples' in e && e.samples)
    e.samples = e.samples.map((p) => ({ ...at(p), pressure: p.pressure }));
}
