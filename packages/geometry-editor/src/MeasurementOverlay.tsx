import type { GeometryDocument, Vec2 } from '@tuheng/contracts';
import {
  point,
  localToSheet,
  distance,
  sub,
  angle,
  formatCadAngle,
  type Bounds,
} from '@tuheng/geometry-core';
export function MeasurementOverlay({
  doc,
  ids,
  path,
  tool,
  box,
  scale,
}: {
  doc: GeometryDocument;
  ids: string[];
  path: Vec2[];
  tool: string;
  box: Bounds;
  scale: number;
}) {
  const direct =
    doc.entities.find((e) => ids.includes(e.id) && e.kind === 'segment') ??
    doc.entities.find(
      (e) => e.kind === 'segment' && ids.some((id) => [e.startPoint, e.endPoint].includes(id)),
    );
  const gripped = doc.entities.find(
    (e) =>
      ids.includes(e.id) &&
      (e.kind === 'circle' ||
        e.kind === 'arc' ||
        e.kind === 'ellipse' ||
        e.kind === 'text' ||
        e.kind === 'symbol' ||
        e.kind === 'dimension' ||
        e.kind === 'engineeringAnnotation'),
  );
  let a: Vec2 | undefined,
    b: Vec2 | undefined,
    text = '';
  if (direct?.kind === 'segment') {
    a = localToSheet(doc, direct.viewId, point(doc, direct.startPoint));
    b = localToSheet(doc, direct.viewId, point(doc, direct.endPoint));
  } else if (gripped) {
    if (gripped.kind === 'arc' || gripped.kind === 'circle' || gripped.kind === 'ellipse') {
      a = localToSheet(doc, gripped.viewId, point(doc, gripped.center));
      b = a;
      text =
        gripped.kind === 'ellipse'
          ? `半轴 ${gripped.majorRadius.toFixed(2)} / ${gripped.minorRadius.toFixed(2)} mm · ${formatCadAngle(gripped.angle, 1)}°`
          : `半径 ${gripped.radius.toFixed(2)} mm${gripped.kind === 'arc' ? ' · ' + formatCadAngle(gripped.sweep, 1) + '°' : ''}`;
    } else if ('position' in gripped) {
      a = localToSheet(doc, gripped.viewId, gripped.position);
      b = a;
      text = `u ${gripped.position.x.toFixed(2)} · v ${gripped.position.y.toFixed(2)} mm${'angle' in gripped ? ' · ' + formatCadAngle(gripped.angle, 1) + '°' : ''}`;
    }
  } else if (path.length >= 2) {
    a = path[0];
    b = tool === 'arc' ? path[1] : path.at(-1)!;
  }
  if (!a || !b) return null;
  if (!text)
    text =
      tool === 'circle' || tool === 'arc'
        ? `半径 ${distance(a, b).toFixed(2)} mm`
        : `长度 ${distance(a, b).toFixed(2)} mm · 图纸角度 ${formatCadAngle(angle(sub(b, a)), 1)}°`;
  const w = Math.min(294, box.width * scale - 12) / scale,
    h = 27 / scale;
  const x = Math.max(
    box.x + 6 / scale,
    Math.min(box.x + box.width - w - 6 / scale, (a.x + b.x) / 2 - w / 2),
  );
  const y = Math.max(
    box.y + h + 6 / scale,
    Math.min(box.y + box.height - 6 / scale, (a.y + b.y) / 2 - 18 / scale),
  );
  return (
    <g
      data-measurement-hud="true"
      data-transient="measurement"
      transform={`translate(${x} ${-y})`}
      pointerEvents="none"
    >
      <rect x={0} y={0} width={w} height={h} rx={4 / scale} fill="var(--cad-raised)" />
      <text x={7 / scale} y={18 / scale} fontSize={12 / scale} fill="var(--cad-text)">
        {text}
      </text>
    </g>
  );
}
