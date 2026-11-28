import type { ReconstructedSolid3D } from '@tuheng/geometry-core';

export type Point3 = ReconstructedSolid3D['vertices'][number];
export type SolidCamera = { yaw: number; pitch: number; zoom: number };
export type ScreenPoint = { x: number; y: number; depth: number };
export const dot = (a: Point3, b: Point3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function sceneProjection(
  bounds: ReconstructedSolid3D['bounds'],
  camera: SolidCamera,
  width: number,
  height: number,
) {
  const { yaw, pitch, zoom } = camera;
  const s = Math.sin(yaw),
    c = Math.cos(yaw),
    sp = Math.sin(pitch),
    cp = Math.cos(pitch);
  const right: Point3 = [c, s, 0],
    up: Point3 = [-s * sp, c * sp, cp];
  const toward: Point3 = [s * cp, -c * cp, sp];
  const center = bounds.min.map((min, i) => min + bounds.size[i] / 2) as Point3;
  const extent = (axis: Point3) =>
    bounds.size.reduce((sum, size, i) => sum + Math.abs(axis[i]) * size, 0);
  const scale =
    Math.min(
      (width > 108 ? width - 54 : width * 0.62) / Math.max(1, extent(right)),
      (height > 108 ? height - 46 : height * 0.62) / Math.max(1, extent(up)),
    ) * zoom;
  return {
    toward,
    at: (point: Point3): ScreenPoint => {
      const local = point.map((coordinate, i) => coordinate - center[i]) as Point3;
      return {
        x: width / 2 + dot(local, right) * scale,
        y: height / 2 - dot(local, up) * scale,
        depth: dot(local, toward),
      };
    },
  };
}
