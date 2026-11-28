import type { Bounds } from '@tuheng/geometry-core';
import { beatStyle, type ConstructionPlayback } from './construction-playback';
import { ProgressiveStroke } from './ProgressiveStroke';

// 只有临时投影线和定位标记属于动画覆盖层。
export function ConstructionOverlays({
  playback,
  box,
  scale,
  activeGuideCount,
}: {
  playback: ConstructionPlayback;
  box: Bounds;
  scale: number;
  activeGuideCount: number;
}) {
  const { duration, state } = playback;
  const guides = [...state.temporaryGuides];
  const pointsToShow = [...state.focusPoints].filter(([, point]) => point.role === 'ACTIVE_DRAW');
  return (
    <g aria-hidden="true" pointerEvents="none" data-construction-overlays>
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
