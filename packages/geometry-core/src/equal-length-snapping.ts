import type { GeometryDocument, Vec2 } from '@tuheng/contracts';
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
  anchors: readonly Vec2[],
  accepts: (p: Vec2) => boolean,
): SnapCandidate[] {
  if (!rays.length) return [];
  const close = (a: Vec2, b: Vec2) => distance(a, b) < 1e-7;
  const segments = snapIndex(doc, viewId).entries.flatMap(({ entity, shape }) => {
    if (
      entity?.kind !== 'segment' ||
      entity.viewId !== viewId ||
      shape.kind !== 'line' ||
      options.hiddenLayers?.includes(entity.layerId) ||
      options.exclude?.includes(entity.id)
    )
      return [];
    const { a, d } = shape.line;
    return [{ id: entity.id, start: a, end: add(a, d), length: length(d) }];
  });
  return rays.flatMap(({ track, snap }): SnapCandidate[] => {
    const { point, direction } = track;
    const guide = snap.guide;
    const connected =
      guide?.kind === 'perpendicular' && close(guide.contact, point)
        ? segments.find(({ id }) => id === guide.sourceId)
        : undefined;
    const origins = [point, ...anchors, ...(connected ? [connected.start, connected.end] : [])];
    const span = distance(pointer, point);
    return segments.flatMap((source): SnapCandidate[] => {
      if (
        Math.abs(source.length - span) > radius ||
        !origins.some((p) => close(p, source.start) || close(p, source.end))
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
