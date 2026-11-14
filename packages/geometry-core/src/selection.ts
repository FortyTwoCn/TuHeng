import type { GeometryDocument, GeometryEntity, Vec2 } from '@tuheng/contracts';
import { entityPath, type Bounds } from './math';
import { entityInMarquee } from './marquee';
export function selectionBounds(a: Vec2, b: Vec2): Bounds {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}
export function intersectsBox(doc: GeometryDocument, e: GeometryEntity, box: Bounds) {
  return entityInMarquee(doc, e, box, 'crossing', 'local');
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
