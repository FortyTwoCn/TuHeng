import type { CSSProperties } from 'react';
import type { Vec2 } from '@tuheng/contracts';
import { drawingStyle, type AxisConstruction, type Bounds } from '@tuheng/geometry-core';
import type { EditorControls } from './types';
import { DrawingAuditMarkers } from './modules/audit/DrawingAuditModule';
import { ViewportEntities } from './viewport/ViewportEntities';
import { ViewportPaper } from './viewport/ViewportPaper';

export type ViewportDrawingControls = Pick<
  EditorControls,
  | 'document'
  | 'grid'
  | 'gridSpacing'
  | 'axes'
  | 'labels'
  | 'selected'
  | 'highlighted'
  | 'hiddenLayers'
> &
  Partial<Pick<EditorControls, 'playback' | 'auditCheck' | 'tool' | 'appearance' | 'ruler'>> & {
    inspectOnly?: boolean;
  };

const noPoints: Vec2[] = [];

export function ViewportDrawing({
  controls: props,
  box,
  scale,
  preview = noPoints,
  steps = noPoints,
  candidate,
  axisDraft,
}: {
  controls: ViewportDrawingControls;
  box: Bounds;
  scale: number;
  preview?: Vec2[];
  steps?: Vec2[];
  candidate?: Vec2 | null;
  axisDraft?: AxisConstruction | null;
}) {
  const strokeAppearance = props.tool === 'pen' ? props.appearance : undefined;
  const strokeStyle =
    strokeAppearance &&
    drawingStyle({ lineStyle: 'ANSWER_VISIBLE', appearance: strokeAppearance }, scale);
  return (
    <g transform="scale(1 -1)" style={{ '--geo-point-radius': 3 / scale + 'px' } as CSSProperties}>
      <ViewportPaper controls={props} box={box} scale={scale} axisDraft={axisDraft} />
      {candidate && (
        <circle
          data-transient="snap-target"
          cx={candidate.x}
          cy={candidate.y}
          r={7 / scale}
          fill="var(--cad-drawing-fill)"
          stroke="var(--cad-accent)"
          strokeWidth={2 / scale}
        />
      )}
      <ViewportEntities controls={props} box={box} scale={scale} />
      <DrawingAuditMarkers doc={props.document} check={props.auditCheck} scale={scale} />
      {preview.length > 0 && (
        <polyline
          data-transient="preview"
          points={preview.map((p) => `${p.x},${p.y}`).join(' ')}
          stroke={strokeAppearance?.color ?? 'var(--cad-accent)'}
          strokeDasharray={strokeStyle?.strokeDasharray}
          strokeWidth={strokeStyle?.strokeWidth ?? 2}
          vectorEffect="non-scaling-stroke"
          fill="none"
        />
      )}
      {steps.map((p, i) => (
        <circle
          data-transient="step"
          key={i}
          cx={p.x}
          cy={p.y}
          r={4 / scale}
          fill="var(--cad-relation)"
        />
      ))}
      {props.ruler?.visible && (
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
            fill="var(--cad-warning-fill)"
            stroke="var(--cad-relation)"
            strokeWidth={1 / scale}
          />
          {Array.from({ length: Math.floor(props.ruler.length / 5) + 1 }, (_, i) => (
            <line
              key={i}
              x1={i * 5}
              x2={i * 5}
              y1={0}
              y2={i % 2 === 0 ? 3 : 2}
              stroke="var(--cad-relation)"
              strokeWidth={1 / scale}
            />
          ))}
        </g>
      )}
    </g>
  );
}
