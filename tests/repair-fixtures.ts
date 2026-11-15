import type { GeometryDocument, Vec2 } from '@tuheng/contracts';
import { createDocument, addDrawing, projectPoint, sheetToLocal } from '@tuheng/geometry-core';
export function standardSheet(): GeometryDocument {
  let d = createDocument('VHW_PROJECTION');
  for (const v of d.views)
    d = addDrawing(d, 'point', v.id, [projectPoint(d, { x: 30, y: 20, z: 40 }, v.id)], 'student');
  d.entities.forEach((e, i) => {
    if (e.kind === 'point') {
      e.id = ['A_V', 'A_H', 'A_W'][i];
      e.name = ['a′', 'a', 'a″'][i];
    }
  });
  return d;
}
export function connectionSheet(): GeometryDocument {
  let d = createDocument('VHW_PROJECTION');
  for (const [a, b] of [
    [
      { x: -55, y: 35 },
      { x: -30, y: 35 },
    ],
    [
      { x: -10, y: 15 },
      { x: -10, y: 45 },
    ],
  ] as [Vec2, Vec2][])
    d = addDrawing(
      d,
      'segment',
      'view-0',
      [sheetToLocal(d, 'view-0', a), sheetToLocal(d, 'view-0', b)],
      'student',
    );
  return d;
}
export function penSample(scale: number, direction = 1, sweep = 360, shape = 'circle') {
  return Array.from({ length: 161 }, (_, i) => {
    const f = (i / 160) ** 1.7,
      a = ((f * sweep * Math.PI) / 180) * direction;
    const r = 60 + (i === 63 ? 3 : Math.sin(i * 2.8) * 0.35);
    return {
      x: (Math.cos(a) * r) / scale,
      y:
        shape === 'eight'
          ? (Math.sin(2 * a) * 60) / scale
          : ((Math.sin(a) * r) / scale) * (shape === 'ellipse' ? 0.62 : 1),
      pressure: 0.5,
    };
  });
}
// Synthetic approximation of a long hand-drawn line: slow drift, small waviness,
// variable sampling speed. Coordinates are CSS pixels, not a captured device trace.
export function wavyLineSample(length = 620, wobble = 7, degrees = 0) {
  const angle = (degrees * Math.PI) / 180;
  return Array.from({ length: 161 }, (_, i) => {
    const t = (i / 160) ** 1.45;
    const u = length * (t - 0.5);
    const v = 18 * t + wobble * Math.sin(t * Math.PI * 6) + 2 * Math.sin(t * Math.PI * 17);
    return {
      x: u * Math.cos(angle) - v * Math.sin(angle),
      y: u * Math.sin(angle) + v * Math.cos(angle),
      pressure: 0.5,
    };
  });
}
export function borderlineCircleSample() {
  return Array.from({ length: 181 }, (_, i) => {
    const t = i / 180,
      a = t * Math.PI * 2,
      r = 80 + 3 * Math.sin(t * Math.PI * 18);
    return { x: Math.cos(a) * r, y: Math.sin(a) * r, pressure: 0.5 };
  });
}
// Approximate the screenshot's narrow, slowly wandering stroke. This is a
// synthetic trace, not user/device capture; rotate it to check direction neutrality.
export function driftingLineSample(degrees = 90, reverse = false, length = 490, uneven = false) {
  const control = [
    [0, 0],
    [36, 0],
    [61, -7],
    [144, -19],
    [187, -19],
    [212, -15],
    [227, -14],
    [246, -9],
    [277, -3],
    [292, -3],
    [309, -6],
    [323, -10],
    [413, -10],
    [439, -5],
    [442, -5],
    [457, -2],
    [474, 2],
    [490, 3],
  ];
  const angle = (degrees * Math.PI) / 180;
  const samples = Array.from({ length: 161 }, (_, i) => {
    const t = (i / 160) ** (uneven ? 2.4 : 1),
      at = t * 490;
    let j = 1;
    while (j < control.length - 1 && control[j][0] < at) j++;
    const a = control[j - 1],
      b = control[j],
      fraction = (at - a[0]) / (b[0] - a[0]);
    const u = (t - 0.5) * length,
      v = ((a[1] + (b[1] - a[1]) * fraction) * length) / 490;
    return {
      x: u * Math.cos(angle) - v * Math.sin(angle),
      y: u * Math.sin(angle) + v * Math.cos(angle),
      pressure: 0.5,
    };
  });
  return reverse ? samples.reverse() : samples;
}
