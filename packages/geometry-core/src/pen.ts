import type { Vec2 } from '@tuheng/contracts';
import { angle, distance, dot, length, sub } from './math';
export type PenFit =
  | { kind: 'segment'; start: Vec2; end: Vec2 }
  | { kind: 'circle'; center: Vec2; radius: number }
  | { kind: 'arc'; center: Vec2; radius: number; startAngle: number; sweep: number }
  | { kind: 'polyline'; points: Vec2[] };
// Thresholds are expressed in document units after screen-to-world conversion.
export function fitStroke(points: Vec2[], tolerance = 0.6): PenFit {
  const fallback: PenFit = { kind: 'polyline', points: points.map((p) => ({ ...p })) };
  if (points.length < 6) return fallback;
  const mean = points.reduce(
    (s, p) => ({ x: s.x + p.x / points.length, y: s.y + p.y / points.length }),
    { x: 0, y: 0 },
  );
  let xx = 0,
    xy = 0,
    yy = 0;
  for (const p of points) {
    const d = sub(p, mean);
    xx += d.x * d.x;
    xy += d.x * d.y;
    yy += d.y * d.y;
  }
  const theta = Math.atan2(2 * xy, xx - yy) / 2,
    dir = { x: Math.cos(theta), y: Math.sin(theta) };
  const residual = Math.max(
    ...points.map((p) => Math.abs((p.x - mean.x) * dir.y - (p.y - mean.y) * dir.x)),
  );
  const pathLength = points.slice(1).reduce((s, p, i) => s + distance(p, points[i]), 0);
  const start = points[0],
    end = points[points.length - 1];
  if (
    distance(start, end) > 2 &&
    residual <= tolerance &&
    pathLength <= distance(start, end) * 1.12
  ) {
    const at = (p: Vec2) => {
      const t = dot(sub(p, mean), dir);
      return { x: mean.x + t * dir.x, y: mean.y + t * dir.y };
    };
    return { kind: 'segment', start: at(start), end: at(end) };
  }
  let bx = 0,
    by = 0;
  for (const p of points) {
    const d = sub(p, mean),
      r = dot(d, d);
    bx += (d.x * r) / 2;
    by += (d.y * r) / 2;
  }
  const det = xx * yy - xy * xy;
  if (Math.abs(det) < 1e-8) return fallback;
  const offset = { x: (bx * yy - by * xy) / det, y: (by * xx - bx * xy) / det };
  const center = { x: mean.x + offset.x, y: mean.y + offset.y };
  const radii = points.map((p) => distance(p, center)),
    radius = radii.reduce((a, b) => a + b, 0) / points.length;
  if (
    radius < 1 ||
    radius > 1000 ||
    Math.max(...radii.map((r) => Math.abs(r - radius))) > Math.min(tolerance, radius * 0.05)
  )
    return fallback;
  let sweep = 0,
    travel = 0;
  for (let i = 1; i < points.length; i++) {
    const delta =
      ((angle(sub(points[i], center)) - angle(sub(points[i - 1], center)) + 540) % 360) - 180;
    sweep += delta;
    travel += Math.abs(delta);
  }
  if (travel > Math.abs(sweep) * 1.1 || Math.abs(sweep) < 35 || Math.abs(sweep) > 385)
    return fallback;
  if (Math.abs(sweep) > 320 && distance(start, end) < Math.max(tolerance * 2, radius * 0.12))
    return { kind: 'circle', center, radius };
  if (Math.abs(sweep) > 350 || pathLength < length(sub(start, end))) return fallback;
  return { kind: 'arc', center, radius, startAngle: angle(sub(start, center)), sweep };
}
