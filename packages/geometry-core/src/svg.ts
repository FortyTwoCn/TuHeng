import type { GeometryDocument } from '@tuheng/contracts';
import { referenceGeometry, referenceKey, clipReference } from './references';
import { localToSheet, sheetBounds, viewTransform } from './sheet';
import { add, sub, angle, point, clipLine, lineGeometry, arcSvgPath, planeOutline } from './math';
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
export function exportSheetSvg(doc: GeometryDocument) {
  const box = sheetBounds(doc),
    parts: string[] = [];
  const line = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" vector-effect="non-scaling-stroke"/>`;
  const label = (x: number, y: number, text: string) =>
    `<text transform="translate(${x} ${y}) scale(1 -1)" font-size="3" fill="currentColor" stroke="none">${escape(text)}</text>`;
  for (const r of referenceGeometry(doc)) {
    const ends = clipReference(r, box);
    if (ends)
      parts.push(
        `<g data-reference-id="${escape(referenceKey(r.ref))}" ${r.ref.kind === 'projectionAxis' ? `data-axis-id="${escape(r.ref.systemId)}"` : ''} stroke="#64748b">${line(ends[0], ends[1])}${label(r.ref.kind==='baseAxis'?ends[1].x*.9:r.anchor.x+2,r.ref.kind==='baseAxis'?ends[1].y*.9:r.anchor.y+2,r.name)}</g>`,
      );
  }
  for (const e of doc.entities) {
    const at = (p: { x: number; y: number }) => localToSheet(doc, e.viewId, p),
      style = semanticLineStyles[e.lineStyle];
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
    if (e.kind === 'polyline' || e.kind === 'plane') {
      const points = e.kind === 'polyline' ? e.points : planeOutline(doc, e);
      shape = `<polyline points="${points
        .map((p) => {
          const q = at(p);
          return `${q.x},${q.y}`;
        })
        .join(' ')}" vector-effect="non-scaling-stroke"/>`;
    }
    if (e.kind === 'circle' || e.kind === 'arc') {
      const c = at(point(doc, e.center));
      if (e.kind === 'circle')
        shape = `<circle cx="${c.x}" cy="${c.y}" r="${e.radius}" vector-effect="non-scaling-stroke"/>`;
      else {
        const f = viewTransform(doc, e.viewId),
          r = (e.startAngle * Math.PI) / 180,
          v = sub(at({ x: Math.cos(r), y: Math.sin(r) }), f.origin);
        shape = `<path d="${arcSvgPath(c, e.radius, angle(v), e.sweep * (f.xAxis.x * f.yAxis.y - f.xAxis.y * f.yAxis.x))}" vector-effect="non-scaling-stroke"/>`;
      }
    }
    parts.push(
      `<g data-entity-id="${escape(e.id)}" stroke="${style.stroke}" stroke-width="1.6" ${'strokeDasharray' in style ? `stroke-dasharray="${style.strokeDasharray}"` : ''}>${shape}</g>`,
    );
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box.x} ${-box.y - box.height} ${box.width} ${box.height}" fill="none"><g transform="scale(1 -1)">${parts.join('')}</g></svg>`;
}
