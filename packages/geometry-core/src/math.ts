import type { GeometryDocument, GeometryEntity, Vec2, Vec3 } from '@tuheng/contracts';
import { isCadEntity } from '@tuheng/contracts';
import { cadDrawing, textCorners } from './cad-geometry';
import { flattenCurve } from './curves';
import { projectPoint } from './projections';
import { add, sub, scale, dot, cross, distance, angle, point } from './vectors';
export * from './vectors';
export function lineGeometry(doc: GeometryDocument, e: GeometryEntity) {
  if (e.kind === 'line') return { a: e.anchor, d: e.direction, finite: false };
  if (e.kind === 'segment') {
    const a = point(doc, e.startPoint);
    return { a, d: sub(point(doc, e.endPoint), a), finite: true };
  }
  throw new Error('请选择线段或辅助线');
}
export type LineGeometry = ReturnType<typeof lineGeometry>;
export function foot(p: Vec2, line: LineGeometry): Vec2 {
  let t = dot(sub(p, line.a), line.d) / dot(line.d, line.d);
  if (line.finite) t = Math.max(0, Math.min(1, t));
  return add(line.a, scale(line.d, t));
}
export function intersect(a: LineGeometry, b: LineGeometry): Vec2 | null {
  const denominator = cross(a.d, b.d);
  if (Math.abs(denominator) < 1e-9) return null;
  const delta = sub(b.a, a.a),
    t = cross(delta, b.d) / denominator,
    u = cross(delta, a.d) / denominator;
  if ((a.finite && (t < -1e-9 || t > 1 + 1e-9)) || (b.finite && (u < -1e-9 || u > 1 + 1e-9)))
    return null;
  return add(a.a, scale(a.d, t));
}
export function minorArc(center: Vec2, start: Vec2, end: Vec2) {
  const startAngle = angle(sub(start, center));
  let sweep = ((angle(sub(end, center)) - startAngle + 540) % 360) - 180;
  if (Math.abs(sweep) < 1e-6) throw new Error('圆弧起止点必须不同');
  if (Math.abs(sweep + 180) < 1e-6) sweep = 180;
  return { radius: distance(center, start), startAngle, sweep };
}
export function arcPoint(center: Vec2, radius: number, degrees: number): Vec2 {
  return add(center, {
    x: radius * Math.cos((degrees * Math.PI) / 180),
    y: radius * Math.sin((degrees * Math.PI) / 180),
  });
}
export function arcSvgPath(
  center: Vec2,
  radius: number,
  startAngle: number,
  sweep: number,
): string {
  const start = arcPoint(center, radius, startAngle);
  const count = Math.abs(sweep) >= 360 ? 2 : 1;
  const commands = Array.from({ length: count }, (_, i) => {
    const end = arcPoint(center, radius, startAngle + (sweep * (i + 1)) / count);
    return `A ${radius} ${radius} 0 ${Math.abs(sweep / count) > 180 ? 1 : 0} ${sweep > 0 ? 1 : 0} ${end.x} ${end.y}`;
  });
  return `M ${start.x} ${start.y} ${commands.join(' ')}`;
}
export function planeFromPoints(a: Vec3, b: Vec3, c: Vec3) {
  const u = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z },
    v = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
  const n = { x: u.y * v.z - u.z * v.y, y: u.z * v.x - u.x * v.z, z: u.x * v.y - u.y * v.x };
  const size = Math.hypot(n.x, n.y, n.z),
    side = Math.hypot(u.x, u.y, u.z);
  if (size < 1e-8) throw new Error('三个点不能共线');
  return {
    origin: a,
    normal: { x: n.x / size, y: n.y / size, z: n.z / size },
    orientation: { x: u.x / side, y: u.y / side, z: u.z / side },
  };
}
export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export function clipLine(line: LineGeometry, box: Bounds): [Vec2, Vec2] | null {
  let lo = line.finite ? 0 : -Infinity,
    hi = line.finite ? 1 : Infinity;
  for (const [origin, direction, min, max] of [
    [line.a.x, line.d.x, box.x, box.x + box.width],
    [line.a.y, line.d.y, box.y, box.y + box.height],
  ]) {
    if (Math.abs(direction) < 1e-10) {
      if (origin < min || origin > max) return null;
      continue;
    }
    const a = (min - origin) / direction,
      b = (max - origin) / direction;
    lo = Math.max(lo, Math.min(a, b));
    hi = Math.min(hi, Math.max(a, b));
  }
  return lo <= hi ? [add(line.a, scale(line.d, lo)), add(line.a, scale(line.d, hi))] : null;
}
export function entityPath(doc: GeometryDocument, e: GeometryEntity, box: Bounds): Vec2[] {
  if (e.kind === 'point') return [e.position];
  if (e.kind === 'line' || e.kind === 'segment') return clipLine(lineGeometry(doc, e), box) ?? [];
  if (e.kind === 'polyline') return e.points;
  if (e.kind === 'curve')
    return flattenCurve(
      e.pointIds.map((id) => point(doc, id)),
      0.02,
      e.parameterRange,
      e.interpolation,
    );
  if (e.kind === 'plane') return planeOutline(doc, e);
  if (isCadEntity(e)) {
    const drawing = cadDrawing(doc, e);
    return [...drawing.strokes, ...drawing.labels.map(textCorners)].flat();
  }
  const c = point(doc, e.center),
    start = e.kind === 'arc' ? e.startAngle : 0,
    sweep = e.kind === 'arc' ? e.sweep : 360;
  return Array.from({ length: 73 }, (_, i) => arcPoint(c, e.radius, start + (sweep * i) / 72));
}
export function planeOutline(
  doc: GeometryDocument,
  e: Extract<GeometryEntity, { kind: 'plane' }>,
): Vec2[] {
  const u = e.orientation,
    n = e.normal;
  const v = { x: n.y * u.z - n.z * u.y, y: n.z * u.x - n.x * u.z, z: n.x * u.y - n.y * u.x };
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
    [-1, -1],
  ].map(([a, b]) =>
    projectPoint(
      doc,
      {
        x: e.origin.x + 10 * (u.x * a + v.x * b),
        y: e.origin.y + 10 * (u.y * a + v.y * b),
        z: e.origin.z + 10 * (u.z * a + v.z * b),
      },
      e.viewId,
    ),
  );
}
