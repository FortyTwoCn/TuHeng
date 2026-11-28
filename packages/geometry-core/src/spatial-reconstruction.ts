import type { GeometryDocument } from '@tuheng/contracts';
import { contourLineRole } from './drawing-contours';
import { distance } from './math';
import { projectionPlaneAxes, type ProjectionDirection } from './projection-coordinates';
import {
  reconstructSpatialFaces,
  type SpatialFace,
  type SpatialRightAngle,
  type SpatialSegment,
} from './spatial-faces';
import { bounds3, type SolidBounds, type SolidPoint } from './spatial-math';
import {
  spatialRole,
  type ProjectionSource,
  type SpatialPoint,
  type SpatialProjection,
  type SpatialProjectionAnalysis,
} from './spatial-projections';

export type SpatialProjectionPlane = {
  direction: ProjectionDirection;
  corners: SolidPoint[];
  label: SolidPoint;
  viewId: string;
};
type ProjectedLine<Source = ProjectionSource> = {
  points: [SolidPoint, SolidPoint];
  source: Source;
};

export type ReconstructedSpatial3D = {
  kind: 'DESCRIPTIVE_GEOMETRY';
  points: SpatialPoint[];
  segments: SpatialSegment[];
  faces: SpatialFace[];
  rightAngles: SpatialRightAngle[];
  projectionPlanes: SpatialProjectionPlane[];
  projectionRays: ProjectedLine<SpatialProjection>[];
  projectedSegments: ProjectedLine[];
  axis: [SolidPoint, SolidPoint];
  bounds: SolidBounds;
  displayBounds: SolidBounds;
  sourceViewMapping: { direction: ProjectionDirection; viewId: string; entityIds: string[] }[];
  confidenceNote: string;
  warnings: string[];
};

const lift = (direction: ProjectionDirection, u: number, v: number): SolidPoint =>
  direction === 'V' ? [u, 0, v] : direction === 'H' ? [u, v, 0] : [0, u, v];

function spatialSegments(doc: GeometryDocument, analysis: SpatialProjectionAnalysis) {
  const candidates = new Map<string, SpatialPoint[]>();
  const directions = new Map(analysis.views.map(({ view, direction }) => [view.id, direction]));
  for (const point of analysis.points)
    for (const { entityId } of point.projections) {
      const matching = candidates.get(entityId) ?? [];
      matching.push(point);
      candidates.set(entityId, matching);
    }
  const byPair = new Map<
    string,
    {
      ends: [SpatialPoint, SpatialPoint];
      lines: Map<ProjectionDirection, { source: ProjectionSource; role: SpatialSegment['role'] }>;
    }
  >();
  for (const entity of doc.entities) {
    if (entity.kind !== 'segment' || contourLineRole(entity) === 'CENTER') continue;
    const direction = directions.get(entity.viewId);
    if (!direction) continue;
    for (const first of candidates.get(entity.startPoint) ?? [])
      for (const last of candidates.get(entity.endPoint) ?? []) {
        if (first === last) continue;
        const ends: [SpatialPoint, SpatialPoint] =
          first.id < last.id ? [first, last] : [last, first];
        const key = JSON.stringify(ends.map(({ id }) => id));
        const pair = byPair.get(key) ?? { ends, lines: new Map() };
        pair.lines.set(direction, {
          source: { viewId: entity.viewId, entityId: entity.id },
          role: spatialRole(doc, entity),
        });
        byPair.set(key, pair);
      }
  }
  return [...byPair.values()].flatMap(({ ends, lines }): SpatialSegment[] => {
    const sources: ProjectionSource[] = [];
    const roles: SpatialSegment['role'][] = [];
    for (const direction of ['V', 'H', 'W'] as const) {
      const line = lines.get(direction);
      if (line) {
        sources.push(line.source);
        roles.push(line.role);
        continue;
      }
      const [a, b] = ends.map(({ projections }) =>
        projections.find((p) => p.direction === direction),
      );
      if (a && b && distance(a.projected, b.projected) <= 1e-8) {
        sources.push(a);
        if (a.entityId !== b.entityId) sources.push(b);
      } else if (direction !== 'W') return [];
    }
    const role = roles.includes('CONSTRUCTION')
      ? 'CONSTRUCTION'
      : roles.includes('ANSWER')
        ? 'ANSWER'
        : 'PROBLEM';
    return [
      {
        ends: [ends[0].id, ends[1].id],
        points: [ends[0].position, ends[1].position],
        role,
        sources,
      },
    ];
  });
}

