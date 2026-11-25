import type { GeometryDocument, Vec2 } from '@tuheng/contracts';
import { localToSheet, viewTransform, add, sub, angle, planeOutline } from '@tuheng/geometry-core';
// 只为渲染转换到图纸坐标。正式文档保留局部坐标和所属视图 ID。
export function sheetDrawingDocument(doc: GeometryDocument): GeometryDocument {
  return {
    ...doc,
    entities: doc.entities.map((e) => {
      const at = (p: Vec2) => localToSheet(doc, e.viewId, p),
        f = viewTransform(doc, e.viewId);
      if (e.kind === 'point') return { ...e, position: at(e.position) };
      if (e.kind === 'line')
        return {
          ...e,
          anchor: at(e.anchor),
          direction: sub(at(add(e.anchor, e.direction)), at(e.anchor)),
        };
      if (e.kind === 'polyline') return { ...e, points: e.points.map(at) };
      if (e.kind === 'plane')
        return {
          ...e,
          kind: 'polyline' as const,
          points: planeOutline(doc, e).map(at),
          fitStatus: 'UNFITTED' as const,
        };
      if (e.kind === 'arc') {
        const a = (e.startAngle * Math.PI) / 180,
          d = sub(at({ x: Math.cos(a), y: Math.sin(a) }), f.origin);
        return {
          ...e,
          startAngle: angle(d),
          sweep: e.sweep * (f.xAxis.x * f.yAxis.y - f.xAxis.y * f.yAxis.x),
        };
      }
      return e;
    }),
  };
}
