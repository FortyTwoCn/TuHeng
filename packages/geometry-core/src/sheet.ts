import { GeometryDocument, type Vec2 } from '@tuheng/contracts';
import { add, sub, scale, dot, entityPath, type Bounds } from './math';

export const orthographic = (doc: GeometryDocument) =>
  ['VHW_PROJECTION', 'THREE_VIEW'].includes(doc.editorType);
export function defaultTransform(doc: GeometryDocument, view: GeometryDocument['views'][number]) {
  return {
    origin: { x: 0, y: 0 },
    xAxis: { x: orthographic(doc) && view.mapping[0] === 'x' ? -view.signs[0] : 1, y: 0 },
    yAxis: { x: 0, y: orthographic(doc) ? (view.mapping[1] === 'y' ? -1 : 1) * view.signs[1] : 1 },
  };
}
// Migration is for a NEW editable draft. Parsing/serializing a historical snapshot never migrates it.
export function upgradeGeometryDocument(input: unknown): GeometryDocument {
  const doc = GeometryDocument.parse(input);
  if (doc.schemaVersion !== 'tuheng.geometry/1.0.0') return doc;
  return GeometryDocument.parse({
    ...doc,
    schemaVersion: 'tuheng.geometry/2.0.0',
    coordinateSystem: 'VIEW_LOCAL_WITH_SHEET_TRANSFORM',
    sheet: { origin: { x: 0, y: 0 }, allowAuxiliaryViews: true },
    auxiliarySystems: [],
    views: doc.views.map((v) => ({ ...v, transform: defaultTransform(doc, v) })),
    entities: doc.entities.map((e) => (e.kind === 'plane' ? { ...e, legacyReadOnly: true } : e)),
  });
}
export function viewTransform(doc: GeometryDocument, viewId: string) {
  const view = doc.views.find((v) => v.id === viewId);
  if (!view) throw new Error('投影框架不存在');
  return view.transform ?? defaultTransform(doc, view);
}
export function localToSheet(doc: GeometryDocument, viewId: string, p: Vec2): Vec2 {
  const f = viewTransform(doc, viewId);
  return add(f.origin, add(scale(f.xAxis, p.x), scale(f.yAxis, p.y)));
}
export function sheetToLocal(doc: GeometryDocument, viewId: string, p: Vec2): Vec2 {
  const f = viewTransform(doc, viewId),
    d = sub(p, f.origin);
  return { x: dot(d, f.xAxis), y: dot(d, f.yAxis) };
}
export function sheetDeltaToLocal(doc: GeometryDocument, viewId: string, d: Vec2): Vec2 {
  const f = viewTransform(doc, viewId);
  return { x: dot(d, f.xAxis), y: dot(d, f.yAxis) };
}
export function sheetBounds(doc: GeometryDocument): Bounds {
  const points = doc.entities
    .filter((e) => e.kind !== 'line')
    .flatMap((e) =>
      entityPath(doc, e, { x: -10000, y: -10000, width: 20000, height: 20000 }).map((p) =>
        localToSheet(doc, e.viewId, p),
      ),
    );
  points.push(
    { x: -60, y: -40 },
    { x: 40, y: 60 },
    ...(doc.auxiliarySystems ?? []).map((a) => a.anchor),
  );
  const xs = points.map((p) => p.x),
    ys = points.map((p) => p.y),
    minX = Math.min(...xs) - 10,
    maxX = Math.max(...xs) + 10,
    minY = Math.min(...ys) - 10,
    maxY = Math.max(...ys) + 10;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
export function localBounds(doc: GeometryDocument, viewId: string, box: Bounds): Bounds {
  const p = [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x, y: box.y + box.height },
    { x: box.x + box.width, y: box.y + box.height },
  ].map((p) => sheetToLocal(doc, viewId, p));
  const x = Math.min(...p.map((p) => p.x)),
    y = Math.min(...p.map((p) => p.y));
  return {
    x,
    y,
    width: Math.max(...p.map((p) => p.x)) - x,
    height: Math.max(...p.map((p) => p.y)) - y,
  };
}
