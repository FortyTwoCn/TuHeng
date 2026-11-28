import { memo, useMemo, type CSSProperties, type ReactElement, type SVGProps } from 'react';
import {
  isCadEntity,
  type GeometryDocument,
  type GeometryEntity,
  type Vec2,
} from '@tuheng/contracts';
import {
  arcSvgPath,
  curvePath,
  clipLine,
  point,
  planeOutline,
  projectPoint,
  type Bounds,
  cadDrawing,
  mapCadDrawing,
  ellipsePath,
  drawingStyle,
  drawingRunLength,
  localToSheet,
  ellipseAt,
  type ConstructionVisual,
} from '@tuheng/geometry-core';
import { semanticLineStyles } from '@tuheng/geometry-core';
import { constructionInk } from './modules/animation/construction-playback';
import { ProgressiveStroke } from './modules/animation/ProgressiveStroke';
export const lineStyles = semanticLineStyles;
export const EntityShape = memo(function EntityShape({
  document: doc,
  entity: e,
  box,
  selected,
  labels,
  scale,
  sourceDocument,
  sheetPoints,
  animationVisual,
  inspectOnly,
}: {
  document: GeometryDocument;
  entity: GeometryEntity;
  box?: Bounds;
  selected: boolean;
  labels: boolean;
  scale: number;
  sourceDocument?: GeometryDocument;
  sheetPoints: ReadonlyMap<string, Vec2>;
  animationVisual?: { visual: ConstructionVisual; timing?: CSSProperties; linked: boolean };
  inspectOnly?: boolean;
}) {
  const source = sourceDocument ?? doc;
  const baseStyle = drawingStyle(e, scale);
  const runLength = useMemo(
    () => (baseStyle.strokeDasharray ? drawingRunLength(source, e) : undefined),
    [source, e, baseStyle.strokeDasharray],
  );
  const appearance = runLength !== undefined ? drawingStyle(e, scale, runLength) : baseStyle;
  // DXF 会把缺省墨色记录为 RGB。参考图把这种缺省颜色映射到当前纸面主题。
  const color = e.appearance?.color?.toLowerCase();
  if (!color || (inspectOnly && color === semanticLineStyles[e.lineStyle].stroke)) {
    if (e.lineStyle.startsWith('ANSWER')) appearance.stroke = 'var(--cad-ink,#253b47)';
    if (e.lineStyle === 'CONSTRUCTION') appearance.stroke = 'var(--cad-axis,#638894)';
    if (e.lineStyle.startsWith('PROBLEM')) appearance.stroke = 'var(--cad-stem,#4585dd)';
  }
  if (animationVisual) Object.assign(appearance, constructionInk(e, animationVisual.visual, scale));
  const style = {
    ...appearance,
    strokeWidth: selected ? Math.max(appearance.strokeWidth + 1, 3) : appearance.strokeWidth,
    fill: 'none',
    vectorEffect: 'non-scaling-stroke' as const,
  };
  if (animationVisual?.linked) {
    style.stroke = 'var(--cad-accent)';
    style.strokeWidth += 1.2;
  }
  if (inspectOnly && selected) style.stroke = 'var(--cad-accent,#0f766e)';
  const trace = (shape: ReactElement<SVGProps<SVGElement>>) =>
    animationVisual?.timing && box ? (
      <ProgressiveStroke
        shape={shape}
        timing={animationVisual.timing}
        box={box}
        scale={scale}
        width={style.strokeWidth}
      />
    ) : (
      shape
    );

  let shape;
  const at = (p: Vec2) => (sourceDocument ? localToSheet(source, e.viewId, p) : p);
  const cadGeometry = useMemo(() => {
    if (!isCadEntity(e)) return null;
    const project = (p: Vec2) => (sourceDocument ? localToSheet(sourceDocument, e.viewId, p) : p);
    if (e.kind === 'ellipse') return { path: ellipsePath(source, e, project), labels: [] };
    const drawing = mapCadDrawing(cadDrawing(source, e), project);
    return {
      path: drawing.strokes
        .map((path) => path.map((p, i) => (i ? 'L' : 'M') + p.x + ' ' + p.y).join(' '))
        .join(' '),
      labels: drawing.labels,
    };
  }, [e, source, sourceDocument]);
  if (isCadEntity(e)) {
    if (cadGeometry) {
      shape = (
        <>
          {cadGeometry.path &&
            trace(<path d={cadGeometry.path} vectorEffect="non-scaling-stroke" />)}
          {cadGeometry.labels.map((l, i) => (
            <text
              key={i}
              transform={`translate(${l.at.x} ${l.at.y}) rotate(${l.angle}) scale(1 -1)`}
              fontSize={l.size}
              textAnchor={l.anchor}
              textDecoration={selected ? 'underline' : undefined}
              fill={style.stroke}
              stroke="none"
            >
              {l.text}
            </text>
          ))}
        </>
      );
    }
  } else if (e.kind === 'point')
    shape = (
      <>
        <circle
          vectorEffect="non-scaling-stroke"
          cx={e.position.x}
          cy={e.position.y}
          r={3 / scale}
          style={{ r: 'var(--geo-point-radius)' }}
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
    // 有限图形由 SVG 裁切。无限辅助线才按可见范围计算端点，避免缩放重建所有边。
    const ends =
      e.kind === 'segment'
        ? [sheetPoints.get(e.startPoint)!, sheetPoints.get(e.endPoint)!]
        : box && clipLine({ a: e.anchor, d: e.direction, finite: false }, box);
    shape =
      ends &&
      trace(
        <line
          vectorEffect="non-scaling-stroke"
          x1={ends[0].x}
          y1={ends[0].y}
          x2={ends[1].x}
          y2={ends[1].y}
        />,
      );
  } else if (e.kind === 'curve')
    shape = trace(
      <path
        vectorEffect="non-scaling-stroke"
        d={curvePath(
          e.pointIds.map((id) => sheetPoints.get(id)!),
          e.parameterRange,
          e.interpolation,
        )}
      />,
    );
  else if (e.kind === 'polyline')
    shape = trace(
      <polyline
        vectorEffect="non-scaling-stroke"
        points={e.points.map((p) => `${p.x},${p.y}`).join(' ')}
      />,
    );
  else if (e.kind === 'plane')
    shape = (
      <>
        {trace(
          <polyline
            vectorEffect="non-scaling-stroke"
            points={planeOutline(doc, e)
              .map((p) => `${p.x},${p.y}`)
              .join(' ')}
          />,
        )}
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
    const c = sheetPoints.get(e.center)!;
    if (e.kind === 'circle')
      shape = trace(<circle vectorEffect="non-scaling-stroke" cx={c.x} cy={c.y} r={e.radius} />);
    else {
      shape = trace(
        <path
          vectorEffect="non-scaling-stroke"
          d={arcSvgPath(c, e.radius, e.startAngle, e.sweep)}
        />,
      );
    }
  }
  return (
    <g
      data-entity-id={e.id}
      data-selected={selected}
      data-kind={e.kind}
      data-style={e.lineStyle}
      data-construction-role={animationVisual?.visual.role}
      data-stroke-order={animationVisual?.visual.order}
      data-model-linked={animationVisual?.linked || undefined}
      {...style}
    >
      <title>{e.id}</title>
      {shape}
      {selected && !inspectOnly && (
        <g data-transient="handles" stroke="#0f766e" fill="#ffffff80">
          {(e.kind === 'point'
            ? [e.position]
            : e.kind === 'segment'
              ? [sheetPoints.get(e.startPoint)!, sheetPoints.get(e.endPoint)!]
              : e.kind === 'curve'
                ? e.pointIds.map((id) => sheetPoints.get(id)!)
                : e.kind === 'ellipse'
                  ? [
                      point(source, e.center),
                      ellipseAt(point(source, e.center), e, 0),
                      ellipseAt(point(source, e.center), e, 90),
                    ].map(at)
                  : isCadEntity(e) && 'position' in e
                    ? [at(e.position)]
                    : []
          ).map((p, i) => (
            <circle
              data-transient="handle"
              key={i}
              cx={p.x}
              cy={p.y}
              r={5 / scale}
              strokeWidth={1.2}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </g>
      )}
    </g>
  );
});
