export type SolidPoint = [number, number, number];
export type SolidBounds = { min: SolidPoint; max: SolidPoint; size: SolidPoint };

export const add3 = (a: SolidPoint, b: SolidPoint): SolidPoint => [
  a[0] + b[0],
  a[1] + b[1],
  a[2] + b[2],
];
export const sub3 = (a: SolidPoint, b: SolidPoint): SolidPoint => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
];
export const scale3 = (a: SolidPoint, s: number): SolidPoint => [a[0] * s, a[1] * s, a[2] * s];
export const dot3 = (a: SolidPoint, b: SolidPoint) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross3 = (a: SolidPoint, b: SolidPoint): SolidPoint => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const norm3 = (a: SolidPoint) => Math.hypot(...a);
export const unit3 = (a: SolidPoint) => scale3(a, 1 / norm3(a));
export const axes3 = [0, 1, 2] as const;
export const solidAxes = { x: 0, y: 1, z: 2 } as const;
export type AxisIndex = (typeof axes3)[number];

export function bounds3(points: readonly SolidPoint[]): SolidBounds {
  const min: SolidPoint = [Infinity, Infinity, Infinity];
  const max: SolidPoint = [-Infinity, -Infinity, -Infinity];
  for (const point of points)
    for (const axis of axes3) {
      min[axis] = Math.min(min[axis], point[axis]);
      max[axis] = Math.max(max[axis], point[axis]);
    }
  return { min, max, size: sub3(max, min) };
}
