import type { GeometryDocument, GeometryEntity, Vec2 } from '@tuheng/contracts';
import { isCadEntity } from '@tuheng/contracts';
import { cadDrawing, ellipseAt, textCorners } from './cad-geometry';
import { localToSheet, viewTransform } from './sheet';
import { boundaryShape, atPiece } from './parametric-geometry';
import { diffPoly, polynomialRoots, sumPoly } from './curve-roots';
import {
  add,
  sub,
  angle,
  arcPoint,
  clipLine,
  dot,
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
  space: 'sheet' | 'local' = 'sheet',
) {
  const at = (p: Vec2) => (space === 'sheet' ? localToSheet(doc, e.viewId, p) : p);
  if (e.kind === 'point') return inside(at(e.position), b);
  if (e.kind === 'curve') {
    const shape = boundaryShape(doc, e);
    if (shape?.kind !== 'parametric') return false;
    const origin = at({ x: 0, y: 0 }),
      u = sub(at({ x: 1, y: 0 }), origin),
      v = sub(at({ x: 0, y: 1 }), origin);
    // Derivative zeros are the extrema of the actual retained Bézier spans.
    const pieceInside = (s: (typeof shape.pieces)[number]) => {
      const candidates = [s.lo, s.hi];
      for (const axis of ['x', 'y'] as const) {
        const polynomial = sumPoly(
          s.x.map((a) => u[axis] * a),
          s.y,
          v[axis],
        );
        polynomial[0] += origin[axis];
        candidates.push(...polynomialRoots(diffPoly(polynomial), s.lo, s.hi));
        if (mode === 'crossing') {
          for (const wall of [b[axis], b[axis] + (axis === 'x' ? b.width : b.height)]) {
            candidates.push(...polynomialRoots(sumPoly(polynomial, [-wall]), s.lo, s.hi));
          }
        }
      }
      const contains = (t: number) => inside(at(atPiece(s, t)), b);
      return mode === 'window' ? candidates.every(contains) : candidates.some(contains);
    };
    return mode === 'window' ? shape.pieces.every(pieceInside) : shape.pieces.some(pieceInside);
  }
  if (e.kind === 'ellipse') {
    const localCenter = point(doc, e.center),
      c = at(localCenter);
    const u = sub(at(ellipseAt(localCenter, e, 0)), c),
      v = sub(at(ellipseAt(localCenter, e, 90)), c);
    const params = [e.startAngle, e.startAngle + e.sweep];
    const entry = (t: number) => {
      if (onArc(t, e.startAngle, e.sweep)) params.push(t);
    };
    for (const axis of ['x', 'y'] as const) {
      const phase = (Math.atan2(v[axis], u[axis]) * 180) / Math.PI;
      entry(phase);
      entry(phase + 180);
      if (mode === 'crossing') {
        const radius = Math.hypot(u[axis], v[axis]),
          extent = axis === 'x' ? b.width : b.height;
        for (const wall of [b[axis], b[axis] + extent]) {
          const k = (wall - c[axis]) / radius;
          if (Math.abs(k) > 1 + 1e-9) continue;
          const t = (Math.acos(Math.max(-1, Math.min(1, k))) * 180) / Math.PI;
          entry(phase + t);
          entry(phase - t);
        }
      }
    }
    const contained = (t: number) => inside(at(ellipseAt(localCenter, e, t)), b);
    return mode === 'window' ? params.every(contained) : params.some(contained);
  }
  if (isCadEntity(e)) {
    const drawing = cadDrawing(doc, e);
    const labels = drawing.labels.map((label) => textCorners(label).map(at));
    if (mode === 'crossing') {
      // The entire selection window can lie inside the selectable text body.
      for (const [a, right, , top] of labels) {
        const p = sub({ x: b.x, y: b.y }, a),
          u = sub(right, a),
          v = sub(top, a);
        if (dot(p, u) >= 0 && dot(p, u) <= dot(u, u) && dot(p, v) >= 0 && dot(p, v) <= dot(v, v))
          return true;
      }
    }
    const paths = [...drawing.strokes.map((path) => path.map(at)), ...labels];
    return mode === 'window'
      ? paths.length > 0 && paths.every((path) => path.every((p) => inside(p, b)))
      : paths.some((path) =>
          path.some(
            (p, i) =>
              inside(p, b) ||
              (i > 0 && !!clipLine({ a: path[i - 1], d: sub(p, path[i - 1]), finite: true }, b)),
          ),
        );
  }
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
      f =
        space === 'sheet'
          ? viewTransform(doc, e.viewId)
          : { origin: { x: 0, y: 0 }, xAxis: { x: 1, y: 0 }, yAxis: { x: 0, y: 1 } },
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
