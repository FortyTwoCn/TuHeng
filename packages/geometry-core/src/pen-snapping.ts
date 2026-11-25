import type { GeometryDocument, Vec2 } from '@tuheng/contracts';
import { add, sub, dot, cross, unit, scale, distance, lineGeometry } from './math';
import { referenceGeometry } from './references';
import { sheetDeltaToLocal } from './sheet';
import { snapCandidates, confirmSnap, type SnapCandidate } from './snapping';

// A direction decision is angular, not an endpoint-to-axis pixel distance: long
// strokes must have the same tolerance as short ones at every zoom level.
export const penDirectionThresholds = { degrees: 7.5, minimumPixels: 12 };
type Options = Parameters<typeof snapCandidates>[5] & { direction?: boolean };
const explicit = (c?: SnapCandidate) =>
  !!c && ['COINCIDENT', 'ORIGIN', 'INTERSECTION'].includes(c.kind);

/** Position and direction preview for an already fitted straight pen stroke. */
export function penLinePreview(
  base: GeometryDocument,
  raw: GeometryDocument,
  pixels: number,
  options: Options,
) {
  const entity = raw.entities.at(-1);
  if (!entity || (entity.kind !== 'segment' && entity.kind !== 'line') || !entity.samples?.length)
    return;
  const geometry = lineGeometry(raw, entity);
  const direction = unit(geometry.d);
  const span = geometry.finite
    ? Math.hypot(geometry.d.x, geometry.d.y)
    : Math.abs(dot(sub(entity.samples.at(-1)!, entity.samples[0]), direction));
  const original = [geometry.a, add(geometry.a, scale(direction, span))];
  const near = (p: Vec2, origin?: Vec2) =>
    snapCandidates(base, entity.viewId, p, pixels, origin, options);
  const candidates: (SnapCandidate | undefined)[] = original.map((p) => near(p)[0]);
  const axis =
    options.axes !== false &&
    options.direction !== false &&
    span * pixels >= penDirectionThresholds.minimumPixels
      ? referenceGeometry(base)
          .filter((r) => r.direction && !(r.ref.kind==='baseAxis' && r.ref.axisId==='MITER_45'))
          .map((r) => {
            const d = unit(sheetDeltaToLocal(base, entity.viewId, r.direction!));
            // Keep exact zero components for orthogonal axes in JSON.
            const cleaned = {
              x: Math.abs(d.x) < 1e-12 ? 0 : d.x,
              y: Math.abs(d.y) < 1e-12 ? 0 : d.y,
            };
            return { reference: r, direction: cleaned, cosine: Math.abs(dot(direction, cleaned)) };
          })
          .filter((a) => a.cosine >= Math.cos((penDirectionThresholds.degrees * Math.PI) / 180))
          .sort((a, b) => b.cosine - a.cosine)[0]
      : undefined;

  if (axis) {
    const [first, last] = candidates;
    // Two explicit existing targets take precedence over an inferred direction.
    // Never move a blue/shared point just to make the stroke horizontal.
    if (
      explicit(first) &&
      explicit(last) &&
      Math.abs(cross(sub(last!.position, first!.position), axis.direction)) > 1e-8
    ) {
      return { points: [first!.position, last!.position], candidates };
    }
    const anchor = last && (!first || (explicit(last) && !explicit(first))) ? 1 : 0;
    const other = 1 - anchor;
    const points = [...original];
    points[anchor] = candidates[anchor]?.position ?? original[anchor];
    points[other] = add(
      points[anchor],
      scale(axis.direction, dot(sub(original[other], points[anchor]), axis.direction)),
    );
    // Snapping the second end must not tilt the corrected line again. A nearby
    // target is accepted only when it actually lies on this supporting line.
    candidates[other] = near(points[other]).find(
      (c) =>
        distance(c.position, points[anchor]) > 1e-8 &&
        Math.abs(cross(sub(c.position, points[anchor]), axis.direction)) < 1e-8,
    );
    if (candidates[other]) points[other] = candidates[other]!.position;
    const sheetDirection = axis.reference.direction!;
    const directionLabel =
      Math.abs(sheetDirection.y) < 1e-12
        ? '水平'
        : Math.abs(sheetDirection.x) < 1e-12
          ? '垂直'
          : `沿 ${axis.reference.name} 方向`;
    return { points, candidates, directionLabel };
  }

  const start = candidates[0]?.position ?? original[0];
  if (!geometry.finite) {
    // An oblique auxiliary line keeps its fitted direction when only its anchor snaps.
    return {
      points: [start, add(start, scale(direction, span))],
      candidates: [candidates[0], undefined],
    };
  }
  candidates[1] = near(original[1], start).find((c) => c.kind !== 'AXIS_DIRECTION');
  return { points: [start, candidates[1]?.position ?? original[1]], candidates };
}

import { transact } from './document';
export function applyPenLineFit(
  doc: GeometryDocument,
  raw: GeometryDocument,
  fit: NonNullable<ReturnType<typeof penLinePreview>>,
  role: 'teacher' | 'student',
) {
  const entity = raw.entities.at(-1);
  if (!entity || (entity.kind !== 'line' && entity.kind !== 'segment'))
    throw Error('笔迹不是拟合直线');
  let next = transact(
    raw,
    (draft) => {
      const line = draft.entities.find((e) => e.id === entity.id);
      if (line?.kind === 'line') {
        line.anchor = fit.points[0];
        line.direction = sub(fit.points[1], fit.points[0]);
      }
      if (line?.kind === 'segment')
        [line.startPoint, line.endPoint].forEach((id, i) => {
          const point = draft.entities.find((e) => e.id === id);
          if (point?.kind === 'point') {
            point.position = fit.points[i];
            point.spatial = null;
          }
        });
    },
    role,
  );
  if (entity.kind === 'segment')
    for (const [i, id] of [entity.startPoint, entity.endPoint].entries()) {
      const candidate = fit.candidates[i];
      if (candidate) next = confirmSnap(doc, next, candidate, id, role);
    }

  return next;
}
