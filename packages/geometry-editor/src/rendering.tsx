import { memo } from 'react';
import type { GeometryDocument, GeometryEntity } from '@tuheng/contracts';
import {
  arcSvgPath,
  clipLine,
  lineGeometry,
  point,
  planeOutline,
  projectPoint,
  type Bounds,
} from '@tuheng/geometry-core';
export const lineStyles = {
  CONSTRUCTION: { stroke: '#9ca3af', strokeDasharray: '5 5' },
  ANSWER_VISIBLE: { stroke: '#17212f' },
  ANSWER_HIDDEN: { stroke: '#17212f', strokeDasharray: '7 4' },
  PROBLEM_VISIBLE: { stroke: '#2563eb' },
  PROBLEM_HIDDEN: { stroke: '#2563eb', strokeDasharray: '7 4' },
};
export const EntityShape = memo(function EntityShape({
  document: doc,
  entity: e,
  box,
  selected,
  labels,
  scale,
}: {
  document: GeometryDocument;
  entity: GeometryEntity;
  box: Bounds;
  selected: boolean;
  labels: boolean;
  scale: number;
}) {
  const style = {
    ...lineStyles[e.lineStyle],
    strokeWidth: selected ? 3 : 1.6,
    fill: 'none',
    vectorEffect: 'non-scaling-stroke' as const,
  };
  if (selected) style.stroke = '#d97706';
  let shape;
  if (e.kind === 'point')
    shape = (
      <>
        <circle
          vectorEffect="non-scaling-stroke"
          cx={e.position.x}
          cy={e.position.y}
          r={3 / scale}
          fill={style.stroke}
        />
        {labels && e.labelVisible && (
          <text
            transform={`translate(${e.position.x + 5 / scale} ${e.position.y + 5 / scale}) scale(1 -1)`}
            fontSize={12 / scale}
            stroke="none"
            fill={style.stroke}
          >
            {e.name}
          </text>
        )}
      </>
    );
  else if (e.kind === 'segment' || e.kind === 'line') {
    const ends = clipLine(lineGeometry(doc, e), box);
    shape = ends && (
      <line
        vectorEffect="non-scaling-stroke"
        x1={ends[0].x}
        y1={ends[0].y}
        x2={ends[1].x}
        y2={ends[1].y}
      />
    );
  } else if (e.kind === 'polyline')
    shape = (
      <polyline
        vectorEffect="non-scaling-stroke"
        points={e.points.map((p) => `${p.x},${p.y}`).join(' ')}
      />
    );
  else if (e.kind === 'plane')
    shape = (
      <>
        <polyline
          vectorEffect="non-scaling-stroke"
          points={planeOutline(doc, e)
            .map((p) => `${p.x},${p.y}`)
            .join(' ')}
        />
        <text
          transform={`translate(${projectPoint(doc, e.origin, e.viewId).x} ${projectPoint(doc, e.origin, e.viewId).y}) scale(1 -1)`}
          fontSize={10 / scale}
          stroke="none"
          fill={style.stroke}
        >
          投影面
        </text>
      </>
    );
  else {
    const c = point(doc, e.center);
    if (e.kind === 'circle')
      shape = <circle vectorEffect="non-scaling-stroke" cx={c.x} cy={c.y} r={e.radius} />;
    else {
      shape = (
        <path
          vectorEffect="non-scaling-stroke"
          d={arcSvgPath(c, e.radius, e.startAngle, e.sweep)}
        />
      );
    }
  }
  return (
    <g data-entity-id={e.id} data-kind={e.kind} data-style={e.lineStyle} {...style}>
      <title>{e.id}</title>
      {shape}
    </g>
  );
});
