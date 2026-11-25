import type { GeometryDocument, GeometryEntity, Vec2 } from '@tuheng/contracts';
import {
  add,
  sub,
  scale,
  dot,
  cross,
  angle,
  distance,
  length,
  point,
  unit,
  lineGeometry,
  type LineGeometry,
} from './math';
import { curveSegments } from './curves';
import {
  sumPoly,
  mulPoly,
  diffPoly,
  evalPoly,
  polynomialRoots,
  type Polynomial,
} from './curve-roots';

const rad = Math.PI / 180;
const rotate = (p: Vec2, theta: number): Vec2 => ({
  x: p.x * Math.cos(theta) - p.y * Math.sin(theta),
  y: p.x * Math.sin(theta) + p.y * Math.cos(theta),
});
export interface CurvePiece {
  x: Polynomial;
  y: Polynomial;
  w: Polynomial;
  lo: number;
  hi: number;
  parameter: (t: number) => number;
}
export interface Conic {
  center: Vec2;
  a: number;
  b: number;
  angle: number;
  start: number;
  sweep: number;
}
export type BoundaryShape =
  | { kind: 'line'; line: LineGeometry }
  | { kind: 'parametric'; pieces: CurvePiece[]; conic?: Conic; closed: boolean };

const power3 = (a: number, b: number, c: number, d: number) => [
  a,
  3 * (b - a),
  3 * (c - 2 * b + a),
  d - 3 * c + 3 * b - a,
];
export const atPiece = (s: CurvePiece, t: number): Vec2 => ({
  x: evalPoly(s.x, t) / evalPoly(s.w, t),
  y: evalPoly(s.y, t) / evalPoly(s.w, t),
});
const gradientPoly = (x: Polynomial, w: Polynomial) =>
  sumPoly(mulPoly(diffPoly(x), w), mulPoly(x, diffPoly(w)), -1);
export function tangentPiece(s: CurvePiece, t: number): Vec2 {
  const w = evalPoly(s.w, t);
  return {
    x: evalPoly(gradientPoly(s.x, s.w), t) / w ** 2,
    y: evalPoly(gradientPoly(s.y, s.w), t) / w ** 2,
  };
}
export function conicPoint(c: Conic, t: number): Vec2 {
  const theta = (c.start + t * c.sweep) * rad;
  return add(
    c.center,
    rotate({ x: c.a * Math.cos(theta), y: c.b * Math.sin(theta) }, c.angle * rad),
  );
}
export function conicParameter(c: Conic, p: Vec2): number {
  const q = rotate(sub(p, c.center), -c.angle * rad);
  const delta = (angle({ x: q.x / c.a, y: q.y / c.b }) - c.start) * Math.sign(c.sweep);
  let wrapped = ((delta % 360) + 360) % 360;
  if (Math.abs(wrapped - 360) < 1e-8) wrapped = 0;
  return wrapped / Math.abs(c.sweep);
}
function conicPieces(c: Conic): CurvePiece[] {
  const count = Math.ceil(Math.abs(c.sweep) / 90);
  return Array.from({ length: count }, (_, i) => {
    const first = conicPoint(c, i / count),
      last = conicPoint(c, (i + 1) / count);
    const mid = conicPoint(c, (i + 0.5) / count),
      weight = Math.cos((c.sweep * rad) / (2 * count));
    // The tangent intersection is the middle control point; weighting it gives this numerator.
    const wm = add(sub(mid, c.center), scale(c.center, weight));
    const numerator = (a: number, b: number, d: number) => [a, 2 * (b - a), a - 2 * b + d];
    const s: CurvePiece = {
      x: numerator(first.x, wm.x, last.x),
      y: numerator(first.y, wm.y, last.y),
      w: numerator(1, weight, 1),
      lo: 0,
      hi: 1,
      parameter: (t) => (t === 1 ? (i + 1) / count : conicParameter(c, atPiece(s, t))),
    };
    return s;
  });
}
export function boundaryShape(doc: GeometryDocument, e: GeometryEntity): BoundaryShape | undefined {
  if (e.kind === 'segment' || e.kind === 'line')
    return { kind: 'line', line: lineGeometry(doc, e) };
  if (e.kind === 'circle' || e.kind === 'arc' || e.kind === 'ellipse') {
    const c: Conic = {
      center: point(doc, e.center),
      a: e.kind === 'ellipse' ? e.majorRadius : e.radius,
      b: e.kind === 'ellipse' ? e.minorRadius : e.radius,
      angle: e.kind === 'ellipse' ? e.angle : 0,
      start: e.kind === 'circle' ? 0 : e.startAngle,
      sweep: e.kind === 'circle' ? 360 : e.sweep,
    };
    return {
      kind: 'parametric',
      pieces: conicPieces(c),
      conic: c,
      closed: Math.abs(c.sweep) >= 360,
    };
  }
  if (e.kind === 'curve') {
    const cs = curveSegments(e.pointIds.map((id) => point(doc, id)),e.interpolation),
      n = cs.length;
    const [lo, hi] = e.parameterRange ?? [0, 1];
    const pieces = cs
      .map((b, i) => ({
        x: power3(b.start.x, b.c1.x, b.c2.x, b.end.x),
        y: power3(b.start.y, b.c1.y, b.c2.y, b.end.y),
        w: [1],
        lo: Math.max(0, lo * n - i),
        hi: Math.min(1, hi * n - i),
        parameter: (t: number) => (i + t) / n,
      }))
      .filter((s) => s.hi > s.lo);
    return { kind: 'parametric', pieces, closed: false };
  }
}
export function stationaryPoints(shape: BoundaryShape, origin: Vec2, mode: 'normal' | 'tangent') {
  if (shape.kind === 'line') {
    if (mode === 'tangent') return [];
    const l = shape.line,
      t = dot(sub(origin, l.a), l.d) / dot(l.d, l.d);
    return !l.finite || (t >= 0 && t <= 1) ? [{ t, position: add(l.a, scale(l.d, t)) }] : [];
  }
  return shape.pieces.flatMap((s) => {
    const dx = sumPoly(s.x, s.w, -origin.x),
      dy = sumPoly(s.y, s.w, -origin.y);
    const vx = gradientPoly(s.x, s.w),
      vy = gradientPoly(s.y, s.w);
    const poly =
      mode === 'normal'
        ? sumPoly(mulPoly(vx, dx), mulPoly(vy, dy))
        : sumPoly(mulPoly(vx, dy), mulPoly(vy, dx), -1);
    return polynomialRoots(poly, s.lo, s.hi).filter(t=>
      mode !== 'tangent' || length(tangentPiece(s,t))>1e-10
    ).map((t) => ({
      t: s.parameter(t),
      position: atPiece(s, t),
    }));
  });
}
export function boundaryAt(shape: BoundaryShape, t: number): Vec2 {
  if (shape.kind === 'line') return add(shape.line.a, scale(shape.line.d, t));
  if (shape.conic) return conicPoint(shape.conic, t);
  for (const piece of shape.pieces) {
    const start = piece.parameter(piece.lo), end = piece.parameter(piece.hi);
    if (t >= start - 1e-8 && t <= end + 1e-8)
      return atPiece(piece, Math.max(piece.lo, Math.min(piece.hi, piece.lo + (piece.hi - piece.lo) * (t - start) / (end - start))));
  }
  throw Error('曲线范围无效');
}

