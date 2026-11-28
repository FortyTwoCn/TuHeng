import type { ReconstructedSolid3D } from '@tuheng/geometry-core';
import {
  dot,
  sceneProjection,
  type Point3,
  type ScreenPoint,
  type SolidCamera,
} from './scene-camera';
import type { LinkedFace } from './useSolidPreview';

type ScreenFace = { index: number; points: ScreenPoint[]; depth: number; front: boolean };
type DrawOptions = {
  camera: SolidCamera;
  transparent: boolean;
  wireframe: boolean;
  highlighted: ReadonlySet<number>;
};

const edgeKey = (a: number, b: number) => `${Math.min(a, b)}:${Math.max(a, b)}`;

export function solidFeatureEdges(solid: ReconstructedSolid3D) {
  const indices = new Map(solid.vertices.map((point, index) => [point.join(','), index]));
  return solid.edges.map(
    ([a, b]) => [indices.get(a.join(','))!, indices.get(b.join(','))!] as const,
  );
}

export function linkedSolidFaces(
  solid: ReconstructedSolid3D,
  ids: ReadonlySet<string> | undefined,
  linked?: LinkedFace,
) {
  const entities = new Set(ids);
  if (linked?.entityId) entities.add(linked.entityId);
  for (const id of linked?.entityIds ?? []) entities.add(id);
  const faces = new Set<number>();
  const matched = new Set<string>();
  solid.faceSources.forEach(({ entityId }, index) => {
    if (entities.has(entityId)) {
      faces.add(index);
      matched.add(entityId);
    }
  });
  for (const mapping of solid.sourceViewMapping) {
    if (
      (linked?.viewId === mapping.viewId && (!linked.entityId || !matched.has(linked.entityId))) ||
      mapping.entityIds.some((id) => entities.has(id) && !matched.has(id))
    )
      for (const index of mapping.triangleIndices) faces.add(index);
  }
  return faces;
}

export function paintSolid(
  context: CanvasRenderingContext2D,
  solid: ReconstructedSolid3D,
  width: number,
  height: number,
  features: ReturnType<typeof solidFeatureEdges>,
  featureKeys: ReadonlySet<string>,
  options: DrawOptions,
) {
  context.clearRect(0, 0, width, height);
  const { toward, at } = sceneProjection(solid.bounds, options.camera, width, height);
  const points = solid.vertices.map(at);
  const faces: ScreenFace[] = [];
  solid.triangles.forEach((triangle, index) => {
    const front = dot(solid.normals[index], toward) > 1e-7;
    if (!options.transparent && !options.wireframe && !front) return;
    const [a, b, c] = triangle.map((id) => points[id]);
    faces.push({ index, points: [a, b, c], depth: (a.depth + b.depth + c.depth) / 3, front });
  });
  faces.sort((a, b) => a.depth - b.depth);
  context.lineJoin = 'round';
  context.lineCap = 'round';
  function line(a: ScreenPoint, b: ScreenPoint) {
    context.beginPath();
    context.moveTo(a.x, a.y);
    context.lineTo(b.x, b.y);
    context.stroke();
  }
  const light: Point3 = [0.38, 0.47, 0.79];
  const ink = new Set<string>();
  for (const face of faces) {
    const {
      index,
      points: [a, b, c],
    } = face;
    const highlighted = options.highlighted.has(index);
    if (options.wireframe && !highlighted) continue;
    const shade = Math.max(0, dot(solid.normals[index], light));
    const opacity = options.wireframe ? 0.15 : options.transparent ? (face.front ? 0.26 : 0.13) : 1;
    context.fillStyle = highlighted
      ? `rgba(2, 156, 170, ${opacity})`
      : `hsla(${face.front ? 198 : 216}, 47%, ${43 + shade * 36}%, ${opacity})`;
    context.beginPath();
    context.moveTo(a.x, a.y);
    context.lineTo(b.x, b.y);
    context.lineTo(c.x, c.y);
    context.closePath();
    context.fill();
    if (!options.transparent && !options.wireframe) {
      context.strokeStyle = context.fillStyle;
      context.lineWidth = 0.45;
      context.stroke();
    }
    if (!options.wireframe) {
      context.strokeStyle = options.transparent ? '#21485fa0' : '#1b3b4f';
      context.lineWidth = options.transparent ? 1 : 1.3;
      solid.triangles[index].forEach((from, i, triangle) => {
        const key = edgeKey(from, triangle[(i + 1) % 3]);
        if (featureKeys.has(key) && (!options.transparent || !ink.has(key))) {
          line(face.points[i], face.points[(i + 1) % 3]);
          if (options.transparent) ink.add(key);
        }
      });
    }
  }
  if (options.wireframe) {
    context.strokeStyle = '#284e65';
    context.lineWidth = 1.5;
    for (const [a, b] of features) line(points[a], points[b]);
  }
  return faces;
}

export const solidEdgeKeys = (edges: ReturnType<typeof solidFeatureEdges>) =>
  new Set(edges.map(([a, b]) => edgeKey(a, b)));

export function pickSolidFace(faces: ScreenFace[], x: number, y: number) {
  const side = (a: ScreenPoint, b: ScreenPoint) =>
    (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
  let nearest = -Infinity;
  let selected: number | undefined;
  for (const {
    points: [a, b, c],
    index,
  } of faces) {
    const xa = side(b, c),
      xb = side(c, a),
      xc = side(a, b);
    if (!((xa >= 0 && xb >= 0 && xc >= 0) || (xa <= 0 && xb <= 0 && xc <= 0))) continue;
    const sum = xa + xb + xc;
    if (Math.abs(sum) < 1e-8) continue;
    const depth = (a.depth * xa + b.depth * xb + c.depth * xc) / sum;
    if (depth > nearest) {
      nearest = depth;
      selected = index;
    }
  }
  return selected;
}
