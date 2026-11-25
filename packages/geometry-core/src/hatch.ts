import {
  hatchRing,
  HATCH_ROW_LIMIT,
  HATCH_WORK_LIMIT,
  type CadEntity,
  type GeometryDocument,
  type GeometryEntity,
  type Vec2,
} from '@tuheng/contracts';
import { add, dot, scale, sub } from './vectors';
import { facePerimeter } from './cad-faces';

type Hatch = Extract<CadEntity, { kind: 'hatch' }>;
interface ScanBoundary {
  min: number;
  max: number;
  intersections(y: number): number[];
}

/** Intersections are computed in pattern coordinates in millimetres. Even/odd parity retains holes. */
export function hatchStrokes(doc: GeometryDocument, hatch: Hatch): Vec2[][] {
  if (!Number.isFinite(hatch.spacing) || hatch.spacing < 0.1 || hatch.spacing > 500)
    throw Error('剖面间距应为 0.1 至 500 mm');
  const rad = (hatch.angle * Math.PI) / 180,
    d = { x: Math.cos(rad), y: Math.sin(rad) },
    n = { x: -d.y, y: d.x };
  const at = (p: Vec2) => {
    const v = sub(p, hatch.origin);
    return { x: dot(v, d), y: dot(v, n) };
  };
  const byId = new Map(doc.entities.map((e) => [e.id, e]));
  const projected = (id: string) => {
    const p = byId.get(id);
    if (p?.kind !== 'point') throw Error('剖面边界点缺失');
    return at(p.position);
  };
  let sampledEdges = 0;
  function scanPolygon(points: Vec2[]): ScanBoundary {
    sampledEdges += points.length;
    return {
      min: Math.min(...points.map((p) => p.y)),
      max: Math.max(...points.map((p) => p.y)),
      intersections(y) {
        const xs: number[] = [];
        for (let i = 0; i < points.length; i++) {
          const a = points[i], b = points[(i + 1) % points.length];
          if ((a.y <= y && y < b.y) || (b.y <= y && y < a.y))
            xs.push(a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y));
        }
        return xs;
      },
    };
  }
  const rings: ScanBoundary[] = hatch.spans
    ? hatch.spans.map(spans=>scanPolygon(facePerimeter(doc,spans).map(at)))
    : hatch.loops.map((ids) => {
    const e = byId.get(ids[0]);
    if (ids.length === 1 && (e?.kind === 'circle' || e?.kind === 'ellipse')) {
      const c = projected(e.center);
      const a = e.kind === 'circle' ? e.radius : e.majorRadius,
        b = e.kind === 'circle' ? e.radius : e.minorRadius;
      const theta = (((e.kind === 'circle' ? 0 : e.angle) - hatch.angle) * Math.PI) / 180;
      const co = Math.cos(theta),
        si = Math.sin(theta),
        half = Math.hypot(a * si, b * co);
      return {
        min: c.y - half,
        max: c.y + half,
        intersections(y) {
          const v = y - c.y,
            factor = 1 - (v * v) / (half * half);
          if (factor <= 1e-12) return [];
          const mid = c.x + ((a * a - b * b) * co * si * v) / (half * half),
            h = (a * b * Math.sqrt(factor)) / half;
          return [mid - h, mid + h];
        },
      };
    }
    const segments = ids
      .map((id) => byId.get(id))
      .filter((s): s is Extract<GeometryEntity, { kind: 'segment' }> => s?.kind === 'segment');
    const points = hatchRing(segments).map(projected);
    if (!points.length) throw Error('剖面边界未闭合');
    return scanPolygon(points);
  });
  const lo = Math.ceil(Math.min(...rings.map((r) => r.min)) / hatch.spacing),
    hi = Math.floor(Math.max(...rings.map((r) => r.max)) / hatch.spacing);
  const rows = Math.max(0, hi - lo + 1),
    edges = sampledEdges || hatch.loops.reduce((count, ring) => count + ring.length, 0);
  if (rows > HATCH_ROW_LIMIT || rows * edges > HATCH_WORK_LIMIT)
    throw Error('剖面间距过小，请增加间距');
  const result: Vec2[][] = [];
  for (let k = lo; k <= hi; k++) {
    const y = k * hatch.spacing,
      xs = rings
        .flatMap((r) => (y >= r.min && y <= r.max ? r.intersections(y) : []))
        .sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i += 2) {
      if (xs[i] - xs[i - 1] < 1e-8) continue;
      const offset = add(hatch.origin, scale(n, y));
      result.push([add(offset, scale(d, xs[i - 1])), add(offset, scale(d, xs[i]))]);
    }
  }
  return result;
}
