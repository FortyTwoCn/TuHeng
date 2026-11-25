/** Ascending powers. Derivative roots partition the interval into monotone pieces,
 * so a double root at a tangency is found even without a sign change. */
export type Polynomial = number[];
export function sumPoly(a: Polynomial, b: Polynomial, factor = 1) {
  return Array.from(
    { length: Math.max(a.length, b.length) },
    (_, i) => (a[i] ?? 0) + factor * (b[i] ?? 0),
  );
}
export function mulPoly(a: Polynomial, b: Polynomial) {
  const out = Array<number>(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j];
  return out;
}
export const diffPoly = (a: Polynomial) =>
  a.length === 1 ? [0] : a.slice(1).map((v, i) => v * (i + 1));
export const evalPoly = (a: Polynomial, t: number) => a.reduceRight((n, v) => n * t + v, 0);
export const distinct = (values: number[], epsilon = 1e-9) =>
  values.sort((a, b) => a - b).filter((v, i, arr) => !i || v - arr[i - 1] > epsilon);
export function polynomialRoots(poly: Polynomial, lo = 0, hi = 1): number[] {
  const scale = Math.max(...poly.map(Math.abs));
  if (!scale) return [];
  const a = poly.map((v) => v / scale);
  while (a.length > 1 && Math.abs(a.at(-1)!) < 1e-14) a.pop();
  if (a.length < 2) return [];
  if (a.length === 2) {
    const t = -a[0] / a[1];
    return t >= lo - 1e-11 && t <= hi + 1e-11 ? [Math.min(hi, Math.max(lo, t))] : [];
  }
  const stops = distinct([lo, ...polynomialRoots(diffPoly(a), lo, hi), hi]);
  const roots = stops.filter((t) => Math.abs(evalPoly(a, t)) < 2e-12);
  for (let i = 1; i < stops.length; i++) {
    let l = stops[i - 1],
      r = stops[i];
    const left = evalPoly(a, l),
      right = evalPoly(a, r);
    if (Math.abs(left) < 2e-12 || Math.abs(right) < 2e-12 || left * right >= 0) continue;
    for (let k = 0; k < 55; k++) {
      const m = (l + r) / 2;
      if (evalPoly(a, m) * left > 0) l = m;
      else r = m;
    }
    roots.push((l + r) / 2);
  }
  return distinct(roots);
}
