import type { GeometryDocument, Vec2 } from '@tuheng/contracts';
import {
  snapCandidates,
  confirmSnap,
  transact,
  point,
  distance,
  minorArc,
  type SnapCandidate,
} from '@tuheng/geometry-core';
import type { Tool } from './types';
export function primitivePreview(
  doc: GeometryDocument,
  tool: Tool,
  viewId: string,
  positions: Vec2[],
  scale: number,
  enabled: boolean,
  options: Parameters<typeof snapCandidates>[5],
) {
  const points: Vec2[] = [],
    candidates: (SnapCandidate | undefined)[] = [];
  for (const raw of positions) {
    const origin =
      ['segment', 'hidden', 'line'].includes(tool) && points.length ? points[0] : undefined;
    const c = enabled ? snapCandidates(doc, viewId, raw, scale, origin, options)[0] : undefined;
    points.push(c?.position ?? raw);
    candidates.push(c);
  }
  return { points, candidates };
}
// Applies exactly the coordinates displayed by the preview. Topology is accepted only at commit.
export function acceptPrimitive(
  base: GeometryDocument,
  raw: GeometryDocument,
  preview: ReturnType<typeof primitivePreview>,
  role: 'teacher' | 'student',
) {
  const entity = raw.entities.at(-1);
  if (!entity) return raw;
  const ids =
    entity.kind === 'point'
      ? [entity.id]
      : entity.kind === 'segment'
        ? [entity.startPoint, entity.endPoint]
        : entity.kind === 'circle' || entity.kind === 'arc'
          ? [entity.center]
          : [];
  let next = transact(
    raw,
    (d) => {
      ids.forEach((id, i) => {
        const p = d.entities.find((e) => e.id === id);
        if (p?.kind === 'point' && !base.entities.some((e) => e.id === id)) {
          p.position = preview.points[i];
          p.spatial = null;
        }
      });
      const e = d.entities.find((e) => e.id === entity.id)!;
      if (e.kind === 'circle') e.radius = distance(point(d, e.center), preview.points[1]);
      if (e.kind === 'arc')
        Object.assign(e, minorArc(point(d, e.center), preview.points[1], preview.points[2]));
      if (e.kind === 'line') {
        e.anchor = preview.points[0];
        e.direction = { x: preview.points[1].x - e.anchor.x, y: preview.points[1].y - e.anchor.y };
      }
    },
    role,
  );
  for (const [i, id] of ids.entries()) {
    if (base.entities.some((e) => e.id === id)) continue;
    const c = preview.candidates[i];
    if (c) next = confirmSnap(base, next, c, id, role);
  }
  return next;
}
