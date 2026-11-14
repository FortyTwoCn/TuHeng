import type { GeometryDocument, GeometryEntity, Vec2 } from '@tuheng/contracts';
import { localToSheet, viewTransform } from './sheet';
import {
  add,
  sub,
  angle,
  arcPoint,
  clipLine,
  lineGeometry,
  point,
  planeOutline,
  type Bounds,
} from './math';
export type SelectionMode = 'window' | 'crossing';
const inside = (p: Vec2, b: Bounds) =>
  p.x >= b.x - 1e-8 &&
  p.x <= b.x + b.width + 1e-8 &&
  p.y >= b.y - 1e-8 &&
  p.y <= b.y + b.height + 1e-8;
const onArc = (a: number, start: number, sweep: number) =>
  ((sweep >= 0 ? a - start : start - a) + 720) % 360 <= Math.abs(sweep) + 1e-7;
export function entityInMarquee(
  doc: GeometryDocument,
  e: GeometryEntity,
  b: Bounds,
  mode: SelectionMode,
) {
  const at = (p: Vec2) => localToSheet(doc, e.viewId, p);
  if (e.kind === 'point') return inside(at(e.position), b);
  if (e.kind === 'segment' || e.kind === 'line') {
    const l = lineGeometry(doc, e),
      a = at(l.a),
      d = sub(at(add(l.a, l.d)), a);
    return mode === 'window'
      ? l.finite && inside(a, b) && inside(add(a, d), b)
      : !!clipLine({ a, d, finite: l.finite }, b);
  }
  if (e.kind === 'circle' || e.kind === 'arc') {
    const c = at(point(doc, e.center)),
      f = viewTransform(doc, e.viewId),
      determinant = f.xAxis.x * f.yAxis.y - f.xAxis.y * f.yAxis.x;
    const localStart = e.kind === 'arc' ? e.startAngle : 0,
      v = { x: Math.cos((localStart * Math.PI) / 180), y: Math.sin((localStart * Math.PI) / 180) };
    const start = angle(sub(at(v), f.origin)),
      sweep = (e.kind === 'arc' ? e.sweep : 360) * determinant;
    const relevant = (a: number) => Math.abs(sweep) === 360 || onArc(a, start, sweep);
    const extrema = [start, start + sweep, ...[0, 90, 180, 270].filter(relevant)].map((a) =>
      arcPoint(c, e.radius, a),
    );
    if (mode === 'window') return extrema.every((p) => inside(p, b));
    if (extrema.some((p) => inside(p, b))) return true;
    const candidates: Vec2[] = [];
    for (const x of [b.x, b.x + b.width]) {
      const r = e.radius ** 2 - (x - c.x) ** 2;
      if (r >= 0) for (const sign of [-1, 1]) candidates.push({ x, y: c.y + sign * Math.sqrt(r) });
    }
    for (const y of [b.y, b.y + b.height]) {
      const r = e.radius ** 2 - (y - c.y) ** 2;
      if (r >= 0) for (const sign of [-1, 1]) candidates.push({ y, x: c.x + sign * Math.sqrt(r) });
    }
    return candidates.some((p) => inside(p, b) && relevant(angle(sub(p, c))));
  }
  const p = (e.kind === 'polyline' ? e.points : planeOutline(doc, e)).map(at);
  return mode === 'window'
    ? p.every((v) => inside(v, b))
    : p.some(
        (v, i) =>
          inside(v, b) ||
          (i > 0 && !!clipLine({ a: p[i - 1], d: sub(v, p[i - 1]), finite: true }, b)),
      );
}
export function marqueeSelection(
  doc: GeometryDocument,
  b: Bounds,
  mode: SelectionMode,
  hidden: string[] = [],
) {
  return doc.entities
    .filter((e) => !hidden.includes(e.layerId) && entityInMarquee(doc, e, b, mode))
    .map((e) => e.id);
}
