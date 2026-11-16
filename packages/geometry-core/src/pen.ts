import type { Vec2 } from '@tuheng/contracts';
import { angle, distance, dot, sub, intersect, foot } from './math';
import { curveSegments, cubicAt, flattenCurve } from './curves';
export type PenFit =
  | { kind: 'segment'; start: Vec2; end: Vec2 }
  | { kind: 'circle'; center: Vec2; radius: number }
  | { kind: 'arc'; center: Vec2; radius: number; startAngle: number; sweep: number }
  | { kind: 'polyline'; points: Vec2[] }
  | { kind: 'curve'; points: Vec2[] };
export type PenStrokeStyle = 'visible' | 'hidden' | 'construction';
export interface PenOptions {
  style?: PenStrokeStyle;
  cssPixelsPerMm: number;
  noisePixels?: number;
}
export function appendStrokeSample<T extends Vec2>(
  samples: T[],
  sample: T,
  minimumDistance: number,
) {
  if (samples.length && distance(samples[samples.length - 1], sample) <= minimumDistance) return;
  if (samples.length < 4096) samples.push(sample);
  else samples[samples.length - 1] = sample;
}
const quantile = (a: number[], q: number) =>
  [...a].sort((a, b) => a - b)[Math.floor((a.length - 1) * q)] ?? 0;
