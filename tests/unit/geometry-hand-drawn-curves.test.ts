import { expect, it } from 'vitest';
import {
  addPenStroke,
  createDocument,
  fitStroke,
  flattenCurve,
  point,
  foot,
  distance,
} from '@tuheng/geometry-core';
import { handDrawnCurve } from '../hand-drawn-curve-fixtures';

it.each(['bowl', 'peaked', 'wave'] as const)(
  'automatically fits the screenshot-like %s despite pixel jitter and unequal sampling',
  (shape) => {
    for (const cssPixelsPerMm of [2, 4, 8])
      for (const reverse of [false, true]) {
        const raw = handDrawnCurve(shape).map((p) => ({
          ...p,
          x: p.x / cssPixelsPerMm,
          y: p.y / cssPixelsPerMm,
        }));
        const samples = reverse ? [...raw].reverse() : raw;
        expect(fitStroke(samples, { cssPixelsPerMm }).kind).toBe('curve');
        const doc = addPenStroke(createDocument('VHW_PROJECTION'), 'view-0', samples, 'student', {
          cssPixelsPerMm,
        });
        const c = doc.entities.at(-1)!;
        if (c.kind !== 'curve') throw Error('expected a fitted curve');
        expect(c.samples).toEqual(samples);
        const knots = c.pointIds.map((id) => point(doc, id));
        expect(knots[0]).toEqual({ x: samples[0].x, y: samples[0].y });
        expect(knots.at(-1)).toEqual({ x: samples.at(-1)!.x, y: samples.at(-1)!.y });
        const path = flattenCurve(knots, 0.1 / cssPixelsPerMm);
        for (const p of samples) {
          const error = Math.min(
            ...path.slice(1).map((q, i) =>
              distance(
                p,
                foot(p, {
                  a: path[i],
                  d: { x: q.x - path[i].x, y: q.y - path[i].y },
                  finite: true,
                }),
              ),
            ),
          );
          expect(error * cssPixelsPerMm).toBeLessThanOrEqual(4);
        }
      }
  },
);

it('accepts a rotated curve with a small isolated tremor without changing its source samples', () => {
  const original = handDrawnCurve('wave', false, 1.1);
  original[87].x += 2;
  const samples = original.map((p) => ({ ...p, x: -p.y / 4, y: p.x / 4 }));
  const doc = addPenStroke(createDocument('VHW_PROJECTION'), 'view-0', samples, 'student', {
    cssPixelsPerMm: 4,
  });
  const c = doc.entities.at(-1)!;
  expect(c).toMatchObject({ kind: 'curve', samples });
  expect(c.kind === 'curve' && c.pointIds.length).toBeLessThanOrEqual(18);
});

it('keeps a long noisy stroke editable with few knots regardless of sample density', () => {
  const sample = (x: number) => ({
    x: x / 4,
    y: (52 * Math.sin(x / 105) + 1.25 * Math.sin(x * 0.9)) / 4,
  });
  for (const count of [241, 721]) {
    const samples = Array.from({ length: count }, (_, i) => sample(720 * i / (count - 1)));
    const fit = fitStroke(samples, { cssPixelsPerMm: 4 });
    if (fit.kind !== 'curve') throw Error('expected a fitted curve');
    expect(fit.points.length).toBeLessThanOrEqual(14);
    expect(fit.points[0]).toEqual(samples[0]);
    expect(fit.points.at(-1)).toEqual(samples.at(-1));
  }
});
