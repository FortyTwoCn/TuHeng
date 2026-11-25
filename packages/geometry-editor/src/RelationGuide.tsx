import type { GeometryDocument, Vec2 } from '@tuheng/contracts';
import {
  add,
  angle,
  clipLine,
  distance,
  lineGeometry,
  localToSheet,
  point,
  scale,
  sub,
  unit,
  type Bounds,
  type SnapCandidate,
} from '@tuheng/geometry-core';

/** 辅助标记使用图纸坐标定位，笔宽和图标大小固定为屏幕像素。 */
export function RelationGuide({
  doc,
  viewId,
  candidate,
  start,
  end,
  box,
  pixels,
}: {
  doc: GeometryDocument;
  viewId: string;
  candidate: SnapCandidate;
  start: Vec2;
  end: Vec2;
  box: Bounds;
  pixels: number;
}) {
  const guide = candidate.guide;
  const equal = candidate.equalLength;
  if (!guide && !equal) return null;
  const source = guide && doc.entities.find((entity) => entity.id === guide.sourceId);
  const sheet = (p: Vec2) => localToSheet(doc, viewId, p);
  const begin = sheet(start),
    finish = sheet(end);
  const contact = guide ? sheet(guide.contact) : begin;
  const direction = guide
    ? unit(sub(sheet(add(guide.contact, guide.direction)), contact))
    : unit(sub(finish, begin));
  const rotation = -angle(direction);
  const title = [
    guide && { parallel: '平行', perpendicular: '垂直', tangent: '相切' }[guide.kind],
    equal && '等长',
  ]
    .filter(Boolean)
    .join(' · ');
  let sourceSpan: [Vec2, Vec2] | null = null;
  if (source?.kind === 'line' || source?.kind === 'segment') {
    const geometry = lineGeometry(doc, source);
    const a = localToSheet(doc, source.viewId, geometry.a);
    const b = localToSheet(doc, source.viewId, add(geometry.a, geometry.d));
    sourceSpan = clipLine({ a, d: sub(b, a), finite: geometry.finite }, box);
  }
  const center =
    source?.kind === 'circle' || source?.kind === 'arc'
      ? localToSheet(doc, source.viewId, point(doc, source.center))
      : undefined;
  const sx = (p: Vec2) => [p.x, -p.y].join(',');
  const marker = (p: Vec2) => `translate(${p.x} ${-p.y}) scale(${1 / pixels}) rotate(${rotation})`;
  const perpendicularMark = () => {
    const arm = (a: Vec2, b: Vec2) =>
      scale(unit(sub(distance(contact, a) > distance(contact, b) ? a : b, contact)), 9 / pixels);
    const draftArm = arm(begin, finish);
    const sourceArm = sourceSpan ? arm(...sourceSpan) : scale(direction, 9 / pixels);
    return [draftArm, add(draftArm, sourceArm), sourceArm].map((p) => add(contact, p));
  };
  const equalSource = equal && doc.entities.find((entity) => entity.id === equal.sourceId);
  const tick = (a: Vec2, b: Vec2) => {
    const middle = scale(add(a, b), 0.5);
    const d = unit(sub(b, a)),
      wing = scale({ x: -d.y, y: d.x }, 5 / pixels);
    return [sub(middle, wing), add(middle, wing)].map(sx).join(' ');
  };
  const badgeWidth = 12 * title.length + 10;
  const labelX = Math.min(
    box.x + box.width - (badgeWidth + 4) / pixels,
    Math.max(box.x + 2 / pixels, finish.x + 12 / pixels),
  );
  const labelY = Math.max(
    -box.y - box.height + 16 / pixels,
    Math.min(-box.y - 5 / pixels, -finish.y + 23 / pixels),
  );
  return (
    <g
      data-transient="relation-guide"
      data-relation-guide={guide?.kind}
      data-source-id={source?.id}
      data-equal-length-source-id={equal?.sourceId}
      pointerEvents="none"
      aria-label={title + '作图预览'}
      stroke="var(--cad-relation)"
      fill="none"
    >
      <title>
        {title} · {source?.kind === 'circle' ? '圆' : source?.kind === 'arc' ? '圆弧' : '参考图形'}
      </title>
      {sourceSpan && (
        <polyline
          points={sourceSpan.map(sx).join(' ')}
          vectorEffect="non-scaling-stroke"
          strokeWidth="2"
          strokeDasharray="5 3"
          opacity=".85"
        />
      )}
      {guide?.kind === 'parallel' &&
        [contact, finish].map((p, index) => (
          <path key={index} transform={marker(p)} d="M-6 4 l5 -8 M0 4 l5 -8" strokeWidth="1.8" />
        ))}
      {guide?.kind === 'perpendicular' && (
        <polyline
          data-perpendicular-vertex={sx(contact)}
          points={perpendicularMark().map(sx).join(' ')}
          strokeWidth="1.6"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {equalSource?.kind === 'segment' && (
        <>
          <polyline
            points={tick(
              localToSheet(doc, equalSource.viewId, point(doc, equalSource.startPoint)),
              localToSheet(doc, equalSource.viewId, point(doc, equalSource.endPoint)),
            )}
            vectorEffect="non-scaling-stroke"
            strokeWidth="1.6"
          />
          <polyline
            points={tick(begin, finish)}
            vectorEffect="non-scaling-stroke"
            strokeWidth="1.6"
          />
        </>
      )}
      {guide?.kind === 'tangent' && (
        <>
          {center && (
            <polyline
              points={[center, contact].map(sx).join(' ')}
              vectorEffect="non-scaling-stroke"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
          )}
          <g transform={marker(contact)}>
            <path d="M-16 0 H16" strokeWidth="1.5" />
            <circle r="4" fill="var(--cad-paper)" strokeWidth="1.8" />
          </g>
        </>
      )}
      <g transform={`translate(${labelX} ${labelY}) scale(${1 / pixels})`}>
        <rect
          x="0"
          y="-13"
          width={badgeWidth}
          height="18"
          rx="3"
          fill="var(--cad-paper)"
          strokeWidth="1"
        />
        <text
          x={badgeWidth / 2}
          y="0"
          textAnchor="middle"
          fontSize="12"
          fill="var(--cad-relation)"
          stroke="none"
        >
          {title}
        </text>
      </g>
    </g>
  );
}
