import type { Vec2 } from '@tuheng/contracts';
import type { CubicSegment } from './curves';
import { add, distance, scale, sub } from './vectors';

const degree = 2;
function basis(knots: number[], size: number, u: number) {
  let span = degree;
  while (span + 1 < size && u >= knots[span + 1]) span++;
  const values = [1, 0, 0],
    left = [0, 0, 0],
    right = [0, 0, 0];
  for (let j = 1; j <= degree; j++) {
    left[j] = u - knots[span + 1 - j];
    right[j] = knots[span + j] - u;
    let next = 0;
    for (let r = 0; r < j; r++) {
      const width = right[r + 1] + left[j - r];
      const weight = width ? values[r] / width : 0;
      values[r] = next + right[r + 1] * weight;
      next = left[j - r] * weight;
    }
    values[j] = next;
  }
  return { first: span - degree, values };
}

/** Chord-length interpolation with clamped quadratic B-spline knots.
 * Convert each polynomial span to the common, exact Bézier representation. */
export function quadraticSpline(points: Vec2[]): CubicSegment[] {
  const size = points.length;
  if (size < 3) throw Error('二次样条需要三个经过点');
  let total = 0;
  const distances = points.map((p, i) => {
    if (!i) return 0;
    const chord = distance(p, points[i - 1]);
    if (chord < 1e-8) throw Error('相邻曲线经过点不能重合');
    total += chord;
    return total;
  });
  const u = distances.map((d) => d / total);
  const knots = [
    0,
    0,
    0,
    ...Array.from({ length: size - 3 }, (_, i) => (u[i + 1] + u[i + 2]) / 2),
    1,
    1,
    1,
  ];
  const rows = u.map((p, i) => {
    const row = new Float64Array(size + 2),
      b = basis(knots, size, p);
    row.set(b.values, b.first);
    row[size] = points[i].x;
    row[size + 1] = points[i].y;
    return row;
  });
  for (let i = 0; i < size; i++) {
    if (Math.abs(rows[i][i]) < 1e-12) throw Error('样条经过点间距过小，无法稳定拟合');
    for (let k = i + 1; k < size; k++) {
      if (!rows[k][i]) continue;
      const ratio = rows[k][i] / rows[i][i];
      for (let j = i; j < size + 2; j++) rows[k][j] -= rows[i][j] * ratio;
    }
  }
  const controls = Array.from({ length: size }, () => ({ x: 0, y: 0 }));
  for (let i = size - 1; i >= 0; i--) {
    let p = { x: rows[i][size], y: rows[i][size + 1] };
    for (let j = i + 1; j < size; j++) if (rows[i][j]) p = sub(p, scale(controls[j], rows[i][j]));
    controls[i] = scale(p, 1 / rows[i][i]);
  }
  const at = (t: number) => {
    const b = basis(knots, size, t);
    return b.values.reduce((p, w, i) => add(p, scale(controls[b.first + i], w)), { x: 0, y: 0 });
  };
  return knots.slice(degree, size).map((start, i) => {
    const end = knots[degree + i + 1],
      a = at(start),
      b = at(end),
      mid = at((start + end) / 2);
    const q = sub(scale(mid, 2), scale(add(a, b), 0.5));
    return {
      start: a,
      end: b,
      c1: add(a, scale(sub(q, a), 2 / 3)),
      c2: add(b, scale(sub(q, b), 2 / 3)),
    };
  });
}
