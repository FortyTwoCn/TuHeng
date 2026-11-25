import type { GeometryEntity, Vec2 } from './geometry';

export const HATCH_ROW_LIMIT = 4096;
export const HATCH_WORK_LIMIT = 1_000_000;

/** Input validation is shared with the server-side document parser. A malformed hatch cannot
 * schedule unbounded drawing work or masquerade as a closed region. */
export function simpleHatchPolygon(points: Vec2[]): boolean {
  const turn = (a: Vec2, b: Vec2, c: Vec2) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const nearZero = (n: number) => Math.abs(n) <= 1e-8;
  const within = (a: Vec2, b: Vec2, c: Vec2) =>
    c.x >= Math.min(a.x, b.x) - 1e-8 &&
    c.x <= Math.max(a.x, b.x) + 1e-8 &&
    c.y >= Math.min(a.y, b.y) - 1e-8 &&
    c.y <= Math.max(a.y, b.y) + 1e-8;
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
    for (let j = i + 2; j < points.length; j++) {
      if (i === 0 && j === points.length - 1) continue;
      const c = points[j],
        d = points[(j + 1) % points.length];
      const ac = turn(a, b, c),
        ad = turn(a, b, d),
        ca = turn(c, d, a),
        cb = turn(c, d, b);
      if (
        (ac * ad < 0 && ca * cb < 0) ||
        (nearZero(ac) && within(a, b, c)) ||
        (nearZero(ad) && within(a, b, d)) ||
        (nearZero(ca) && within(c, d, a)) ||
        (nearZero(cb) && within(c, d, b))
      )
        return false;
    }
  }
  return !nearZero(area);
}
export function hatchPatternExtent(
  hatch: Extract<GeometryEntity, { kind: 'hatch' }>,
  entities: Map<string, GeometryEntity>,
): number {
  const a = (hatch.angle * Math.PI) / 180,
    nx = -Math.sin(a),
    ny = Math.cos(a);
  const y = (id: string) => {
    const p = entities.get(id);
    return p?.kind === 'point'
      ? (p.position.x - hatch.origin.x) * nx + (p.position.y - hatch.origin.y) * ny
      : 0;
  };
  let lo = Infinity,
    hi = -Infinity;
  for (const id of hatch.loops.flat()) {
    const e = entities.get(id);
    if (e?.kind === 'segment') {
      const v = y(e.startPoint),
        w = y(e.endPoint);
      lo = Math.min(lo, v, w);
      hi = Math.max(hi, v, w);
    } else if (e?.kind === 'circle' || e?.kind === 'ellipse' || e?.kind === 'arc') {
      const theta = e.kind === 'ellipse' ? ((e.angle - hatch.angle) * Math.PI) / 180 : 0;
      const r =
        e.kind !== 'ellipse'
          ? e.radius
          : Math.hypot(e.majorRadius * Math.sin(theta), e.minorRadius * Math.cos(theta));
      const c = y(e.center);
      lo = Math.min(lo, c - r);
      hi = Math.max(hi, c + r);
    } else if (e?.kind === 'curve') {
      const values = e.pointIds.map(y);
      const min = Math.min(...values), max = Math.max(...values);
      const slack = (max-min) * 0.5;
      lo = Math.min(lo, min-slack);
      hi = Math.max(hi, max+slack);
    }
  }
  for (const span of hatch.spans?.flat() ?? []) {
    const e=entities.get(span.entityId);
    if (e?.kind!=='line') continue;
    for (const t of [span.from,span.to]) {
      const x=e.anchor.x+t*e.direction.x, y=e.anchor.y+t*e.direction.y;
      const ordinate=(x-hatch.origin.x)*nx+(y-hatch.origin.y)*ny;
      lo=Math.min(lo,ordinate); hi=Math.max(hi,ordinate);
    }
  }
  return Math.max(0, Math.floor(hi / hatch.spacing) - Math.ceil(lo / hatch.spacing) + 1);
}
