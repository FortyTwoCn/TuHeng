import { useId } from 'react';
import type { Vec2 } from '@tuheng/contracts';
import { viewAxes, unit, type Bounds } from '@tuheng/geometry-core';
import type { EditorControls } from './types';
import { EntityShape } from './rendering';
export function ViewportDrawing({
  controls: props,
  viewId,
  box,
  scale,
  preview,
  steps,
}: {
  controls: EditorControls;
  viewId: string;
  box: Bounds;
  scale: number;
  preview: Vec2[];
  steps: Vec2[];
}) {
  const doc = props.document;
  const axes = viewAxes(doc, viewId);
  const gridId = useId().replaceAll(':', '');
  return (
    <>
      {' '}
      <defs>
        <pattern
          id={gridId}
          width={doc.settings.grid}
          height={doc.settings.grid}
          patternUnits="userSpaceOnUse"
        >
          <path
            d={`M ${doc.settings.grid} 0 L 0 0 0 ${doc.settings.grid}`}
            fill="none"
            stroke="#e2e8f0"
            strokeWidth={0.5 / scale}
          />
        </pattern>
      </defs>
      <g transform="scale(1 -1)">
        <rect
          x={box.x}
          y={box.y}
          width={box.width}
          height={box.height}
          fill={props.grid ? `url(#${gridId})` : '#fff'}
        />
        {props.axes &&
          Object.entries(axes).map(([name, d]) => (
            <g key={name}>
              <line
                x1={0}
                y1={0}
                x2={unit(d).x * 25}
                y2={unit(d).y * 25}
                stroke="#64748b"
                vectorEffect="non-scaling-stroke"
              />
              <text
                transform={`translate(${unit(d).x * 27} ${unit(d).y * 27}) scale(1 -1)`}
                fontSize={11 / scale}
              >
                {name}
              </text>
            </g>
          ))}
        {doc.entities
          .filter((e) => e.viewId === viewId && !props.hiddenLayers.includes(e.layerId))
          .map((e) => (
            <EntityShape
              key={e.id}
              document={doc}
              entity={e}
              box={box}
              scale={scale}
              labels={props.labels}
              selected={props.selected.includes(e.id) || props.highlighted.includes(e.id)}
            />
          ))}
        {preview.length > 0 && (
          <polyline
            data-transient="preview"
            points={preview.map((p) => `${p.x},${p.y}`).join(' ')}
            stroke="#0f766e"
            strokeWidth={2 / scale}
            fill="none"
          />
        )}
        {steps.map((p, i) => (
          <circle data-transient="step" key={i} cx={p.x} cy={p.y} r={4 / scale} fill="#d97706" />
        ))}
        {props.ruler.visible && (
          <g
            data-transient="ruler"
            transform={`translate(${props.ruler.origin.x} ${props.ruler.origin.y}) rotate(${props.ruler.angle})`}
          >
            <rect
              data-ruler="true"
              x={0}
              y={0}
              width={props.ruler.length}
              height={5}
              fill="#fbbf2480"
              stroke="#b45309"
              strokeWidth={1 / scale}
            />
            {Array.from({ length: Math.floor(props.ruler.length / 5) + 1 }, (_, i) => (
              <line
                key={i}
                x1={i * 5}
                x2={i * 5}
                y1={0}
                y2={i % 2 === 0 ? 3 : 2}
                stroke="#92400e"
                strokeWidth={1 / scale}
              />
            ))}
          </g>
        )}
      </g>
    </>
  );
}
