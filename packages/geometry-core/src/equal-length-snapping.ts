import type { GeometryDocument, Vec2 } from '@tuheng/contracts';
import type { TrackingBase } from './drafting-guides';
import { add, distance, length, scale } from './math';
import { snapIndex } from './snap-geometry';
import {
  segmentSatisfiesGuide,
  type SnapCandidate,
  type SnapOptions,
  type SnapTrack,
} from './snapping';

/** Copy a length from a connected segment or a retained tracking base. */
export function equalLengthSnaps(
  doc: GeometryDocument,
  viewId: string,
  pointer: Vec2,
  radius: number,
  options: SnapOptions,
  rays: readonly { track: SnapTrack; snap: SnapCandidate }[],
  bases: readonly TrackingBase[],
  accepts: (p: Vec2) => boolean,
): SnapCandidate[] {
  if (!rays.length) return [];
  const close = (a: Vec2, b: Vec2) => distance(a, b) < 1e-7;
  const attached = (p: Vec2, segment: { start: Vec2; end: Vec2 }) =>
    close(p, segment.start) || close(p, segment.end);
  // Tracking guides use projected coordinates, while attachment uses each source view's endpoints.
  const basesByView = new Map<string, Vec2[]>([[viewId, []]]);
  for (const base of bases) {
    const sourceView = base.viewId ?? viewId;
    const positions = basesByView.get(sourceView);
    if (positions) positions.push(base.position);
    else basesByView.set(sourceView, [base.position]);
  }
  const segments = [...basesByView].flatMap(([sourceView, positions]) =>
    snapIndex(doc, sourceView).entries.flatMap(({ entity, shape }) => {
      if (
        entity?.kind !== 'segment' ||
        entity.viewId !== sourceView ||
        shape.kind !== 'line' ||
        options.hiddenLayers?.includes(entity.layerId) ||
        options.exclude?.includes(entity.id)
      )
        return [];
      const { a, d } = shape.line;
      const span = { start: a, end: add(a, d) };
      const local = sourceView === viewId;
      const tracked = positions.some((p) => attached(p, span));
      return local || tracked
        ? [{ id: entity.id, ...span, length: length(d), local, tracked }]
        : [];
    }),
  );
  return rays.flatMap(({ track, snap }): SnapCandidate[] => {
    const { point, direction } = track;
    const guide = snap.guide;
    const connected =
      guide?.kind === 'perpendicular' && close(guide.contact, point)
        ? segments.find(({ id, local }) => local && id === guide.sourceId)
        : undefined;
    const origins = [point, ...(connected ? [connected.start, connected.end] : [])];
    const span = distance(pointer, point);
    return segments.flatMap((source): SnapCandidate[] => {
      if (
        Math.abs(source.length - span) > radius ||
        !(source.tracked || (source.local && origins.some((p) => attached(p, source))))
      )
        return [];
      const position = add(point, scale(direction, source.length));
      const gap = distance(position, pointer);
      if (
        gap > radius * 0.7 ||
        !accepts(position) ||
        (guide && !segmentSatisfiesGuide(point, position, guide))
      )
        return [];
      return [
        {
          id: `EQUAL_LENGTH:${snap.id ?? snap.kind}:${source.id}`,
          kind: 'TRACKING',
          composite: 'constraints',
          position,
          positionOnly: true,
          label: '等长',
          distance: gap,
          guide,
          anchor: point,
          entityIds: [...new Set([...snap.entityIds, source.id])],
          equalLength: { sourceId: source.id, length: source.length },
        },
      ];
    });
  });
}
