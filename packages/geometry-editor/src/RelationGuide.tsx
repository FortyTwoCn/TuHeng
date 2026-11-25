import type { GeometryDocument, Vec2 } from '@tuheng/contracts';
import {
  add,
  angle,
  clipLine,
  lineGeometry,
  localToSheet,
  point,
  sub,
  unit,
  type Bounds,
  type SnapCandidate,
} from '@tuheng/geometry-core';

/** Draw the source and construction marks in paper coordinates. Marks stay the same size as the camera zooms. */
export function RelationGuide({
  doc,
  viewId,
  candidate,
  end,
  box,
  pixels,
}: {
  doc: GeometryDocument;
  viewId: string;
  candidate: SnapCandidate;
  end: Vec2;
  box: Bounds;
  pixels: number;
}) {
  const guide = candidate.guide;
  if (!guide) return null;
  const source = doc.entities.find((entity) => entity.id === guide.sourceId);
  if (!source) return null;
  const sheet = (p: Vec2) => localToSheet(doc, viewId, p);
  const finish = sheet(end),
    contact = sheet(guide.contact);
  const direction = unit(sub(sheet(add(guide.contact, guide.direction)), contact));
  const rotation = -angle(direction);
  const title = { parallel: '平行', perpendicular: '垂直', tangent: '相切' }[guide.kind];
  let sourceSpan: [Vec2, Vec2] | null = null;
  if (source.kind === 'line' || source.kind === 'segment') {
    const geometry = lineGeometry(doc, source);
    const a = localToSheet(doc, source.viewId, geometry.a);
    const b = localToSheet(doc, source.viewId, add(geometry.a, geometry.d));
    sourceSpan = clipLine({ a, d: sub(b, a), finite: geometry.finite }, box);
  }
  const center =
    source.kind === 'circle' || source.kind === 'arc'
      ? localToSheet(doc, source.viewId, point(doc, source.center))
      : undefined;
  const sx = (p: Vec2) => [p.x, -p.y].join(',');
  const marker = (p: Vec2) => `translate(${p.x} ${-p.y}) scale(${1 / pixels}) rotate(${rotation})`;
  const labelX = Math.min(
    box.x + box.width - 44 / pixels,
    Math.max(box.x + 2 / pixels, finish.x + 12 / pixels),
  );
  const labelY = Math.max(
    -box.y - box.height + 16 / pixels,
    Math.min(-box.y - 5 / pixels, -finish.y + 23 / pixels),
  );
  return (
    <g
      data-transient="relation-guide"
      data-relation-guide={guide.kind}
      data-source-id={source.id}
      pointerEvents="none"
      aria-label={title + '作图预览'}
      stroke="var(--cad-relation)"
      fill="none"
    >
      <title>
        {title} · {source.kind === 'circle' ? '圆' : source.kind === 'arc' ? '圆弧' : '参考图形'}
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
      {guide.kind === 'parallel' &&
        [contact, finish].map((p, index) => (
          <path key={index} transform={marker(p)} d="M-6 4 l5 -8 M0 4 l5 -8" strokeWidth="1.8" />
        ))}
      {guide.kind === 'perpendicular' && (
        <g transform={marker(candidate.kind === 'FOOT' ? contact : finish)}>
          <path d="M-10 0 H0 V-10 M-6 0 V-6 H0" strokeWidth="1.6" />
        </g>
      )}
      {guide.kind === 'tangent' && (
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
          x="-2"
          y="-13"
          width="34"
          height="18"
          rx="3"
          fill="var(--cad-paper)"
          strokeWidth="1"
        />
        <text
          x="15"
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
