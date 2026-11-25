import { curvePath, visibleCurveSegments } from './curves';
import { isCadEntity, type GeometryDocument, type GeometryEntity, type Vec2 } from '@tuheng/contracts';
import { cadDrawing, ellipsePath, mapCadDrawing } from './cad-geometry';
import { referenceGeometry, referenceKey, clipReference } from './references';
import { localToSheet, sheetBounds, viewTransform } from './sheet';
import { add, sub, angle, point, clipLine, lineGeometry, arcSvgPath, planeOutline, distance, type Bounds } from './math';
export const semanticLineStyles = {
  CONSTRUCTION: { stroke: '#9ca3af', strokeDasharray: '5 5' },
  ANSWER_VISIBLE: { stroke: '#17212f' },
  ANSWER_HIDDEN: { stroke: '#17212f', strokeDasharray: '7 4' },
  PROBLEM_VISIBLE: { stroke: '#2563eb' },
  PROBLEM_HIDDEN: { stroke: '#2563eb', strokeDasharray: '7 4' },
};
const escape = (s: string) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
function fitDashes(pattern: string, lengthPx: number) {
  if (!Number.isFinite(lengthPx) || lengthPx < 1e-4) return pattern;
  const entries = pattern.split(' ').map(Number);
  const period=entries.reduce((sum,n)=>sum+n,0), first=entries[0];
  if (lengthPx<=period+first) return entries.map(n=>n*lengthPx/(period+first)).join(' ');
  const count=Math.round((lengthPx-first)/period);
  entries[0]=(lengthPx-count*(period-first))/(count+1);
  return entries.join(' ');
}
function pathLength(points:Vec2[]) {
  return points.slice(1).reduce((total,p,i)=>total+distance(p,points[i]),0);
}
export function drawingRunLength(doc:GeometryDocument,e:GeometryEntity) {
  if (e.kind==='segment') return distance(point(doc,e.startPoint),point(doc,e.endPoint));
  if (e.kind==='circle' || e.kind==='arc') return (e.kind==='circle'?360:Math.abs(e.sweep))*Math.PI/180*e.radius;
  if (e.kind==='ellipse') {
    const a=e.majorRadius, b=e.minorRadius;
    return Math.abs(e.sweep)/360*Math.PI*(3*(a+b)-Math.sqrt((3*a+b)*(a+3*b)));
  }
  if (e.kind==='curve')
    return visibleCurveSegments(e.pointIds.map(id=>point(doc,id)),e.parameterRange,e.interpolation)
      .reduce((total,s)=>total+(distance(s.start,s.end)+pathLength([s.start,s.c1,s.c2,s.end]))/2,0);
}
export function drawingStyle(e: GeometryEntity, pixelsPerMm: number, lengthMm?:number) {
  const base = semanticLineStyles[e.lineStyle];
  const patterns = { SOLID: undefined, DASHED: '7 4', CENTER: '12 3 2 3', PHANTOM: '12 3 2 3 2 3', GUIDE: '3 3' };
  const dash=e.appearance?.pattern ? patterns[e.appearance.pattern] : 'strokeDasharray' in base ? base.strokeDasharray : undefined;
  return {
    stroke: e.appearance?.color ?? base.stroke,
    strokeDasharray: dash && lengthMm!==undefined ? fitDashes(dash,lengthMm*pixelsPerMm) : dash,
    strokeWidth: e.appearance?.widthMm ? e.appearance.widthMm * pixelsPerMm : 1.6,
  };
}
export function exportSheetSvg(doc: GeometryDocument, box: Bounds = sheetBounds(doc)) {
  const parts: string[] = [];
  const line = (a: { x: number; y: number }, b: { x: number; y: number }, axis = false) =>
    `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" ${axis ? 'vector-effect="non-scaling-stroke"' : ''}/>`;
  const label = (x: number, y: number, text: string) =>
    `<text transform="translate(${x} ${y}) scale(1 -1)" font-size="3" fill="currentColor" stroke="none">${escape(text)}</text>`;
  for (const r of referenceGeometry(doc)) {
    const ends = clipReference(r, box);
    if (ends)
      parts.push(
        `<g data-reference-id="${escape(referenceKey(r.ref))}" ${r.ref.kind === 'projectionAxis' ? `data-axis-id="${escape(r.ref.systemId)}"` : ''} stroke="#64748b"${r.ref.kind === 'baseAxis' && r.ref.axisId === 'MITER_45' ? ' stroke-dasharray="4 5" opacity="0.55"' : ''}>${line(ends[0], ends[1], true)}${label(r.ref.kind === 'baseAxis' ? ends[1].x * 0.9 : r.anchor.x + 2, r.ref.kind === 'baseAxis' ? ends[1].y * 0.9 : r.anchor.y + 2, r.name)}</g>`,
      );
  }
  for (const e of doc.entities) {
    const at = (p: { x: number; y: number }) => localToSheet(doc, e.viewId, p),
      dash = drawingStyle(e, 96 / 25.4),
      style = dash.strokeDasharray ? drawingStyle(e,96/25.4,drawingRunLength(doc,e)) : dash;
    let shape = '';
    if (e.kind === 'point') {
      const p = at(e.position);
      shape = `<circle cx="${p.x}" cy="${p.y}" r="0.65" fill="${style.stroke}"/>`;
      if (doc.settings.labels && e.labelVisible) shape += label(p.x + 1, p.y + 1, e.name);
    }
    if (e.kind === 'line' || e.kind === 'segment') {
      const l = lineGeometry(doc, e),
        a = at(l.a),
        b = at(add(l.a, l.d)),
        ends = clipLine({ a, d: sub(b, a), finite: l.finite }, box);
      if (ends) shape = line(ends[0], ends[1]);
    }
    if (e.kind === 'curve')
      shape = `<path d="${curvePath(
        e.pointIds.map((id) => at(point(doc, id))),
        e.parameterRange,
        e.interpolation,
      )}"/>`;
    if (isCadEntity(e)) {
      if (e.kind === 'ellipse') shape = `<path d="${ellipsePath(doc, e, at)}"/>`;
      else {
        const drawn = mapCadDrawing(cadDrawing(doc, e), at);
        shape =
          drawn.strokes
            .map((path) => `<polyline points="${path.map((p) => p.x + ',' + p.y).join(' ')}"/>`)
            .join('') +
          drawn.labels
            .map(
              (l) =>
                `<text transform="translate(${l.at.x} ${l.at.y}) rotate(${l.angle}) scale(1 -1)" text-anchor="${l.anchor ?? 'start'}" font-size="${l.size}" fill="${style.stroke}" stroke="none">${escape(l.text)}</text>`,
            )
            .join('');
      }
    }
    if (e.kind === 'polyline' || e.kind === 'plane') {
      const points = e.kind === 'polyline' ? e.points : planeOutline(doc, e);
      shape = `<polyline points="${points
        .map((p) => {
          const q = at(p);
          return `${q.x},${q.y}`;
        })
        .join(' ')}"/>`;
    }
    if (e.kind === 'circle' || e.kind === 'arc') {
      const c = at(point(doc, e.center));
      if (e.kind === 'circle') shape = `<circle cx="${c.x}" cy="${c.y}" r="${e.radius}"/>`;
      else {
        const f = viewTransform(doc, e.viewId),
          r = (e.startAngle * Math.PI) / 180,
          v = sub(at({ x: Math.cos(r), y: Math.sin(r) }), f.origin);
        shape = `<path d="${arcSvgPath(c, e.radius, angle(v), e.sweep * (f.xAxis.x * f.yAxis.y - f.xAxis.y * f.yAxis.x))}"/>`;
      }
    }
    parts.push(
      `<g data-entity-id="${escape(e.id)}" stroke="${style.stroke}" stroke-width="${e.appearance?.widthMm ?? (1.6 * 25.4) / 96}" ${
        style.strokeDasharray
          ? `stroke-dasharray="${style.strokeDasharray
              .split(' ')
              .map((v) => (Number(v) * 25.4) / 96)
              .join(' ')}"`
          : ''
      }>${shape}</g>`,
    );
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box.x} ${-box.y - box.height} ${box.width} ${box.height}" fill="none"><g transform="scale(1 -1)">${parts.join('')}</g></svg>`;
}