export function nearestOnShape(shape: BoundaryShape, p: Vec2) {
  const candidates = stationaryPoints(shape, p, 'normal');
  if (shape.kind === 'line') {
    const l = shape.line;
    if (l.finite) candidates.push({ t: 0, position: l.a }, { t: 1, position: add(l.a, l.d) });
  } else
    for (const s of shape.pieces)
      candidates.push(...[s.lo, s.hi].map((t) => ({ t: s.parameter(t), position: atPiece(s, t) })));
  return candidates.reduce((best, c) =>
    distance(p, c.position) < distance(p, best.position) ? c : best,
  );
}

/** Half the visible arc length. The tolerance is in paper millimetres. */
export function curvedMidpoint(shape: Extract<BoundaryShape, { kind: 'parametric' }>): Vec2 {
  if (shape.conic && shape.conic.a === shape.conic.b) return conicPoint(shape.conic, 0.5);
  function arcLength(s: CurvePiece, lo: number, hi: number) {
    const speed = (t: number) => length(tangentPiece(s, t));
    function integrate(
      l: number,
      h: number,
      vl: number,
      vm: number,
      vh: number,
      whole: number,
      tol: number,
      depth: number,
    ): number {
      const m = (l + h) / 2,
        lm = speed((l + m) / 2),
        rm = speed((m + h) / 2);
      const left = ((m - l) * (vl + 4 * lm + vm)) / 6,
        right = ((h - m) * (vm + 4 * rm + vh)) / 6;
      const error = left + right - whole;
      if (depth >= 12 || Math.abs(error) <= 15 * tol) return left + right + error / 15;
      return (
        integrate(l, m, vl, lm, vm, left, tol / 2, depth + 1) +
        integrate(m, h, vm, rm, vh, right, tol / 2, depth + 1)
      );
    }
    const a = speed(lo),
      b = speed((lo + hi) / 2),
      c = speed(hi);
    return integrate(lo, hi, a, b, c, ((hi - lo) * (a + 4 * b + c)) / 6, 1e-7, 0);
  }
  const spans = shape.pieces.map((s) => arcLength(s, s.lo, s.hi));
  let left = spans.reduce((n, v) => n + v, 0) / 2;
  for (let i = 0; i < spans.length; i++) {
    if (left > spans[i]) {
      left -= spans[i];
      continue;
    }
    const s = shape.pieces[i];
    let lo = s.lo,
      hi = s.hi;
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      if (arcLength(s, s.lo, mid) < left) lo = mid;
      else hi = mid;
    }
    return atPiece(s, (lo + hi) / 2);
  }
  const s = shape.pieces.at(-1)!;
  return atPiece(s, s.hi);
}

