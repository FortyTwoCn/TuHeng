import type { GeometryDocument, Vec2 } from '@tuheng/contracts';
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, n: number): Vec2 => ({ x: a.x * n || 0, y: a.y * n || 0 });
export const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2) => a.x * b.y - a.y * b.x;
export const length = (a: Vec2) => Math.hypot(a.x, a.y);
export const distance = (a: Vec2, b: Vec2) => length(sub(a, b));
export const angle = (a: Vec2) => (Math.atan2(a.y, a.x) * 180) / Math.PI;
export const unit = (a: Vec2) => scale(a, 1 / (length(a) || 1));
export const parallel = (a: Vec2, b: Vec2, tolerance = 0.001) =>
  Math.abs(cross(unit(a), unit(b))) <= tolerance;
export const perpendicular = (a: Vec2, b: Vec2, tolerance = 0.001) =>
  Math.abs(dot(unit(a), unit(b))) <= tolerance;
export function point(doc: GeometryDocument, id: string): Vec2 {
  const p = doc.entities.find((e) => e.id === id);
  if (p?.kind !== 'point') throw new Error('点引用不存在');
  return p.position;
}
