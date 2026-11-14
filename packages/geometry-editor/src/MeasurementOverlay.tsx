import type { GeometryDocument, Vec2 } from '@tuheng/contracts';
import { point, localToSheet, distance, sub, angle, type Bounds } from '@tuheng/geometry-core';
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
  let a: Vec2 | undefined,
    b: Vec2 | undefined,
    text = '';
  if (direct?.kind === 'segment') {
    a = localToSheet(doc, direct.viewId, point(doc, direct.startPoint));
    b = localToSheet(doc, direct.viewId, point(doc, direct.endPoint));
  } else if (path.length >= 2) {
    a = path[0];
    b = tool === 'arc' ? path[1] : path.at(-1)!;
  }
  if (!a || !b) return null;
  if (tool === 'circle' || tool === 'arc') text = `半径 ${distance(a, b).toFixed(2)} mm`;
  else text = `长度 ${distance(a, b).toFixed(2)} mm · 图纸角度 ${angle(sub(b, a)).toFixed(1)}°`;
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
      <rect x={0} y={0} width={w} height={h} rx={4 / scale} fill="#f8fafcf2" />
      <text x={7 / scale} y={18 / scale} fontSize={12 / scale} fill="#525d6b">
        {text}
      </text>
    </g>
  );
}
