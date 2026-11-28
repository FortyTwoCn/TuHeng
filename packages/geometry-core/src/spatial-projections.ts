import type { GeometryDocument, GeometryEntity, Vec2 } from '@tuheng/contracts';
import { cross, distance, sub } from './math';
import {
  directionOf,
  toProjectionPlane,
  type DrawingView,
  type ProjectionDirection,
} from './projection-coordinates';
import { localToSheet } from './sheet';
import type { SolidPoint } from './spatial-math';

export type SpatialRole = 'PROBLEM' | 'ANSWER' | 'CONSTRUCTION';
export type ProjectionSource = { viewId: string; entityId: string };
export type SpatialProjection = ProjectionSource & {
  direction: ProjectionDirection;
  position: Vec2;
  projected: Vec2;
};
export type SpatialPoint = {
  id: string;
  name: string;
  position: SolidPoint;
  role: SpatialRole;
  projections: SpatialProjection[];
};
type ProjectedPoint = SpatialProjection & { name?: string; primed: boolean; role: SpatialRole };
type Issue = {
  axis?: 'x' | 'y' | 'z';
  detail: string;
  points: SpatialProjection[];
};
export type SpatialProjectionAnalysis = {
  points: SpatialPoint[];
  issues: Issue[];
  unmatched: SpatialProjection[];
  views: { direction: ProjectionDirection; view: DrawingView }[];
};
type PointEntity = Extract<GeometryEntity, { kind: 'point' }>;

export function spatialRole(doc: GeometryDocument, entity: GeometryEntity): SpatialRole {
  const role = doc.layers.find(({ id }) => id === entity.layerId)?.role;
  if (role === 'CONSTRUCTION' || entity.lineStyle === 'CONSTRUCTION') return 'CONSTRUCTION';
  return role === 'PROBLEM_STEM' ? 'PROBLEM' : 'ANSWER';
}

