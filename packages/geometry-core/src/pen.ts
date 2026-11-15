import type { Vec2 } from '@tuheng/contracts';
import { angle, distance, dot, sub } from './math';
export type PenFit =
  | { kind: 'segment'; start: Vec2; end: Vec2 }
  | { kind: 'circle'; center: Vec2; radius: number }
  | { kind: 'arc'; center: Vec2; radius: number; startAngle: number; sweep: number }
  | { kind: 'polyline'; points: Vec2[] };
export type PenStrokeStyle = 'visible' | 'hidden' | 'construction';
export interface PenOptions {
  style?: PenStrokeStyle;
  cssPixelsPerMm: number;
  noisePixels?: number;
  allowApproximateCircle?: boolean;
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
  const fallback: PenFit = { kind: 'polyline', points: input.map((p) => ({ ...p })) };
  if (input.length < 2) return fallback;
  const pixels = typeof options === 'number' ? 2.4 / options : options.cssPixelsPerMm;
  const noise = typeof options === 'number' ? options : (options.noisePixels ?? 2.4) / pixels;
  const points = resampleStroke(input);
  if (points.length < 2) return fallback;
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
  if (
    chord * pixels > 8 &&
    quantile(residual, 0.95) <= Math.min(noise, Math.max(0.75 / pixels, chord * 0.035)) &&
    path / chord < 1.14
  ) {
    const at = (p: Vec2) => {
      const t = dot(sub(p, mean), dir);
      return { x: mean.x + t * dir.x, y: mean.y + t * dir.y };
    };
    return { kind: 'segment', start: at(start), end: at(end) };
  }
  if (input.length < 6) return fallback;
  const det = xx * yy - xy * xy;
  if (Math.abs(det) < 1e-10) return fallback;
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
  if (radius * pixels < 8 || radius > 1000) return fallback;
  const errors = points.map((p) => Math.abs(distance(p, center) - radius));
  const limit = Math.min(Math.max(noise, radius * 0.012), radius * 0.055);
  const trimmed = errors.filter((e) => e <= quantile(errors, 0.95));
  if (typeof options !== 'number' && options.allowApproximateCircle)
    return { kind: 'circle', center, radius };
  if (
    quantile(errors, 0.9) > limit ||
    Math.sqrt(trimmed.reduce((n, e) => n + e * e, 0) / trimmed.length) > limit * 0.8 ||
    quantile(errors, 1) > Math.max(noise * 3, radius * 0.16)
  )
    return fallback;
  let sweep = 0,
    travel = 0;
  for (let i = 1; i < points.length; i++) {
    const d =
      ((angle(sub(points[i], center)) - angle(sub(points[i - 1], center)) + 540) % 360) - 180;
    sweep += d;
    travel += Math.abs(d);
  }
  if (travel > Math.abs(sweep) * 1.12 || Math.abs(sweep) < 40 || Math.abs(sweep) > 385)
    return fallback;
  if (Math.abs(sweep) > 325 && chord < Math.max(noise * 2, radius * 0.14))
    return { kind: 'circle', center, radius };
  if (Math.abs(sweep) > 350) return fallback;
  return { kind: 'arc', center, radius, startAngle: angle(sub(start, center)), sweep };
}
