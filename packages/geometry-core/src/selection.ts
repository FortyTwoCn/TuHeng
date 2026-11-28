import { cadDrawing, textCorners } from './cad-geometry';
import { isCadEntity } from '@tuheng/contracts';
import { boundaryShape, nearestOnShape } from './parametric-geometry';
import type { GeometryDocument, GeometryEntity, Vec2 } from '@tuheng/contracts';
import {
  entityPath,
  type Bounds,
  sub,
  unit,
  dot,
  distance,
  foot,
  point,
  angle,
  arcPoint,
} from './math';
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
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const e of doc.entities) {
    if (e.viewId !== viewId) continue;
    const positions =
      e.kind === 'line'
        ? [e.anchor]
        : entityPath(doc, e, { x: -10000, y: -10000, width: 20000, height: 20000 });
    for (const p of positions) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
  }
  if (!Number.isFinite(minX)) return { x: -20, y: -30, width: 120, height: 90 };
  const width = Math.max(40, maxX - minX + 20, ((maxY - minY + 20) * 4) / 3),
    height = (width * 3) / 4;
  return { x: (minX + maxX - width) / 2, y: (minY + maxY - height) / 2, width, height };
}

// 导入的多段线和投影轮廓可以含重复顶点，拾取时把零长边视作点。
function distanceToPath(p: Vec2, path: Vec2[]) {
  let nearest = path.length ? distance(p, path[0]) : Infinity;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const d = sub(path[i], a);
    const closest = dot(d, d) > 1e-16 ? foot(p, { a, d, finite: true }) : a;
    nearest = Math.min(nearest, distance(p, closest));
  }
  return nearest;
}

export function hitDistance(doc: GeometryDocument, e: GeometryEntity, p: Vec2, box: Bounds) {
  if (e.kind === 'ellipse' || e.kind === 'curve') {
    const shape = boundaryShape(doc, e);
    return shape ? distance(nearestOnShape(shape, p).position, p) : Infinity;
  }
  if (isCadEntity(e)) {
    const drawing = cadDrawing(doc, e);
    let nearest = Infinity;
    for (const label of drawing.labels) {
      const [a, b, , d] = textCorners(label);
      const v = sub(p, a),
        x = unit(sub(b, a)),
        y = unit(sub(d, a));
      const dx = Math.max(0, -dot(v, x), dot(v, x) - distance(a, b));
      const dy = Math.max(0, -dot(v, y), dot(v, y) - distance(a, d));
      nearest = Math.min(nearest, Math.hypot(dx, dy));
    }
    for (const path of drawing.strokes) nearest = Math.min(nearest, distanceToPath(p, path));
    return nearest;
  }
  if (e.kind === 'point') return distance(e.position, p);
  if (e.kind === 'circle') return Math.abs(distance(point(doc, e.center), p) - e.radius);
  if (e.kind === 'arc') {
    const c = point(doc, e.center),
      delta = (angle(sub(p, c)) - e.startAngle + 720) % 360;
    if ((e.sweep > 0 && delta <= e.sweep) || (e.sweep < 0 && (360 - delta) % 360 <= -e.sweep))
      return Math.abs(distance(c, p) - e.radius);
    return Math.min(
      distance(p, arcPoint(c, e.radius, e.startAngle)),
      distance(p, arcPoint(c, e.radius, e.startAngle + e.sweep)),
    );
  }
  return distanceToPath(p, entityPath(doc, e, box));
}
