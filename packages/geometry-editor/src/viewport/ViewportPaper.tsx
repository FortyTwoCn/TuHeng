import { useId, useMemo } from 'react';
import type { GeometryDocument } from '@tuheng/contracts';
import {
  referenceGeometry,
  referenceKey,
  clipReference,
  sub,
  add,
  scale as multiply,
  unit,
  axisDirection,
  type AxisConstruction,
  type Bounds,
} from '@tuheng/geometry-core';

type PaperControls = {
  document: GeometryDocument;
  grid: boolean;
  gridSpacing: number;
  axes: boolean;
  selected: readonly string[];
  highlighted: readonly string[];
};

// 网格、坐标轴和纸面由主画布和参考画布共同使用。
export function ViewportPaper({
  controls: props,
  box,
  scale,
  axisDraft,
}: {
  controls: PaperControls;
  box: Bounds;
  scale: number;
  axisDraft?: AxisConstruction | null;
}) {
  const gridId = useId().replaceAll(':', '');
  // 缩小时减少过密的可见网格线，实际吸附间距仍使用文档设置。
  const minor =
    props.gridSpacing *
    5 ** Math.max(0, Math.ceil(Math.log(5 / (props.gridSpacing * scale)) / Math.log(5)));
  const major = minor * 5;
  const doc = props.document;
  const references = useMemo(() => referenceGeometry(doc), [doc]);
  return (
    <>
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
          <path d="M0 0 L10 5 L0 10 Z" fill="var(--cad-accent)" />
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
            stroke="var(--cad-grid-minor)"
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
            stroke="var(--cad-grid-major)"
            strokeWidth={1.6 / scale}
          />
        </pattern>
      </defs>
      <rect x={box.x} y={box.y} width={box.width} height={box.height} fill="var(--cad-paper)" />
      {props.grid && (
        <rect
          aria-hidden="true"
          data-viewport-grid
          x={box.x}
          y={box.y}
          width={box.width}
          height={box.height}
          fill={`url(#${gridId}-major)`}
        />
      )}
      {props.axes &&
        doc.editorType === 'VH_PROJECTION' &&
        (
          [
            ['V', '正立投影面', box.y + box.height - 18 / scale, 1],
            ['H', '水平投影面', box.y + 10 / scale, -1],
          ] as const
        ).map(
          ([name, label, y, side]) =>
            y * side > 0 && (
              <text
                key={name}
                data-projection-face={name}
                aria-label={`${name} ${label}`}
                fill="var(--cad-axis-label)"
                transform={`translate(${box.x + 10 / scale} ${y}) scale(1 -1)`}
                fontSize={12 / scale}
                pointerEvents="none"
              >
                {name}
              </text>
            ),
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
                  fill="var(--cad-axis)"
                />
                <text
                  fill="var(--cad-axis-label)"
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
                selected || axis?.owner === 'STUDENT'
                  ? 'var(--cad-accent)'
                  : axis
                    ? 'var(--cad-stem)'
                    : 'var(--cad-axis)'
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
                fill="var(--cad-axis-label)"
                stroke="none"
                fontSize={11 / scale}
              >
                {axis
                  ? `${axis.name} · ${doc.views.find((v) => v.id === axis.newViewId)?.name}`
                  : r.ref.kind === 'baseAxis' && !miter && doc.editorType !== 'VH_PROJECTION'
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
                stroke="var(--cad-accent)"
                vectorEffect="non-scaling-stroke"
              />
              <polygon
                points={points.map((p) => `${p.x},${p.y}`).join(' ')}
                fill="var(--cad-drawing-fill)"
                stroke="var(--cad-accent)"
                vectorEffect="non-scaling-stroke"
              />
              <text
                transform={`translate(${a.x + n.x * 15} ${a.y + n.y * 15}) scale(1 -1)`}
                fontSize={14 / scale}
                fill="var(--cad-accent)"
              >
                {axisDraft.name} → {axisDraft.viewName}
              </text>
            </g>
          );
        })()}
    </>
  );
}
