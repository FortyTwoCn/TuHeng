import type { GeometryDocument, Vec2 } from '@tuheng/contracts';
import type { Bounds, ConstructionVisualRole } from '@tuheng/geometry-core';
import { beatStyle, type ConstructionPlayback } from './construction-playback';
import { EntityShape } from './rendering';
import { ProgressiveStroke } from './ProgressiveStroke';

const paintOrder: Partial<Record<ConstructionVisualRole, number>> = {
  COMPLETED_DRAFT: 0,
  DEEPENED: 0,
  ACTIVE_CONSTRUCT: 1,
  ERASING: 2,
  ACTIVE_DRAW: 3,
};

export function ConstructionDrawing({
  source,
  doc,
  points,
  playback,
  box,
  scale,
  highlighted,
}: {
  source: GeometryDocument;
  doc: GeometryDocument;
  points: ReadonlyMap<string, Vec2>;
  playback: ConstructionPlayback;
  box: Bounds;
  scale: number;
  highlighted: string[];
}) {
  const { duration, state, playKey } = playback;
  const entities = doc.entities
    .flatMap((entity) => {
      const visual = state.entities.get(entity.id);
      if (!visual || paintOrder[visual.role] === undefined) return [];
      if (visual.isGuide && !visual.isCenterline && !playback.guides && visual.role !== 'ERASING')
        return [];
      if (entity.kind === 'point' && !entity.labelVisible && visual.role === 'DEEPENED') return [];
      return [{ entity, visual }];
    })
    .sort(
      (a, b) =>
        paintOrder[a.visual.role]! - paintOrder[b.visual.role]! || a.visual.order - b.visual.order,
    );
  const guides = [...state.temporaryGuides.entries()];
  const pointsToShow = [...state.focusPoints.entries()].filter(
    ([, point]) => point.role === 'ACTIVE_DRAW',
  );
  const activeGuideCount = Math.max(
    0,
    ...[...entities.map(({ visual }) => visual), ...guides.map(([, visual]) => visual)]
      .filter(({ role }) => role === 'ACTIVE_CONSTRUCT')
      .map(({ order }) => order + 1),
  );
  const activeDrawCount = Math.max(
    0,
    ...entities
      .filter(({ visual }) => visual.role === 'ACTIVE_DRAW')
      .map(({ visual }) => visual.order + 1),
  );
  const focused = new Set(highlighted);
  return (
    <g
      key={playKey}
      data-construction-play-key={playKey}
      data-construction-paused={playback.paused}
    >
      {playback.guides &&
        guides.map(([id, guide]) => {
          if (guide.role !== 'COMPLETED_DRAFT' && guide.role !== 'ACTIVE_CONSTRUCT') return null;
          const active = guide.role === 'ACTIVE_CONSTRUCT';
          const timing = active
            ? beatStyle('construct', guide.order, activeGuideCount, duration)
            : undefined;
          const strokeWidth = active ? 1.8 : 1.15;
          const line = (
            <line
              x1={guide.from.x}
              y1={guide.from.y}
              x2={guide.to.x}
              y2={guide.to.y}
              vectorEffect="non-scaling-stroke"
              strokeWidth={strokeWidth}
            />
          );
          return (
            <g
              key={id}
              data-temporary-guide={id}
              data-construction-role={guide.role}
              aria-hidden="true"
              stroke={active ? 'var(--geo-animation-blue)' : 'var(--geo-animation-draft)'}
              pointerEvents="none"
            >
              {timing ? (
                <ProgressiveStroke
                  shape={line}
                  timing={timing}
                  box={box}
                  scale={scale}
                  width={strokeWidth}
                />
              ) : (
                line
              )}
              {active && guide.label && (
                <text
                  className="geo-focus-enter"
                  style={timing}
                  fill="var(--geo-animation-blue)"
                  stroke="none"
                  transform={`translate(${guide.to.x + 3 / scale} ${guide.to.y + 4 / scale}) scale(1 -1)`}
                  fontSize={11 / scale}
                >
                  {guide.label}
                </text>
              )}
            </g>
          );
        })}
      {entities.map(({ entity, visual }) => {
        const timing =
          visual.role === 'ACTIVE_CONSTRUCT'
            ? beatStyle('construct', visual.order, activeGuideCount, duration)
            : visual.role === 'ACTIVE_DRAW'
              ? beatStyle('draw', visual.order, activeDrawCount, duration)
              : undefined;
        return (
          <EntityShape
            key={entity.id}
            document={doc}
            sourceDocument={source}
            entity={entity}
            sheetPoints={points}
            selected={false}
            labels={entity.kind === 'point' && entity.labelVisible}
            playback={{ visual, timing, linked: focused.has(entity.id) }}
            box={box}
            scale={scale}
          />
        );
      })}
      {pointsToShow.map(([id, point]) => (
        <g
          key={id}
          data-focus-point={id}
          data-focus-kind={point.kind}
          pointerEvents="none"
          aria-hidden="true"
          transform={`translate(${point.position.x} ${point.position.y})`}
        >
          <g
            className="geo-focus-enter"
            style={beatStyle('focus', point.order, pointsToShow.length, duration)}
          >
            <circle
              r={5 / scale}
              fill={point.kind === 'SPECIAL' ? '#e88016' : '#15a56c'}
              stroke="var(--cad-paper)"
              strokeWidth={1.8 / scale}
            />
            {point.label && (
              <text
                fill="var(--geo-animation-ink)"
                fontSize={12 / scale}
                transform={`translate(${8 / scale} ${6 / scale}) scale(1 -1)`}
              >
                {point.label}
              </text>
            )}
          </g>
        </g>
      ))}
    </g>
  );
}