export function resampleStroke(input: Vec2[], count = 128): Vec2[] {
  const p = input.filter((p, i) => !i || distance(p, input[i - 1]) > 1e-7);
  if (p.length < 2) return p;
  const cumulative = [0];
  for (let i = 1; i < p.length; i++) cumulative.push(cumulative[i - 1] + distance(p[i - 1], p[i]));
  const result: Vec2[] = [];
  let j = 1;
  for (let i = 0; i < count; i++) {
    const at = (cumulative.at(-1)! * i) / (count - 1);
    while (j < p.length - 1 && cumulative[j] < at) j++;
    const f = (at - cumulative[j - 1]) / (cumulative[j] - cumulative[j - 1]);
    result.push({
      x: p[j - 1].x + (p[j].x - p[j - 1].x) * f,
      y: p[j - 1].y + (p[j].y - p[j - 1].y) * f,
    });
  }
  return result;
}
// Speed normalization, candidate generation, geometric residual and winding classification.
export function fitStroke(
  input: Vec2[],
  options: PenOptions | number = { cssPixelsPerMm: 4 },
): PenFit {
  const raw: PenFit = { kind: 'polyline', points: input.map((p) => ({ ...p })) };
  if (input.length < 2) return raw;
  const pixels = typeof options === 'number' ? 2.4 / options : options.cssPixelsPerMm;
  const fallback = () => fitFreeCurve(input, pixels) ?? raw;
  const noise = typeof options === 'number' ? options : (options.noisePixels ?? 2.4) / pixels;
  const points = resampleStroke(input);
  if (points.length < 2) return fallback();
  const mean = points.reduce(
    (m, p) => ({ x: m.x + p.x / points.length, y: m.y + p.y / points.length }),
    { x: 0, y: 0 },
  );
  let xx = 0,
    xy = 0,
    yy = 0,
    bx = 0,
    by = 0;
  for (const p of points) {
    const d = sub(p, mean),
      r = dot(d, d);
    xx += d.x * d.x;
    xy += d.x * d.y;
    yy += d.y * d.y;
    bx += (d.x * r) / 2;
    by += (d.y * r) / 2;
  }
  const theta = Math.atan2(2 * xy, xx - yy) / 2,
    dir = { x: Math.cos(theta), y: Math.sin(theta) };
  const start = points[0],
    end = points.at(-1)!,
    chord = distance(start, end),
    // Measure progress along the fitted direction. Dense subpixel sideways tremor
    // increases polyline length without representing a reversal of the stroke.
    path = points.slice(1).reduce((n, p, i) => n + Math.abs(dot(sub(p, points[i]), dir)), 0);
  const residual = points.map((p) => Math.abs((p.x - mean.x) * dir.y - (p.y - mean.y) * dir.x));
  const driftLimit = chord * 0.015;
  const lineLimit = Math.min(Math.max(noise, driftLimit), Math.max(0.75 / pixels, chord * 0.035));
  const p95 = quantile(residual, 0.95);
  const rms = Math.sqrt(residual.reduce((sum, error) => sum + error * error, 0) / residual.length);
  // A narrow, slowly wandering stroke can have a few offsets beyond the usual
  // noise band while staying close to a straight line overall. Bound both RMS
  // and the tails relative to its span, in the fitted direction (never screen x/y).
  // Use no pixel floor here: small arcs must not gain this extra drift allowance.
  const narrowDrift =
    rms <= driftLimit && p95 <= driftLimit * 2 && Math.max(...residual) <= driftLimit * 3;
  if (chord * pixels > 8 && (p95 <= lineLimit || narrowDrift) && path / chord < 1.14) {
    const at = (p: Vec2) => {
      const t = dot(sub(p, mean), dir);
      return { x: mean.x + t * dir.x, y: mean.y + t * dir.y };
    };
    return { kind: 'segment', start: at(start), end: at(end) };
  }
  if (input.length < 6) return fallback();
  const det = xx * yy - xy * xy;
  if (Math.abs(det) < 1e-10) return fallback();
  let center = { x: mean.x + (bx * yy - by * xy) / det, y: mean.y + (by * xx - bx * xy) / det };
  let radius = quantile(
    points.map((p) => distance(p, center)),
    0.5,
  );
  for (let step = 0; step < 12; step++) {
    let dx = 0,
      dy = 0,
      dr = 0,
      weights = 0;
    for (const p of points) {
      const r = distance(p, center);
      if (r < 1e-8) continue;
      const error = r - radius,
        w = Math.min(1, Math.max(noise, radius * 0.015) / Math.max(1e-8, Math.abs(error)));
      dx += (w * error * (p.x - center.x)) / r;
      dy += (w * error * (p.y - center.y)) / r;
      dr += w * error;
      weights += w;
    }
    center = { x: center.x + dx / weights, y: center.y + dy / weights };
    radius += dr / weights;
  }
  if (radius * pixels < 8 || radius > 1000) return fallback();
  const errors = points.map((p) => Math.abs(distance(p, center) - radius));
  const limit = Math.min(Math.max(noise, radius * 0.012), radius * 0.055);
  const trimmed = errors.filter((e) => e <= quantile(errors, 0.95));
  if (
    quantile(errors, 0.9) > limit ||
    Math.sqrt(trimmed.reduce((n, e) => n + e * e, 0) / trimmed.length) > limit * 0.8 ||
    quantile(errors, 1) > Math.max(noise * 3, radius * 0.16)
  )
    return fallback();
  let sweep = 0,
    travel = 0;
  for (let i = 1; i < points.length; i++) {
    const d =
      ((angle(sub(points[i], center)) - angle(sub(points[i - 1], center)) + 540) % 360) - 180;
    sweep += d;
    travel += Math.abs(d);
  }
  if (travel > Math.abs(sweep) * 1.12 || Math.abs(sweep) < 40 || Math.abs(sweep) > 385)
    return fallback();
  if (Math.abs(sweep) > 325 && chord < Math.max(noise * 2, radius * 0.14))
    return { kind: 'circle', center, radius };
  if (Math.abs(sweep) > 350) return fallback();
  return { kind: 'arc', center, radius, startAngle: angle(sub(start, center)), sweep };
}

