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
/** Resolve a NEW operation's frame. Existing objects and in-progress operations retain their frame. */
export function drawingViewAt(
  doc: GeometryDocument,
  position: Vec2,
  approachedViewId?: string,
  targetEntityId?: string,
): string {
  const target = targetEntityId && doc.entities.find((e) => e.id === targetEntityId);
  if (target) return target.viewId;
  if (!orthographic(doc)) return doc.views[0].id;
  const systems = doc.auxiliarySystems ?? [];
  const ancestors = new Set<string>();
  let ancestor = approachedViewId;
  while (ancestor && !ancestors.has(ancestor)) {
    ancestors.add(ancestor);
    ancestor = systems.find((a) => a.newViewId === ancestor)?.retainedViewId;
  }
  // Each base face is the positive spatial quadrant in its own transformed frame.
  // This also handles imported IDs, signs, offsets and rotations without guessing from names.
  const candidates = doc.views
    .filter((v) => !systems.some((a) => a.newViewId === v.id))
    .map((v) => {
      const p = sheetToLocal(doc, v.id, position);
      return {
        id: v.id,
        distance: Math.hypot(Math.min(0, p.x * v.signs[0]), Math.min(0, p.y * v.signs[1])),
        order: ['x,z', 'x,y', 'y,z'].indexOf(v.mapping.join(',')),
      };
    });
  const epsilon = 1e-7;
  candidates.sort((a, b) =>
    Math.abs(a.distance - b.distance) > epsilon
      ? a.distance - b.distance
      : Number(ancestors.has(b.id)) - Number(ancestors.has(a.id)) ||
        a.order - b.order ||
        a.id.localeCompare(b.id),
  );
  let viewId = candidates[0]?.id ?? doc.views[0].id;
  const visited = new Set<string>();
  while (!visited.has(viewId)) {
    visited.add(viewId);
    // An auxiliary face subdivides the retained region on its chosen unfold side.
    // Sibling overlaps use the nearest axis; nested faces are resolved recursively.
    const children = systems
      .filter((a) => a.retainedViewId === viewId && !visited.has(a.newViewId))
      .map((a) => ({ id: a.newViewId, distance: dot(sub(position, a.anchor), a.positiveNormal) }))
      .filter((a) => a.distance > epsilon || (a.distance >= -epsilon && ancestors.has(a.id)))
      .sort((a, b) =>
        Math.abs(a.distance - b.distance) > epsilon
          ? a.distance - b.distance
          : Number(ancestors.has(b.id)) - Number(ancestors.has(a.id)) || a.id.localeCompare(b.id),
      );
    if (!children.length) break;
    viewId = children[0].id;
  }
  return viewId;
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
