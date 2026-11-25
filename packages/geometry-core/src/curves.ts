import { quadraticSpline } from './quadratic-spline';
import type { Vec2 } from '@tuheng/contracts';

export interface CubicSegment {
  start: Vec2;
  c1: Vec2;
  c2: Vec2;
  end: Vec2;
}
/** Chord-length cubic Hermite interpolation. Knots are interpolated, not Bezier handles. */
export type Interpolation = 'CUBIC_HERMITE' | 'QUADRATIC_BSPLINE';
export function curveSegments(points: Vec2[], interpolation:Interpolation='CUBIC_HERMITE'): CubicSegment[] {
  if (interpolation==='QUADRATIC_BSPLINE') return quadraticSpline(points);
  if (points.length < 2) return [];
  const spans = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
  if (spans.some((d) => d < 1e-8)) throw Error('相邻曲线经过点不能重合');
  const tangents = points.map((p, i) => {
    const a = points[Math.max(0, i - 1)],
      b = points[Math.min(points.length - 1, i + 1)];
    const dt = (spans[i - 1] ?? 0) + (spans[i] ?? 0);
    return { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt };
  });
  return points.slice(1).map((end, i) => ({
    start: points[i],
    end,
    c1: {
      x: points[i].x + (tangents[i].x * spans[i]) / 3,
      y: points[i].y + (tangents[i].y * spans[i]) / 3,
    },
    c2: {
      x: end.x - (tangents[i + 1].x * spans[i]) / 3,
      y: end.y - (tangents[i + 1].y * spans[i]) / 3,
    },
  }));
}
type Interval = [number, number];
export function visibleCurveSegments(points: Vec2[], range?: Interval, interpolation?:Interpolation): CubicSegment[] {
  const spans = curveSegments(points,interpolation);
  if (!range) return spans;
  // Restrict the original cubic using endpoint derivatives (exact Bézier reparameterisation).
  const derivative = (s: CubicSegment, t: number) => {
    const u = 1 - t;
    return {
      x:
        3 *
        (u * u * (s.c1.x - s.start.x) + 2 * t * u * (s.c2.x - s.c1.x) + t * t * (s.end.x - s.c2.x)),
      y:
        3 *
        (u * u * (s.c1.y - s.start.y) + 2 * t * u * (s.c2.y - s.c1.y) + t * t * (s.end.y - s.c2.y)),
    };
  };
  return spans.flatMap((s, i) => {
    const a = Math.max(0, range[0] * spans.length - i),
      b = Math.min(1, range[1] * spans.length - i);
    if (b <= a) return [];
    const start = cubicAt(s, a),
      end = cubicAt(s, b),
      da = derivative(s, a),
      db = derivative(s, b),
      dt = (b - a) / 3;
    return [
      {
        start,
        end,
        c1: { x: start.x + da.x * dt, y: start.y + da.y * dt },
        c2: { x: end.x - db.x * dt, y: end.y - db.y * dt },
      },
    ];
  });
}
export function curvePath(points: Vec2[], range?: Interval, interpolation?:Interpolation) {
  const spans = visibleCurveSegments(points, range, interpolation);
  if (!spans.length) return '';
  return (
    `M ${spans[0].start.x} ${spans[0].start.y} ` +
    spans.map((s) => `C ${s.c1.x} ${s.c1.y} ${s.c2.x} ${s.c2.y} ${s.end.x} ${s.end.y}`).join(' ')
  );
}
export function cubicAt(s: CubicSegment, t: number): Vec2 {
  const u = 1 - t;
  return {
    x: u ** 3 * s.start.x + 3 * u * u * t * s.c1.x + 3 * u * t * t * s.c2.x + t ** 3 * s.end.x,
    y: u ** 3 * s.start.y + 3 * u * u * t * s.c1.y + 3 * u * t * t * s.c2.y + t ** 3 * s.end.y,
  };
}
// Preserve exact knots; adaptive subdivision approximates the path for picking in millimetres.
export function flattenCurve(points: Vec2[], tolerance = 0.02, range?: Interval, interpolation?:Interpolation): Vec2[] {
  const spans = visibleCurveSegments(points, range, interpolation);
  const result: Vec2[] = spans.length ? [spans[0].start] : [];
  const middle = (a: Vec2, b: Vec2) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const flat = (s: CubicSegment) => {
    const dx = s.end.x - s.start.x,
      dy = s.end.y - s.start.y,
      len = Math.hypot(dx, dy);
    return Math.max(
      ...[s.c1, s.c2].map((p) =>
        len
          ? Math.abs((p.x - s.start.x) * dy - (p.y - s.start.y) * dx) / len
          : Math.hypot(p.x - s.start.x, p.y - s.start.y),
      ),
    );
  };
  const visit = (s: CubicSegment, depth: number) => {
    if (depth >= 10 || flat(s) <= tolerance) {
      result.push(s.end);
      return;
    }
    const a = middle(s.start, s.c1),
      b = middle(s.c1, s.c2),
      c = middle(s.c2, s.end),
      d = middle(a, b),
      e = middle(b, c),
      f = middle(d, e);
    visit({ start: s.start, c1: a, c2: d, end: f }, depth + 1);
    visit({ start: f, c1: e, c2: c, end: s.end }, depth + 1);
  };
  for (const s of spans) visit(s, 0);
  return result;
}