// A few jagged samples are not evidence of a corner in a freehand curve.
// Work at a CSS-pixel scale, then bound the actual interpolated geometry against
// the input. The source samples are never replaced by these denoised fit points.
function fitFreeCurve(input: Vec2[], pixels: number): PenFit | undefined {
  if (input.length < 8) return;
  const travel = input.slice(1).reduce((n, p, i) => n + distance(p, input[i]), 0);
  const chord = distance(input[0], input.at(-1)!);
  if (travel * pixels < 30 || chord < travel * 0.3) return;
  const uniform = resampleStroke(
    input,
    Math.min(512, Math.max(16, Math.ceil((travel * pixels) / 2) + 1)),
  );
  const stepPixels = (travel * pixels) / (uniform.length - 1);
  const halfWindow = Math.min(3, Math.max(1, Math.ceil(3 / stepPixels)));
  const samples = uniform.map((p, i) => {
    if (i === 0 || i === uniform.length - 1) return p;
    let x = 0,
      y = 0,
      weights = 0;
    for (
      let j = Math.max(0, i - halfWindow);
      j <= Math.min(uniform.length - 1, i + halfWindow);
      j++
    ) {
      const w = Math.exp(-0.5 * ((j - i) / (halfWindow / 1.5)) ** 2);
      x += uniform[j].x * w;
      y += uniform[j].y * w;
      weights += w;
    }
    return { x: x / weights, y: y / weights };
  });
  // A small number of long straight runs with an abrupt join is a polygonal
  // stroke (including a shallow elbow), not a smooth free curve.
  const polygon = simplifyStroke(samples, 1.25 / pixels);
  const turns = polygon.slice(1, -1).map((p, i) => {
    const a = sub(p, polygon[i]),
      b = sub(polygon[i + 2], p);
    return Math.abs(Math.atan2(a.x * b.y - a.y * b.x, dot(a, b)));
  });
  if (
    (polygon.length <= 4 && turns.some((a) => a > 0.3)) ||
    turns.filter((a) => a > Math.PI / 2).length >= 3
  )
    return;
  // Ignore tiny loops within the noise window, but retain scribbles and real
  // crossings as raw input. Closed non-circular strokes also fail the chord test.
  for (let i = 1; i < samples.length; i++)
    for (let j = i + 2; j < samples.length; j++) {
      if ((j - i) * stepPixels < 12) continue;
      if (
        intersect(
          { a: samples[i - 1], d: sub(samples[i], samples[i - 1]), finite: true },
          { a: samples[j - 1], d: sub(samples[j], samples[j - 1]), finite: true },
        )
      )
        return;
    }
  // Start with sparse knots, then refine only intervals whose Hermite path
  // misses the smoothed trajectory. Merely interpolating dense noisy points
  // would preserve the same jagged stroke under a different entity kind.
  const count = Math.min(80, Math.max(5, Math.ceil((travel * pixels) / 16) + 1));
  const indices = [
    ...new Set(
      Array.from({ length: count }, (_, i) => Math.round((i * (samples.length - 1)) / (count - 1))),
    ),
  ];
  while (true) {
    if (indices.some((i, k) => k > 0 && distance(samples[i], samples[indices[k - 1]]) < 1e-8))
      return;
    const segments = curveSegments(indices.map((i) => samples[i]));
    let worst = 1.5 / pixels,
      insert = -1;
    for (let j = 0; j < segments.length; j++)
      for (let i = indices[j] + 1; i < indices[j + 1]; i++) {
        const error = distance(
          samples[i],
          cubicAt(segments[j], (i - indices[j]) / (indices[j + 1] - indices[j])),
        );
        if (error > worst) {
          worst = error;
          insert = i;
        }
      }
    if (insert < 0) break;
    if (indices.length >= 96) return;
    indices.push(insert);
    indices.sort((a, b) => a - b);
  }
  const points = indices.map((i) => samples[i]);
  const fitted = flattenCurve(points, 0.15 / pixels);
  const errors = uniform.map((p) => distanceToStroke(p, fitted) * pixels);
  if (
    quantile(errors, 0.95) > 2.5 ||
    input.some((p) => distanceToStroke(p, fitted) * pixels > 3.8) ||
    fitted.some((p) => distanceToStroke(p, uniform) * pixels > 3.8)
  )
    return;
  return { kind: 'curve', points };
}
function distanceToStroke(p: Vec2, points: Vec2[]) {
  let nearest = Infinity;
  for (let i = 1; i < points.length; i++) {
    const d = sub(points[i], points[i - 1]);
    const q = dot(d, d) > 1e-16 ? foot(p, { a: points[i - 1], d, finite: true }) : points[i];
    nearest = Math.min(nearest, distance(p, q));
  }
  return nearest;
}
function simplifyStroke(points: Vec2[], tolerance: number): Vec2[] {
  const selected = new Set([0, points.length - 1]);
  const pending = [[0, points.length - 1]];
  while (pending.length) {
    const [a, b] = pending.pop()!;
    let worst = tolerance,
      index = -1;
    for (let i = a + 1; i < b; i++) {
      const error = distanceToStroke(points[i], [points[a], points[b]]);
      if (error > worst) {
        worst = error;
        index = i;
      }
    }
    if (index >= 0) {
      selected.add(index);
      pending.push([a, index], [index, b]);
    }
  }
  return [...selected].sort((a, b) => a - b).map((i) => points[i]);
}