export interface ShapeHit {
  position: Vec2;
  a: number;
  b: number;
  tangent: boolean;
}
const isTangent = (a: Vec2, b: Vec2) => Math.abs(cross(unit(a), unit(b))) < 1e-7;
function lineHits(l: LineGeometry, shape: BoundaryShape): ShapeHit[] {
  if (shape.kind === 'line') {
    const m = shape.line,
      den = cross(l.d, m.d);
    if (isTangent(l.d, m.d)) return [];
    const pq = sub(m.a, l.a),
      a = cross(pq, m.d) / den,
      b = cross(pq, l.d) / den;
    if ((l.finite && (a < -1e-9 || a > 1 + 1e-9)) || (m.finite && (b < -1e-9 || b > 1 + 1e-9)))
      return [];
    return [{ a, b, position: add(l.a, scale(l.d, a)), tangent: false }];
  }
  return shape.pieces.flatMap((s) => {
    const x = sumPoly(s.x, s.w, -l.a.x),
      y = sumPoly(s.y, s.w, -l.a.y);
    const poly = sumPoly(
      x.map((v) => v * l.d.y),
      y,
      -l.d.x,
    );
    return polynomialRoots(poly, s.lo, s.hi).flatMap((t) => {
      const position = atPiece(s, t),
        a = dot(sub(position, l.a), l.d) / dot(l.d, l.d);
      return l.finite && (a < -1e-9 || a > 1 + 1e-9)
        ? []
        : [{ a, b: s.parameter(t), position, tangent: isTangent(l.d, tangentPiece(s, t)) }];
    });
  });
}
function conicHits(c: Conic, pieces: CurvePiece[]): ShapeHit[] {
  const cos = Math.cos(c.angle * rad),
    sin = Math.sin(c.angle * rad);
  return pieces.flatMap((s) => {
    const x = sumPoly(s.x, s.w, -c.center.x),
      y = sumPoly(s.y, s.w, -c.center.y);
    const u = sumPoly(
      x.map((v) => v * cos),
      y,
      sin,
    ).map((v) => v / c.a);
    const v = sumPoly(
      y.map((v) => v * cos),
      x,
      -sin,
    ).map((value) => value / c.b);
    const equation = sumPoly(sumPoly(mulPoly(u, u), mulPoly(v, v)), mulPoly(s.w, s.w), -1);
    return polynomialRoots(equation, s.lo, s.hi).flatMap((t) => {
      const position = atPiece(s, t),
        a = conicParameter(c, position);
      if (a > 1 + 1e-8 || distance(position, conicPoint(c, a)) > 1e-6) return [];
      const theta = (c.start + c.sweep * a) * rad;
      const direction = rotate(
        { x: -c.a * Math.sin(theta), y: c.b * Math.cos(theta) },
        c.angle * rad,
      );
      return [
        { a, b: s.parameter(t), position, tangent: isTangent(direction, tangentPiece(s, t)) },
      ];
    });
  });
}
/** Polynomial cubics only. Exact extrema keep the search independent of viewport scale. */
function bounds(s: CurvePiece, lo: number, hi: number) {
  const values = (v: Polynomial) =>
    [lo, ...polynomialRoots(diffPoly(v), lo, hi), hi].map((t) => evalPoly(v, t));
  const x = values(s.x),
    y = values(s.y);
  return { x1: Math.min(...x), x2: Math.max(...x), y1: Math.min(...y), y2: Math.max(...y) };
}
function splineHits(s: CurvePiece, r: CurvePiece): ShapeHit[] {
  const result: ShapeHit[] = [];
  // Coincident/reversed spans have no unique boundary intersection.
  const equalSpan = (reverse: boolean) =>
    [0, 0.25, 0.5, 0.75, 1].every(
      (t) => distance(atPiece(s, t), atPiece(r, reverse ? 1 - t : t)) < 1e-8,
    );
  if (equalSpan(false) || equalSpan(true)) return [];
  let visits = 0;
  function visit(l: number, h: number, m: number, n: number, depth: number) {
    if (++visits > 12000) throw Error('样条边界重合或过于接近，无法唯一确定交点');
    const a = bounds(s, l, h),
      b = bounds(r, m, n);
    if (a.x2 < b.x1 - 1e-9 || a.x1 > b.x2 + 1e-9 || a.y2 < b.y1 - 1e-9 || a.y1 > b.y2 + 1e-9)
      return;
    const as = Math.max(a.x2 - a.x1, a.y2 - a.y1),
      bs = Math.max(b.x2 - b.x1, b.y2 - b.y1);
    if (depth < 42 && Math.max(as, bs) > 0.002) {
      if (as > bs) {
        const mid = (l + h) / 2;
        visit(l, mid, m, n, depth + 1);
        visit(mid, h, m, n, depth + 1);
      } else {
        const mid = (m + n) / 2;
        visit(l, h, m, mid, depth + 1);
        visit(l, h, mid, n, depth + 1);
      }
      return;
    }
    let t = (l + h) / 2,
      u = (m + n) / 2;
    for (let i = 0; i < 24; i++) {
      const delta = sub(atPiece(r, u), atPiece(s, t)),
        dt = tangentPiece(s, t),
        du = tangentPiece(r, u),
        den = cross(dt, du);
      if (length(delta) < 1e-10 || Math.abs(den) < 1e-16) break;
      t += cross(delta, du) / den;
      u += cross(delta, dt) / den;
      if (t < l - 1e-7 || t > h + 1e-7 || u < m - 1e-7 || u > n + 1e-7) return;
    }
    const p = atPiece(s, t);
    if (distance(p, atPiece(r, u)) < 1e-7)
      result.push({
        a: s.parameter(t),
        b: r.parameter(u),
        position: p,
        tangent: isTangent(tangentPiece(s, t), tangentPiece(r, u)),
      });
  }
  visit(s.lo, s.hi, r.lo, r.hi, 0);
  return result;
}
function sameConic(a: Conic, b: Conic) {
  return (
    distance(a.center, b.center) < 1e-9 &&
    Math.abs(a.a - b.a) < 1e-9 &&
    Math.abs(a.b - b.b) < 1e-9 &&
    (a.a === a.b || Math.abs(Math.sin((a.angle - b.angle) * rad)) < 1e-10)
  );
}
/** Positive-length common spans cannot define a unique cut. Endpoint-only contact is allowed. */
export function overlappingBoundaries(a: BoundaryShape, b: BoundaryShape): boolean {
  if (a.kind === 'line' && b.kind === 'line') {
    const la = a.line,
      lb = b.line,
      u = unit(la.d);
    if (!isTangent(la.d, lb.d) || Math.abs(cross(u, sub(lb.a, la.a))) > 1e-8) return false;
    if (!la.finite || !lb.finite) return true;
    const t = dot(sub(lb.a, la.a), u),
      end = t + dot(lb.d, u);
    return Math.min(length(la.d), Math.max(t, end)) - Math.max(0, Math.min(t, end)) > 1e-8;
  }
  if (a.kind === 'parametric' && b.kind === 'parametric') {
    if (a.conic && b.conic && sameConic(a.conic, b.conic)) {
      if (a.closed || b.closed) return true;
      const test = (x: Conic, y: Conic) =>
        [0, 0.5, 1].some((t) => {
          const u = conicParameter(y, conicPoint(x, t));
          return u > 1e-9 && u < 1 - 1e-9;
        });
      return test(a.conic, b.conic) || test(b.conic, a.conic);
    }
    if (!a.conic && !b.conic)
      return a.pieces.some((s) =>
        b.pieces.some((r) =>
          [false, true].some(
            (reversed) =>
              Math.min(s.hi, reversed ? 1 - r.lo : r.hi) -
                Math.max(s.lo, reversed ? 1 - r.hi : r.lo) >
                1e-9 &&
              [0, 0.333, 0.667, 1].every(
                (t) => distance(atPiece(s, t), atPiece(r, reversed ? 1 - t : t)) < 1e-9,
              ),
          ),
        ),
      );
  }
  return false;
}
export function shapeIntersections(a: BoundaryShape, b: BoundaryShape): ShapeHit[] {
  const reverse = (hits: ShapeHit[]) => hits.map((h) => ({ ...h, a: h.b, b: h.a }));
  let hits: ShapeHit[];
  if (a.kind === 'line') hits = lineHits(a.line, b);
  else if (b.kind === 'line') hits = reverse(lineHits(b.line, a));
  else if (a.conic && b.conic && sameConic(a.conic, b.conic)) hits = [];
  else if (a.conic) hits = conicHits(a.conic, b.pieces);
  else if (b.conic) hits = reverse(conicHits(b.conic, a.pieces));
  else hits = a.pieces.flatMap((s) => b.pieces.flatMap((r) => splineHits(s, r)));
  return hits.filter(
    (h, i) =>
      !hits
        .slice(0, i)
        .some(
          (other) => distance(other.position, h.position) < 1e-7 && Math.abs(other.a - h.a) < 1e-7,
        ),
  );
}
