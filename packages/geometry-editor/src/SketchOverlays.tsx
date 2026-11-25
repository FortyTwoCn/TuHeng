import type { Bounds } from '@tuheng/geometry-core';

export function SketchOverlays({
  marquee,
  scale,
}: {
  marquee: { box: Bounds; mode: 'window' | 'crossing' } | null;
  scale: number;
}) {
  return (
    <>
      {marquee && (
        <g data-selection-mode={marquee.mode} data-transient="marquee" pointerEvents="none">
          <rect
            x={marquee.box.x}
            y={-marquee.box.y - marquee.box.height}
            width={marquee.box.width}
            height={marquee.box.height}
            fill={marquee.mode === 'window' ? '#0284c71a' : '#16a34a1a'}
            stroke={marquee.mode === 'window' ? '#0284c7' : '#15803d'}
            strokeWidth={1 / scale}
            strokeDasharray={marquee.mode === 'crossing' ? `${5 / scale} ${3 / scale}` : undefined}
          />
          <text
            x={marquee.box.x + 5 / scale}
            y={-marquee.box.y - marquee.box.height + 16 / scale}
            fontSize={12 / scale}
          >
            {marquee.mode === 'window' ? 'Window · 完全包含' : 'Crossing · 包含或相交'}
          </text>
        </g>
      )}
    </>
  );
}
