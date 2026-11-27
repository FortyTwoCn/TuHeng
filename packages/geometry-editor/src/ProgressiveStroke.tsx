import { cloneElement, useId, type CSSProperties, type ReactElement, type SVGProps } from 'react';
import type { Bounds } from '@tuheng/geometry-core';

export function ProgressiveStroke({
  shape,
  timing,
  box,
  scale,
  width,
}: {
  shape: ReactElement<SVGProps<SVGElement>>;
  timing: CSSProperties;
  box: Bounds;
  scale: number;
  width: number;
}) {
  const id = 'draw-' + useId().replaceAll(':', '');
  const pad = 4 / scale;
  return (
    <>
      <mask
        id={id}
        maskUnits="userSpaceOnUse"
        x={box.x - pad}
        y={box.y - pad}
        width={box.width + pad * 2}
        height={box.height + pad * 2}
      >
        {cloneElement(shape, {
          className: 'geo-ink-trace',
          pathLength: 1,
          style: timing,
          // Normalize the tracing path before the viewport transform. The
          // visible stroke keeps its non-scaling width and engineering dash.
          vectorEffect: 'none',
          stroke: 'white',
          strokeWidth: (width + 3) / scale,
          strokeLinecap: 'round',
          strokeDasharray: 'none',
          fill: 'none',
        })}
      </mask>
      {cloneElement(shape, { mask: `url(#${id})` })}
    </>
  );
}