function pointName(point: PointEntity, direction: ProjectionDirection) {
  for (const text of [point.name, ...('aliases' in point ? (point.aliases ?? []) : [])]) {
    const normalized = text.trim().normalize('NFKC').replace(/[’′]/g, "'");
    const match = /^([a-z][a-z0-9]*|\d+)('{0,2})$/i.exec(normalized);
    if (!match) continue;
    const marks = match[2].length;
    if (marks && (direction === 'H' || marks !== (direction === 'V' ? 1 : 2))) continue;
    return { name: match[1].toUpperCase(), primed: !!marks };
  }
  return { primed: false };
}

function projectionGuides(
  doc: GeometryDocument,
  entities: ReadonlyMap<string, GeometryEntity>,
  groupPairs: ReadonlySet<string>,
) {
  const guides = doc.entities.flatMap((entity) => {
    if (entity.lineStyle !== 'CONSTRUCTION') return [];
    const onSheet = (point: Vec2) => localToSheet(doc, entity.viewId, point);
    if (entity.kind === 'line' && entity.scope === 'SHEET')
      return [
        {
          from: onSheet(entity.anchor),
          to: onSheet({
            x: entity.anchor.x + entity.direction.x,
            y: entity.anchor.y + entity.direction.y,
          }),
          finite: false,
        },
      ];
    if (entity.kind === 'polyline' && entity.points.length === 2)
      return [{ from: onSheet(entity.points[0]), to: onSheet(entity.points[1]), finite: true }];
    if (entity.kind !== 'segment') return [];
    const a = entities.get(entity.startPoint),
      b = entities.get(entity.endPoint);
    return a?.kind === 'point' && b?.kind === 'point'
      ? [{ from: onSheet(a.position), to: onSheet(b.position), finite: true }]
      : [];
  });
  const tolerance = doc.settings.tolerance;
  return (front: SpatialProjection, top: SpatialProjection) => {
    if (groupPairs.has(JSON.stringify([front.entityId, top.entityId]))) return 2;
    const a = localToSheet(doc, front.viewId, front.position);
    const b = localToSheet(doc, top.viewId, top.position);
    let best = 0;
    for (const { from, to, finite } of guides) {
      if (Math.abs(from.x - to.x) > tolerance) continue;
      if (finite) {
        if (
          (distance(a, from) <= tolerance && distance(b, to) <= tolerance) ||
          (distance(b, from) <= tolerance && distance(a, to) <= tolerance)
        )
          best = Math.max(best, 2);
      } else {
        const direction = sub(to, from);
        const length = Math.hypot(direction.x, direction.y);
        if (
          length &&
          [a, b].every((p) => Math.abs(cross(direction, sub(p, from))) <= tolerance * length)
        )
          best = Math.max(best, 1);
      }
    }
    return best;
  };
}

export function analyzeSpatialProjections(
  doc: GeometryDocument,
  baseViews: DrawingView[],
  openDrawing: boolean,
): SpatialProjectionAnalysis | undefined {
  if (doc.editorType !== 'VH_PROJECTION' && doc.editorType !== 'VHW_PROJECTION') return;
  const views = baseViews.flatMap((view) => {
    const direction = directionOf(view);
    return direction ? [{ direction, view }] : [];
  });
  const byId = new Map(views.map((entry) => [entry.view.id, entry]));
  const entities = new Map(doc.entities.map((entity) => [entity.id, entity]));
  const endpoints = new Set(
    doc.entities.flatMap((entity) =>
      entity.kind === 'segment' &&
      entity.lineStyle !== 'CONSTRUCTION' &&
      entity.appearance?.pattern !== 'CENTER'
        ? [entity.startPoint, entity.endPoint]
        : [],
    ),
  );
  const projected: ProjectedPoint[] = [];
  for (const entity of doc.entities) {
    if (entity.kind !== 'point' || entity.scope === 'SHEET') continue;
    const entry = byId.get(entity.viewId);
    if (!entry) continue;
    const name = pointName(entity, entry.direction);
    if (!name.name && !endpoints.has(entity.id)) continue;
    projected.push({
      ...name,
      direction: entry.direction,
      viewId: entry.view.id,
      entityId: entity.id,
      position: entity.position,
      projected: toProjectionPlane(entry.view, entry.direction, entity.position),
      role: spatialRole(doc, entity),
    });
  }
  const named = new Map<string, ProjectedPoint[]>();
  for (const point of projected) {
    if (!point.name) continue;
    const list = named.get(point.name) ?? [];
    list.push(point);
    named.set(point.name, list);
  }
  const groupPairs = new Set<string>();
  for (const group of doc.projectionGroups) {
    if (group.kind !== 'POINT') continue;
    const byView = group.entityIds.map((id) => projected.find(({ entityId }) => id === entityId));
    const front = byView.find((point) => point?.direction === 'V');
    const top = byView.find((point) => point?.direction === 'H');
    if (front && top) groupPairs.add(JSON.stringify([front.entityId, top.entityId]));
  }
  const namedPairs = [...named.values()].filter(
    (group) =>
      group.some(({ direction }) => direction === 'V') &&
      group.some(({ direction }) => direction === 'H'),
  );
  const hasExplicitNames = namedPairs.some((group) => group.some(({ primed }) => primed));
  if (!hasExplicitNames && !groupPairs.size && !openDrawing) return;
  const tolerance = doc.settings.tolerance;
  const issues: Issue[] = [];
  const points: SpatialPoint[] = [];
  const used = new Set<string>();
  const close = (a: number, b: number) => Math.abs(a - b) <= tolerance;
  const left = projected.filter(({ direction }) => direction === 'W');
  const push = (a: ProjectedPoint, b: ProjectedPoint, name = '', w?: ProjectedPoint) => {
    used.add(a.entityId);
    used.add(b.entityId);
    if (w) used.add(w.entityId);
    const x = a.projected.x,
      y = b.projected.y,
      z = a.projected.y;
    if (!close(x, b.projected.x))
      issues.push({
        axis: 'x',
        detail: `${name} 的 V/H 投影 X 坐标相差 ${Math.abs(x - b.projected.x).toFixed(3)} mm。`,
        points: [a, b],
      });
    if (w && !close(z, w.projected.y))
      issues.push({
        axis: 'z',
        detail: `${name} 的 V/W 投影 Z 坐标相差 ${Math.abs(z - w.projected.y).toFixed(3)} mm。`,
        points: [a, w],
      });
    if (w && !close(y, w.projected.x))
      issues.push({
        axis: 'y',
        detail: `${name} 的 H/W 投影 Y 坐标相差 ${Math.abs(y - w.projected.x).toFixed(3)} mm。`,
        points: [b, w],
      });
    const side = w
      ? [w]
      : left.filter((p) => !p.name && close(p.projected.x, y) && close(p.projected.y, z));
    if (side.length === 1) used.add(side[0].entityId);
    points.push({
      id: a.entityId,
      name,
      position: [x, y, z],
      role:
        a.role === 'PROBLEM' && b.role === 'PROBLEM'
          ? 'PROBLEM'
          : a.role === 'CONSTRUCTION' || b.role === 'CONSTRUCTION'
            ? 'CONSTRUCTION'
            : 'ANSWER',
      projections: side.length === 1 ? [a, b, side[0]] : [a, b],
    });
  };
  for (const [name, group] of named) {
    const [v, h, w] = (['V', 'H', 'W'] as const).map((axis) =>
      group.filter((p) => p.direction === axis),
    );
    if ([v, h, w].some((items) => items.length > 1)) {
      issues.push({
        detail: `${name} 在同一个投影面中有多个同名点，无法唯一配对。`,
        points: group,
      });
    } else if (v.length && h.length) {
      push(v[0], h[0], name, w[0]);
    }
  }

  const guideRank = projectionGuides(doc, entities, groupPairs);
  const front = projected.filter((p) => p.direction === 'V' && !used.has(p.entityId));
  const top = projected.filter((p) => p.direction === 'H' && !used.has(p.entityId));
  const candidates = front.flatMap((a) =>
    top.flatMap((b) => {
      if (a.name && b.name && a.name !== b.name) return [];
      if (
        !close(a.projected.x, b.projected.x) &&
        !groupPairs.has(JSON.stringify([a.entityId, b.entityId]))
      )
        return [];
      const rank = guideRank(a, b);
      return [{ a, b, rank }];
    }),
  );
  const best = (key: 'a' | 'b') => {
    const results = new Map<string, { rank: number; count: number }>();
    for (const item of candidates) {
      const id = item[key].entityId,
        current = results.get(id);
      if (!current || item.rank > current.rank) results.set(id, { rank: item.rank, count: 1 });
      else if (item.rank === current.rank) current.count++;
    }
    return results;
  };
  const ranksV = best('a'),
    ranksH = best('b');
  for (const { a, b, rank } of candidates) {
    const v = ranksV.get(a.entityId)!,
      h = ranksH.get(b.entityId)!;
    if (v.count !== 1 || h.count !== 1 || rank !== v.rank || rank !== h.rank) continue;
    const name = a.name ?? b.name;
    const w = name && named.get(name)?.find((point) => point.direction === 'W');
    push(a, b, name, w || undefined);
  }
  if (!points.length && !hasExplicitNames && !groupPairs.size) return;
  const unmatched = projected.filter(({ entityId }) => !used.has(entityId));
  return { points, issues, unmatched, views };
}