export function reconstructSpatial3D(
  doc: GeometryDocument,
  analysis: SpatialProjectionAnalysis,
  warnings: string[],
): ReconstructedSpatial3D {
  const { points } = analysis;
  const positions = new Map(points.map(({ id, position }) => [id, position]));
  const segments = spatialSegments(doc, analysis);
  const { faces, markers, limited } = reconstructSpatialFaces(
    segments,
    positions,
    doc.settings.tolerance,
  );
  const bounds = bounds3(points.map(({ position }) => position));
  const content = bounds3([...positions.values(), ...faces.flatMap(({ points }) => points)]);
  const margin = Math.max(1, ...content.size) * 0.14;
  const min = content.min.map((n) => Math.min(0, n) - margin) as SolidPoint;
  const max = content.max.map((n) => Math.max(0, n) + margin) as SolidPoint;
  const directions = analysis.views;
  const projectionPlanes = directions.map(({ direction, view }): SpatialProjectionPlane => {
    const axis = { x: 0, y: 1, z: 2 } as const;
    const [u, v] = projectionPlaneAxes[direction].map((name) => axis[name]);
    const at = (u: number, v: number) => lift(direction, u, v);
    return {
      direction,
      corners: [at(min[u], min[v]), at(max[u], min[v]), at(max[u], max[v]), at(min[u], max[v])],
      label: at(max[u] - margin * 0.4, max[v] - margin * 0.4),
      viewId: view.id,
    };
  });
  const projectionRays = points.flatMap(({ position, projections }) =>
    projections.map((projection): ProjectedLine<SpatialProjection> => ({
      points: [
        position,
        lift(projection.direction, projection.projected.x, projection.projected.y),
      ],
      source: projection,
    })),
  );
  const pointById = new Map(points.map((point) => [point.id, point]));
  const viewDirection = new Map(directions.map(({ direction, view }) => [view.id, direction]));
  const projectedSegments = segments.flatMap(({ sources, ends }) =>
    sources.flatMap((source): ProjectedLine[] => {
      const direction = viewDirection.get(source.viewId);
      if (!direction) return [];
      const [a, b] = ends.map((id) =>
        pointById.get(id)?.projections.find((p) => p.direction === direction),
      );
      if (!a || !b || distance(a.projected, b.projected) <= 1e-8) return [];
      return [
        {
          source,
          points: [
            lift(direction, a.projected.x, a.projected.y),
            lift(direction, b.projected.x, b.projected.y),
          ],
        },
      ];
    }),
  );
  const sourceViewMapping = directions.map(({ direction, view }) => ({
    direction,
    viewId: view.id,
    entityIds: [
      ...new Set(
        [
          ...points.flatMap(({ projections }) => projections),
          ...segments.flatMap(({ sources }) => sources),
        ]
          .filter(({ viewId }) => viewId === view.id)
          .map(({ entityId }) => entityId),
      ),
    ],
  }));
  if (limited) warnings.push('空间面片已达到识别上限，仍可查看已配对的点与线。');
  return {
    kind: 'DESCRIPTIVE_GEOMETRY',
    points,
    segments,
    faces,
    rightAngles: markers,
    bounds,
    displayBounds: bounds3([min, max]),
    projectionPlanes,
    projectionRays,
    projectedSegments,
    axis: [
      [min[0], 0, 0],
      [max[0], 0, 0],
    ],
    sourceViewMapping,
    confidenceNote: '按同名点与投影对应还原空间坐标。面片取自闭合共面边界和相交解线。',
    warnings,
  };
}
