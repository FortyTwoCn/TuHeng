import type { GeometryDocument, GeometryEntity, Vec2 } from '@tuheng/contracts';
import {
  arcPoint,
  clipLine,
  distance,
  entityPath,
  hitDistance,
  lineGeometry,
  point,
  type Bounds,
} from './math';
export function selectionBounds(a: Vec2, b: Vec2): Bounds {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}
export function intersectsBox(doc: GeometryDocument, e: GeometryEntity, box: Bounds) {
  const inside = (p: Vec2) =>
    p.x >= box.x && p.x <= box.x + box.width && p.y >= box.y && p.y <= box.y + box.height;
  if (e.kind === 'segment' || e.kind === 'line')
    return clipLine(lineGeometry(doc, e), box) !== null;
  if (e.kind === 'circle' || e.kind === 'arc') {
    const c = point(doc, e.center),
      nearest = {
        x: Math.max(box.x, Math.min(box.x + box.width, c.x)),
        y: Math.max(box.y, Math.min(box.y + box.height, c.y)),
      };
    if (distance(c, nearest) > e.radius) return false;
    const corners = [
      { x: box.x, y: box.y },
      { x: box.x + box.width, y: box.y },
      { x: box.x + box.width, y: box.y + box.height },
      { x: box.x, y: box.y + box.height },
    ];
    if (corners.every((p) => distance(c, p) < e.radius)) return false;
    if (e.kind === 'circle') return true;
    if (
      inside(arcPoint(c, e.radius, e.startAngle)) ||
      inside(arcPoint(c, e.radius, e.startAngle + e.sweep))
    )
      return true;
    const candidates: Vec2[] = [];
    for (const x of [box.x, box.x + box.width]) {
      const value = e.radius ** 2 - (x - c.x) ** 2;
      if (value >= 0)
        for (const sign of [-1, 1]) candidates.push({ x, y: c.y + sign * Math.sqrt(value) });
    }
    for (const y of [box.y, box.y + box.height]) {
      const value = e.radius ** 2 - (y - c.y) ** 2;
      if (value >= 0)
        for (const sign of [-1, 1]) candidates.push({ x: c.x + sign * Math.sqrt(value), y });
    }
    return candidates.some((p) => inside(p) && hitDistance(doc, e, p, box) < 1e-7);
  }
  const path = entityPath(doc, e, box);
  return (
    path.some(inside) ||
    path.some(
      (p, i) =>
        i > 0 &&
        clipLine(
          { a: path[i - 1], d: { x: p.x - path[i - 1].x, y: p.y - path[i - 1].y }, finite: true },
          box,
        ) !== null,
    )
  );
}
export function contentBounds(doc: GeometryDocument, viewId: string): Bounds {
  const points = doc.entities
    .filter((e) => e.viewId === viewId && e.kind !== 'line')
    .flatMap((e) => entityPath(doc, e, { x: -10000, y: -10000, width: 20000, height: 20000 }));
  if (!points.length) return { x: -20, y: -30, width: 120, height: 90 };
  const minX = Math.min(...points.map((p) => p.x)),
    maxX = Math.max(...points.map((p) => p.x)),
    minY = Math.min(...points.map((p) => p.y)),
    maxY = Math.max(...points.map((p) => p.y));
  const width = Math.max(40, maxX - minX + 20, ((maxY - minY + 20) * 4) / 3),
    height = (width * 3) / 4;
  return { x: (minX + maxX - width) / 2, y: (minY + maxY - height) / 2, width, height };
}
