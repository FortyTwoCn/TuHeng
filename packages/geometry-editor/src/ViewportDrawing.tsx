import { useId } from 'react';
import type { Vec2 } from '@tuheng/contracts';
import {
  viewAxes,
  unit,
  orthographic,
  clipLine,
  axisDirection,
  type AxisConstruction,
  type Bounds,
} from '@tuheng/geometry-core';
import type { EditorControls } from './types';
import { sheetDrawingDocument } from './sheet-drawing';
import { EntityShape } from './rendering';
export function ViewportDrawing({
  controls: props,
  viewId,
  box,
  scale,
  preview,
  steps,
  candidate,
  axisDraft,
}: {
  controls: EditorControls;
  viewId: string;
  box: Bounds;
  scale: number;
  preview: Vec2[];
  steps: Vec2[];
  candidate: Vec2 | null;
  axisDraft: AxisConstruction | null;
}) {
  const doc = sheetDrawingDocument(props.document);
  const axes = orthographic(doc)
    ? { X: { x: -1, y: 0 }, Z: { x: 0, y: 1 }, Y_H: { x: 0, y: -1 }, Y_W: { x: 1, y: 0 } }
    : viewAxes(doc, viewId);
  const gridId = useId().replaceAll(':', '');
  const end = (direction: Vec2, inset: number) => {
    const d = unit(direction);
    const tx = d.x > 0 ? (box.x + box.width) / d.x : d.x < 0 ? box.x / d.x : Infinity,
      ty = d.y > 0 ? (box.y + box.height) / d.y : d.y < 0 ? box.y / d.y : Infinity;
    const extent = Math.max(0, Math.min(tx, ty) - inset / scale);
    return { x: d.x * extent, y: d.y * extent };
  };
  return (
    <>
      {' '}
      <defs>
        <marker
          id={`${gridId}-arrow`}
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth={7 / scale}
          markerHeight={7 / scale}
          markerUnits="userSpaceOnUse"
          orient="auto"
        >
          <path d="M0 0 L10 5 L0 10 Z" fill="#0f766e" />
        </marker>
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
          doc.editorType !== 'THREE_VIEW' &&
          Object.entries(axes).map(([name, d]) => (
            <g key={name}>
              <line
                x1={0}
                y1={0}
                x2={end(d, 35).x}
                y2={end(d, 35).y}
                stroke="#64748b"
                vectorEffect="non-scaling-stroke"
              />
              <text
                transform={`translate(${end(d, 25).x} ${end(d, 25).y}) scale(1 -1)`}
                textAnchor="middle"
                fontSize={11 / scale}
              >
                {name}
              </text>
            </g>
          ))}
        {props.axes && (
          <g>
            <circle cx={0} cy={0} r={2 / scale} fill="#64748b" />
            {doc.editorType !== 'THREE_VIEW' && (
              <text
                transform={`translate(${3 / scale} ${-12 / scale}) scale(1 -1)`}
                fontSize={11 / scale}
              >
                O
              </text>
            )}
          </g>
        )}
        {(doc.auxiliarySystems ?? []).map((a) => {
          const ends = clipLine({ a: a.anchor, d: a.tangent, finite: false }, box);
          if (!ends) return null;
          return (
            <g
              key={a.id}
              data-axis-id={a.id}
              stroke={a.owner === 'STUDENT' ? '#0f766e' : '#2563eb'}
              fill="none"
            >
              <line
                x1={ends[0].x}
                y1={ends[0].y}
                x2={ends[1].x}
                y2={ends[1].y}
                strokeDasharray="10 3 2 3"
                vectorEffect="non-scaling-stroke"
              />
              <line
                x1={a.anchor.x}
                y1={a.anchor.y}
                x2={a.anchor.x + a.positiveNormal.x * 10}
                y2={a.anchor.y + a.positiveNormal.y * 10}
                markerEnd={`url(#${gridId}-arrow)`}
                vectorEffect="non-scaling-stroke"
              />
              <text
                transform={`translate(${a.anchor.x + 3} ${a.anchor.y + 3}) scale(1 -1)`}
                fill="currentColor"
                stroke="none"
                fontSize={12 / scale}
              >
                {a.name} · {doc.views.find((v) => v.id === a.newViewId)?.name}
              </text>
            </g>
          );
        })}
        {axisDraft &&
          (() => {
            const t = axisDirection(props.document, axisDraft),
              n = { x: -t.y * axisDraft.side, y: t.x * axisDraft.side },
              a = axisDraft.anchor;
            const points = [
              { x: a.x - t.x * 60, y: a.y - t.y * 60 },
              { x: a.x + t.x * 60, y: a.y + t.y * 60 },
              { x: a.x + t.x * 60 + n.x * 35, y: a.y + t.y * 60 + n.y * 35 },
              { x: a.x - t.x * 60 + n.x * 35, y: a.y - t.y * 60 + n.y * 35 },
            ];
            return (
              <g data-transient="axis-preview">
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={a.x + n.x * 12}
                  y2={a.y + n.y * 12}
                  markerEnd={`url(#${gridId}-arrow)`}
                  stroke="#0f766e"
                  vectorEffect="non-scaling-stroke"
                />
                <polygon
                  points={points.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="#14b8a630"
                  stroke="#0f766e"
                  vectorEffect="non-scaling-stroke"
                />
                <text
                  transform={`translate(${a.x + n.x * 15} ${a.y + n.y * 15}) scale(1 -1)`}
                  fontSize={14 / scale}
                >
                  {axisDraft.name} → {axisDraft.viewName}
                </text>
              </g>
            );
          })()}
        {candidate && (
          <circle
            data-transient="snap-target"
            cx={candidate.x}
            cy={candidate.y}
            r={7 / scale}
            fill="#14b8a630"
            stroke="#0f766e"
            strokeWidth={2 / scale}
          />
        )}
        {doc.entities
          .filter((e) => !props.hiddenLayers.includes(e.layerId))
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
