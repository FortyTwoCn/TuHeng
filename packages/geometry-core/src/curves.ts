import type { Vec2 } from '@tuheng/contracts';

export interface CubicSegment {
  start: Vec2;
  c1: Vec2;
  c2: Vec2;
  end: Vec2;
}
/** Chord-length cubic Hermite interpolation. Knots are interpolated, not Bezier handles. */
export function curveSegments(points: Vec2[]): CubicSegment[] {
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
export function curvePath(points: Vec2[]) {
  if (!points.length) return '';
  return (
    `M ${points[0].x} ${points[0].y} ` +
    curveSegments(points)
      .map((s) => `C ${s.c1.x} ${s.c1.y} ${s.c2.x} ${s.c2.y} ${s.end.x} ${s.end.y}`)
      .join(' ')
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
export function flattenCurve(points: Vec2[], tolerance = 0.02): Vec2[] {
  const result: Vec2[] = points.length ? [points[0]] : [];
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
  for (const s of curveSegments(points)) visit(s, 0);
  return result;
}
