import type { GeometryDocument, Vec2 } from '@tuheng/contracts';

export type DrawingView = GeometryDocument['views'][number];
export type SolidAxis = 'x' | 'y' | 'z';
export const projectionPlaneAxes = { V: ['x', 'z'], H: ['x', 'y'], W: ['y', 'z'] } as const;
export type ProjectionDirection = keyof typeof projectionPlaneAxes;

export function directionOf(view: DrawingView) {
  return (Object.keys(projectionPlaneAxes) as ProjectionDirection[]).find((direction) =>
    projectionPlaneAxes[direction].every((axis) => view.mapping.includes(axis)),
  );
}

export function toProjectionPlane(
  view: DrawingView,
  direction: ProjectionDirection,
  position: Vec2,
): Vec2 {
  const value = (axis: SolidAxis) =>
    view.mapping[0] === axis ? position.x * view.signs[0] : position.y * view.signs[1];
  const [u, v] = projectionPlaneAxes[direction];
  return { x: value(u), y: value(v) };
}

export function fromProjectionPlane(
  view: DrawingView,
  direction: ProjectionDirection,
  position: Vec2,
): Vec2 {
  const [u] = projectionPlaneAxes[direction];
  return view.mapping[0] === u
    ? { x: position.x * view.signs[0], y: position.y * view.signs[1] }
    : { x: position.y * view.signs[0], y: position.x * view.signs[1] };
}
