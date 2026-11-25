import { cloneElement, useId, useMemo, type CSSProperties } from 'react';
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
  drawingStyle,
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
  box: Bounds;
  scale: number;
  preview: Vec2[];
  steps: Vec2[];
  candidate: Vec2 | null;
  axisDraft: AxisConstruction | null;
}) {
  const doc = useMemo(() => sheetDrawingDocument(props.document), [props.document]);
  const strokeAppearance = props.tool === 'pen' ? props.appearance : undefined;
  const strokeStyle =
    strokeAppearance &&
    drawingStyle({ lineStyle: 'ANSWER_VISIBLE', appearance: strokeAppearance }, scale);
  const sheetPoints = useMemo(
    () => new Map(doc.entities.filter((e) => e.kind === 'point').map((e) => [e.id, e.position])),
    [doc],
  );
  const layer = useMemo(() => {
    const active = new Set([...props.selected, ...props.highlighted]);
    const clip: number[] = [],
      sized: number[] = [];
    const elements = doc.entities
      .filter((e) => !props.hiddenLayers.includes(e.layerId))
      .map((e, i) => {
        const selected = active.has(e.id);
        const labels = e.kind === 'point' && props.labels && e.labelVisible;
        if (e.kind === 'line') clip.push(i);
        if (selected || labels || e.appearance?.widthMm || e.kind === 'plane') sized.push(i);
        return (
          <EntityShape
            key={e.id}
            document={doc}
            sourceDocument={props.document}
            sheetPoints={sheetPoints}
            entity={e}
            labels={labels}
            selected={selected}
            scale={1}
          />
        );
      });
    return { elements, clip, sized };
  }, [
    doc,
    props.document,
    sheetPoints,
    props.labels,
    props.selected,
    props.highlighted,
    props.hiddenLayers,
  ]);
  // 镜头变化时复用图形层，保留实体绘制顺序。可视范围和点标记半径单独更新。
  const geometry = useMemo(() => {
    if (!layer.clip.length && !layer.sized.length) return layer.elements;
    const elements = layer.elements.slice();
    for (const i of layer.clip) elements[i] = cloneElement(elements[i], { box });
    for (const i of layer.sized) elements[i] = cloneElement(elements[i], { scale });
    return elements;
  }, [layer, box, scale]);
  const gridId = useId().replaceAll(':', '');
  // 缩小时减少过密的可见网格线，实际吸附间距仍使用文档设置。
  const minor =
    props.gridSpacing *
    5 ** Math.max(0, Math.ceil(Math.log(5 / (props.gridSpacing * scale)) / Math.log(5)));
  const major = minor * 5;
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
          x="0"
          y="0"
          width={minor}
          height={minor}
          data-world-grid="minor"
          patternUnits="userSpaceOnUse"
        >
          <path
            d={`M ${minor} 0 L 0 0 0 ${minor}`}
            fill="none"
            stroke="var(--cad-grid-minor,#dfe7e9)"
            strokeWidth={1 / scale}
          />
        </pattern>
        <pattern
          id={gridId + '-major'}
          x="0"
          y="0"
          width={major}
          height={major}
          patternUnits="userSpaceOnUse"
          data-world-grid="major"
        >
          <rect width={major} height={major} fill={`url(#${gridId})`} />
          <path
            d={`M ${major} 0 L 0 0 0 ${major}`}
            fill="none"
            stroke="var(--cad-grid-major,#bfd1d4)"
            strokeWidth={1.6 / scale}
          />
        </pattern>
      </defs>
      <g
        transform="scale(1 -1)"
        style={{ '--geo-point-radius': 3 / scale + 'px' } as CSSProperties}
      >
        <rect
          x={box.x}
          y={box.y}
          width={box.width}
          height={box.height}
          fill="var(--cad-paper,#f8fbfc)"
        />
        {props.grid && (
          <rect
            aria-hidden="true"
            x={box.x}
            y={box.y}
            width={box.width}
            height={box.height}
            fill={`url(#${gridId}-major)`}
          />
        )}
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
                    fill="var(--cad-axis,#638894)"
                  />
                  <text
                    fill="var(--cad-axis,#638894)"
                    transform={`translate(${r.anchor.x + 3 / scale} ${r.anchor.y - 12 / scale}) scale(1 -1)`}
                    fontSize={11 / scale}
                  >
                    {r.name === '原点 O' ? 'O' : r.name}
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
            const miter = r.ref.kind === 'baseAxis' && r.ref.axisId === 'MITER_45';
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
                      : 'var(--cad-axis,#638894)'
                }
                fill="none"
              >
                <line
                  x1={ends[0].x}
                  y1={ends[0].y}
                  x2={ends[1].x}
                  y2={ends[1].y}
                  strokeWidth={selected ? 2 : 1}
                  strokeDasharray={axis ? '10 3 2 3' : miter ? '4 5' : undefined}
                  opacity={miter && !selected ? 0.55 : undefined}
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
                    : r.ref.kind === 'baseAxis' && !miter
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
        {geometry}
        {preview.length > 0 && (
          <polyline
            data-transient="preview"
            points={preview.map((p) => `${p.x},${p.y}`).join(' ')}
            stroke={strokeAppearance?.color ?? 'var(--cad-accent,#0f766e)'}
            strokeDasharray={strokeStyle?.strokeDasharray}
            strokeWidth={strokeStyle?.strokeWidth ?? 2}
            vectorEffect="non-scaling-stroke"
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
