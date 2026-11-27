import type { Vec2 } from '@tuheng/contracts';
import { visibleCurveSegments, type Interpolation } from './curves';
import {
  dxfAppValue,
  dxfGroups,
  dxfNumber,
  dxfNumeric,
  dxfPoint,
  dxfPointTags,
  UnsupportedDxfEntity,
  type DxfPair,
  type DxfTags,
} from './dxf-format';
import type { DxfShape } from './dxf-shapes';
import { distance } from './vectors';

type Curve = Extract<DxfShape, { kind: 'curve' }>;

/** 每段 Bézier 对应一个三次 B 样条区间。端点结点重数为 4，内部重数为 3。 */
function cubicSpline(points: Vec2[], interpolation: Interpolation, range?: [number, number]) {
  const spans = visibleCurveSegments(points, range, interpolation);
  const controls = [spans[0].start, ...spans.flatMap((s) => [s.c1, s.c2, s.end])];
  const knots = [
    0,
    0,
    0,
    0,
    ...spans.slice(1).flatMap((_, i) => [i + 1, i + 1, i + 1]),
    spans.length,
    spans.length,
    spans.length,
    spans.length,
  ];
  return { controls, knots };
}

export function dxfSplineTags(
  points: Vec2[],
  interpolation: Interpolation,
  range?: [number, number],
) {
  const { controls, knots } = cubicSpline(points, interpolation, range);
  const tags: DxfPair[] = [
    [100, 'AcDbSpline'],
    [210, 0],
    [220, 0],
    [230, 1],
    [70, 8],
    [71, 3],
    [72, knots.length],
    [73, controls.length],
    [74, 0],
    ...knots.map((k): DxfPair => [40, k]),
    ...controls.flatMap((p) => dxfPointTags(10, p, 0)),
  ];
  // 原插值点用于恢复图衡的编辑语义。外部 CAD 直接使用标准控制点及结点。
  const metadata: DxfPair[] = [
    [1000, 'CURVE=' + [interpolation, ...(range ?? [])].join(',')],
    ...points.flatMap((p) => dxfPointTags(1011, p, 0)),
  ];
  return { tags, metadata };
}

function originalCurve(
  metadata: DxfTags,
  controls: Vec2[],
  knots: number[],
  degree: number,
): Curve | undefined {
  const encoding = dxfAppValue(metadata, 'CURVE')?.split(',');
  if (degree !== 3 || !encoding || ![1, 3].includes(encoding.length)) return;
  const [interpolation, start, end] = encoding;
  if (interpolation !== 'CUBIC_HERMITE' && interpolation !== 'QUADRATIC_BSPLINE') return;
  const points = dxfGroups(metadata, 1011);
  if (points.length < 3 || points.length > 128) return;
  const from = Number(start),
    to = Number(end);
  if (encoding.length === 3 && !(from >= 0 && to <= 1 && from < to)) return;
  const range: [number, number] | undefined = encoding.length === 3 ? [from, to] : undefined;
  try {
    const positions = points.map((p) => dxfPoint(p, 1011));
    const native = cubicSpline(positions, interpolation, range);
    // CAD 可能已修改曲线。原数据和标准控制网不吻合时，使用修改后的标准几何。
    if (
      native.controls.length === controls.length &&
      native.knots.length === knots.length &&
      knots.every((k, i) => Math.abs(k - native.knots[i]) < 1e-8) &&
      controls.every((p, i) => distance(p, native.controls[i]) < 1e-7)
    )
      return { kind: 'curve', points: positions, interpolation, range };
  } catch {
    // 附加数据无效时，仍可根据标准字段重建曲线。
  }
}

/** 用齐次坐标执行 de Boor 递推，也可读入含权的 NURBS。 */
function sampleSpline(controls: Vec2[], knots: number[], degree: number, weights: number[]) {
  const last = controls.length - 1;
  const spans = Array.from({ length: last + 1 - degree }, (_, i) => i + degree).filter(
    (i) => knots[i] < knots[i + 1],
  );
  if (!spans.length) throw Error('DXF 样条没有有效的参数区间');
  function at(u: number, span: number) {
    const work = Array.from({ length: degree + 1 }, (_, i) => {
      const index = span - degree + i;
      const w = weights[index] ?? 1;
      return { x: controls[index].x * w, y: controls[index].y * w, w };
    });
    for (let depth = 1; depth <= degree; depth++) {
      for (let i = degree; i >= depth; i--) {
        const index = span - degree + i;
        const width = knots[index + degree - depth + 1] - knots[index];
        const t = width === 0 ? 0 : (u - knots[index]) / width;
        const a = work[i - 1],
          b = work[i];
        work[i] = {
          x: (1 - t) * a.x + t * b.x,
          y: (1 - t) * a.y + t * b.y,
          w: (1 - t) * a.w + t * b.w,
        };
      }
    }
    const { x, y, w } = work[degree];
    return { x: x / w, y: y / w };
  }
  const count = Math.min(127, spans.length);
  const steps = Math.min(48, Math.floor(127 / count));
  const points = [];
  for (let i = 0; i < count; i++) {
    const span = spans[Math.floor((i * spans.length) / count)];
    const width = knots[span + 1] - knots[span];
    for (let step = 0; step < steps; step++)
      points.push(at(knots[span] + (width * step) / steps, span));
  }
  points.push(at(knots[last + 1], spans.at(-1)!));
  return points;
}

export function readDxfSpline(tags: DxfTags, metadata: DxfTags): DxfShape {
  const controls = dxfGroups(tags, 10).map((p) => dxfPoint(p));
  const fit = dxfGroups(tags, 11).map((p) => dxfPoint(p, 11));
  const knots = tags.filter(([code]) => code === 40).map(([, value]) => dxfNumeric(value, 40));
  const weights = tags.filter(([code]) => code === 41).map(([, value]) => dxfNumeric(value, 41));
  const degree = dxfNumber(tags, 71, 3);
  if (controls.length > 4096 || fit.length > 4096 || degree > 16)
    throw new UnsupportedDxfEntity('样条点数或阶数超出上限');
  if (
    dxfNumber(tags, 72, knots.length) !== knots.length ||
    dxfNumber(tags, 73, controls.length) !== controls.length ||
    dxfNumber(tags, 74, fit.length) !== fit.length
  )
    throw Error('DXF 样条的点或结点数量与声明不符');
  if (
    controls.length &&
    (!Number.isInteger(degree) ||
      degree < 1 ||
      degree >= controls.length ||
      knots.length !== controls.length + degree + 1 ||
      knots.some((k, i) => i > 0 && k < knots[i - 1]) ||
      (weights.length && (weights.length !== controls.length || weights.some((w) => w <= 0))))
  )
    throw Error('DXF 样条的控制网、结点或权重无效');
  if (!weights.length) {
    const original = originalCurve(metadata, controls, knots, degree);
    if (original) return original;
  }
  const points =
    controls.length === 2
      ? controls
      : controls.length
        ? sampleSpline(controls, knots, degree, weights)
        : fit.length > 128
          ? Array.from({ length: 128 }, (_, i) => fit[Math.round((i * (fit.length - 1)) / 127)])
          : fit;
  const distinct: Vec2[] = [];
  for (const p of points)
    if (!distinct.length || distance(distinct.at(-1)!, p) > 1e-8) distinct.push(p);
  if (distinct.length === 2) return { kind: 'segment', start: distinct[0], end: distinct[1] };
  if (distinct.length < 3) throw new UnsupportedDxfEntity('样条有效点不足');
  return { kind: 'curve', points: distinct, interpolation: 'CUBIC_HERMITE' };
}
