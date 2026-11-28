import type { ReconstructedSpatial3D } from '@tuheng/geometry-core';
import { sceneProjection, type ScreenPoint, type SolidCamera } from './scene-camera';
import type { LinkedFace } from './useSolidPreview';
import type { EditorTheme } from '../../theme';
import { paintSceneBackground, sceneColors } from './scene-theme';

type Source = { viewId: string; entityId?: string };
type Target = { points: ScreenPoint[]; sources: Source[]; shape: 'point' | 'segment' | 'face' };
const meanDepth = (points: ScreenPoint[]) =>
  points.reduce((sum, p) => sum + p.depth, 0) / points.length;

export function spatialHighlight(ids?: ReadonlySet<string>, face?: LinkedFace) {
  const selected = new Set(ids);
  if (face?.entityId) selected.add(face.entityId);
  for (const id of face?.entityIds ?? []) selected.add(id);
  return (sources: Source[]) =>
    sources.some(
      ({ entityId, viewId }) =>
        (entityId && selected.has(entityId)) ||
        (face && !face.entityId && !face.entityIds && viewId === face.viewId),
    );
}

export function paintSpatial(
  ctx: CanvasRenderingContext2D,
  scene: ReconstructedSpatial3D,
  width: number,
  height: number,
  theme: EditorTheme,
  camera: SolidCamera,
  projections: boolean,
  highlighted: ReturnType<typeof spatialHighlight>,
) {
  const { at } = sceneProjection(scene.displayBounds, camera, width, height);
  const targets: Target[] = [];
  const {
    roles,
    planes: planeColors,
    axis: axisColor,
    rayOpacity,
    projected,
    linked,
    halo,
  } = sceneColors[theme].spatial;
  paintSceneBackground(ctx, width, height, theme);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  function path(points: ScreenPoint[], fill: string | undefined, stroke: string, size: number) {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
    if (fill) {
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    }
    ctx.strokeStyle = stroke;
    ctx.lineWidth = size;
    ctx.stroke();
  }
  function label(point: ScreenPoint, text: string, color: string, size: number, dx = 0, dy = 0) {
    ctx.font = '600 ' + size + 'px system-ui, sans-serif';
    ctx.lineWidth = 3;
    ctx.strokeStyle = halo;
    ctx.strokeText(text, point.x + dx, point.y + dy);
    ctx.fillStyle = color;
    ctx.fillText(text, point.x + dx, point.y + dy);
  }
  function dot(point: ScreenPoint, color: string, size: number) {
    ctx.beginPath();
    ctx.arc(point.x, point.y, size, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = halo;
    ctx.lineWidth = 1.35;
    ctx.stroke();
  }
  const planes = scene.projectionPlanes
    .map((plane) => ({ ...plane, screen: plane.corners.map(at) }))
    .sort((a, b) => meanDepth(a.screen) - meanDepth(b.screen));
  for (const plane of planes) {
    const color = planeColors[plane.direction];
    path(plane.screen, color + '18', color + '62', 1);
    const anchor = at(plane.label);
    label(anchor, plane.direction, color, 15);
    targets.push({ points: [anchor], sources: [{ viewId: plane.viewId }], shape: 'point' });
  }
  const faces = scene.faces
    .map((face) => ({ ...face, screen: face.points.map(at) }))
    .sort((a, b) => meanDepth(a.screen) - meanDepth(b.screen));
  for (const face of faces) {
    const color = roles[face.role],
      active = highlighted(face.sources);
    path(
      face.screen,
      color + (active ? '59' : '34'),
      color + (active ? 'ec' : '95'),
      active ? 2.2 : 1.3,
    );
    targets.push({ points: face.screen, sources: face.sources, shape: 'face' });
  }
  const axis = scene.axis.map(at);
  path(axis, undefined, axisColor, 2.4);
  label(axis[1], 'X', axisColor, 13, -4, -7);
  label(at([0, 0, 0]), 'O', axisColor, 13, 5, 13);

  if (projections) {
    ctx.setLineDash([3, 4]);
    for (const { points, source } of scene.projectionRays) {
      const active = highlighted([source]);
      path(
        points.map(at),
        undefined,
        active ? linked : planeColors[source.direction] + rayOpacity,
        active ? 1.7 : 0.85,
      );
    }
    ctx.setLineDash([]);
    for (const { points, source } of scene.projectedSegments) {
      const screen = points.map(at);
      path(screen, undefined, highlighted([source]) ? linked : projected, 1.2);
      targets.push({ points: screen, sources: [source], shape: 'segment' });
    }
    for (const {
      points: [, point],
      source,
    } of scene.projectionRays) {
      const screen = at(point);
      dot(screen, planeColors[source.direction], highlighted([source]) ? 4.2 : 2.6);
      targets.push({ points: [screen], sources: [source], shape: 'point' });
    }
  }
  for (const segment of scene.segments) {
    const screen = segment.points.map(at),
      active = highlighted(segment.sources);
    path(screen, undefined, active ? linked : roles[segment.role], active ? 4.4 : 2.8);
    targets.push({ points: screen, sources: segment.sources, shape: 'segment' });
  }
  for (const marker of scene.rightAngles) path(marker.points.map(at), undefined, roles.ANSWER, 1.5);

  for (const { name, position, role, projections: sources } of scene.points) {
    const screen = at(position),
      active = highlighted(sources),
      color = active ? linked : roles[role];
    dot(screen, color, active ? 5.5 : 4.25);
    if (name) label(screen, name, color, 14, 7, -6);
    targets.push({ points: [screen], sources, shape: 'point' });
  }
  return targets;
}

function hit(target: Target, x: number, y: number) {
  const [a, b] = target.points;
  if (target.shape === 'point') return Math.hypot(a.x - x, a.y - y) <= 9;
  if (target.shape === 'segment') {
    const dx = b.x - a.x,
      dy = b.y - a.y,
      length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / length)) : 0;
    return Math.hypot(a.x + t * dx - x, a.y + t * dy - y) <= 6;
  }
  let inside = false;
  for (const [i, p] of target.points.entries()) {
    const q = target.points[(i + 1) % target.points.length];
    if (p.y > y !== q.y > y && x < p.x + ((q.x - p.x) * (y - p.y)) / (q.y - p.y)) inside = !inside;
  }
  return inside;
}

export function pickSpatialFeature(
  targets: Target[],
  x: number,
  y: number,
): LinkedFace | undefined {
  for (let i = targets.length - 1; i >= 0; i--) {
    const target = targets[i];
    if (!hit(target, x, y)) continue;
    const [source] = target.sources;
    if (!source) continue;
    const entityIds = [
      ...new Set(target.sources.flatMap(({ entityId }) => (entityId ? [entityId] : []))),
    ];
    return entityIds.length ? { ...source, entityIds } : source;
  }
}
