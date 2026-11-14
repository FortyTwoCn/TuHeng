import { useId } from 'react';
import type { Vec2 } from '@tuheng/contracts';
import {
  referenceGeometry,
  referenceKey,
  clipReference,
  sub,
  add,
  scale as multiply,
  unit,
  axisDirection,
  distance,
  minorArc,
  arcSvgPath,
  viewTransform,
  type AxisConstruction,
  type Bounds,
} from '@tuheng/geometry-core';
import type { EditorControls } from './types';
import { sheetDrawingDocument } from './sheet-drawing';
import { EntityShape } from './rendering';
export function ViewportDrawing({
  controls: props,
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
  const gridId = useId().replaceAll(':', '');
  const references = referenceGeometry(props.document);
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
          references.map((r) => {
            const key = referenceKey(r.ref),
              selected = props.selected.includes(key) || props.highlighted.includes(key);
            if (!r.direction)
              return (
                <g key={key} data-reference-id={key}>
                  <circle
                    cx={r.anchor.x}
                    cy={r.anchor.y}
                    r={(selected ? 4 : 2) / scale}
                    fill="#64748b"
                  />
                  <text
                    transform={`translate(${r.anchor.x + 3 / scale} ${r.anchor.y - 12 / scale}) scale(1 -1)`}
                    fontSize={11 / scale}
                  >
                    O
                  </text>
                </g>
              );
            const ends = clipReference(r, box);
            if (!ends) return null;
            const axis =
              r.ref.kind === 'projectionAxis'
                ? doc.auxiliarySystems?.find(
                    (a) => a.id === (r.ref.kind === 'projectionAxis' ? r.ref.systemId : ''),
                  )
                : undefined;
            const tip = axis
              ? r.anchor
              : add(ends[1], multiply(unit(sub(ends[0], ends[1])), 25 / scale));
            return (
              <g
                key={key}
                data-reference-id={key}
                data-axis-id={axis?.id}
                stroke={
                  selected
                    ? '#0f766e'
                    : axis
                      ? axis.owner === 'STUDENT'
                        ? '#0f766e'
                        : '#2563eb'
                      : '#64748b'
                }
                fill="none"
              >
                <line
                  x1={ends[0].x}
                  y1={ends[0].y}
                  x2={ends[1].x}
                  y2={ends[1].y}
                  strokeWidth={selected ? 2 : 1}
                  strokeDasharray={axis ? '10 3 2 3' : undefined}
                  vectorEffect="non-scaling-stroke"
                />
                {axis && (
                  <line
                    x1={axis.anchor.x}
                    y1={axis.anchor.y}
                    x2={axis.anchor.x + axis.positiveNormal.x * 10}
                    y2={axis.anchor.y + axis.positiveNormal.y * 10}
                    markerEnd={`url(#${gridId}-arrow)`}
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                <text
                  transform={`translate(${tip.x + 3 / scale} ${tip.y + 3 / scale}) scale(1 -1)`}
                  fill="currentColor"
                  stroke="none"
                  fontSize={11 / scale}
                >
                  {axis
                    ? `${axis.name} · ${doc.views.find((v) => v.id === axis.newViewId)?.name}`
                    : r.ref.kind === 'baseAxis'
                      ? r.ref.axisId
                      : r.name}
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
        {preview.length >= 2 && props.tool === 'circle' && (
          <circle
            data-transient="preview-circle"
            cx={preview[0].x}
            cy={preview[0].y}
            r={distance(preview[0], preview[1])}
            fill="none"
            stroke="#0f766e"
            strokeWidth={2 / scale}
          />
        )}
        {preview.length === 3 &&
          props.tool === 'arc' &&
          (() => {
            try {
              const a = minorArc(preview[0], preview[1], preview[2]),
                f = viewTransform(
                  props.document,
                  props.document.views.find((v) => v.id === props.session.active)?.id ??
                    props.document.views[0].id,
                );
              if (a.sweep === 180) a.sweep *= f.xAxis.x * f.yAxis.y - f.xAxis.y * f.yAxis.x;
              return (
                <path
                  data-transient="preview-arc"
                  d={arcSvgPath(preview[0], a.radius, a.startAngle, a.sweep)}
                  fill="none"
                  stroke="#0f766e"
                  strokeWidth={2 / scale}
                />
              );
            } catch {
              return null;
            }
          })()}
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
