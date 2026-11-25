import type { GeometryDocument, Vec2 } from '@tuheng/contracts';
import { add, angle, cross, distance, lineGeometry, point, scale, sub, unit } from './math';

type Edge = ReturnType<typeof lineGeometry>;
const wrap = (n: number) => ((n % 360) + 360) % 360;

export function automaticLinearAxis(a: Vec2, b: Vec2, p: Vec2): 'X' | 'Y' {
  const x = Math.abs(b.x - a.x),
    y = Math.abs(b.y - a.y);
  if (x < 1e-8) return 'Y';
  if (y < 1e-8) return 'X';
  const between = (q: number, s: number, t: number) => q > Math.min(s, t) && q < Math.max(s, t);
  const insideX = between(p.x, a.x, b.x),
    insideY = between(p.y, a.y, b.y);
  if (insideX !== insideY) return insideX ? 'X' : 'Y';
  return x >= y ? 'X' : 'Y';
}

export function angleMeasurement(doc: GeometryDocument, ids: readonly string[], position: Vec2) {
  if (ids.length === 3) {
    const [vertex, b, c] = ids.map((id) => point(doc, id));
    const u = sub(b, vertex),
      v = sub(c, vertex);
    if (distance(vertex, b) < 1e-8 || distance(vertex, c) < 1e-8)
      throw Error('测角射线长度不能为零');
    const sweep = (Math.atan2(cross(u, v), u.x * v.x + u.y * v.y) * 180) / Math.PI;
    return { vertex, start: angle(u), sweep };
  }
  const edges = ids.map((id) => {
    const e = doc.entities.find((e) => e.id === id);
    if (e?.kind !== 'segment' && e?.kind !== 'line') throw Error('选择两条直线测角');
    return lineGeometry(doc, e);
  });
  const [a, b] = edges as [Edge, Edge];
  const determinant = cross(unit(a.d), unit(b.d));
  if (Math.abs(determinant) < 1e-8) throw Error('平行线无法定位夹角');
  const vertex = add(a.a, scale(a.d, cross(sub(b.a, a.a), b.d) / cross(a.d, b.d)));
  const rays = [angle(a.d), angle(b.d), angle(a.d) + 180, angle(b.d) + 180]
    .map(wrap)
    .sort((x, y) => x - y);
  const heading = wrap(angle(sub(position, vertex)));
  const index = rays.filter((ray) => ray <= heading).length - 1;
  const slot = (index + 4) % 4,
    start = rays[slot];
  const sweep = wrap(rays[(slot + 1) % 4] - start);
  return { vertex, start, sweep };
}
