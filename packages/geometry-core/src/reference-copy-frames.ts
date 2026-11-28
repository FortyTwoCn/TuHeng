import {
  hasGeometryBaseAxis,
  type GeometryDocument,
  type ReferenceRelation,
  type Vec2,
} from '@tuheng/contracts';
import { add, cross, distance, sub, unit, type Bounds } from './math';
import { resolveReference } from './references';
import { drawingViewAt, localToSheet, orthographic, viewTransform } from './sheet';
import { viewAxes } from './projections';

type View = GeometryDocument['views'][number];
type Reference = ReferenceRelation['reference'];
const near = (a: Vec2, b: Vec2) => distance(a, b) < 1e-7;

export function compatibleView(source: GeometryDocument, target: GeometryDocument, view: View) {
  if (orthographic(source) !== orthographic(target)) return undefined;
  const a = viewTransform(source, view.id);
  const matches = target.views.filter((candidate) => {
    if (
      candidate.name !== view.name ||
      candidate.mapping.some(
        (axis, i) => axis !== view.mapping[i] || candidate.signs[i] !== view.signs[i],
      )
    )
      return false;
    const b = viewTransform(target, candidate.id);
    return near(a.xAxis, b.xAxis) && near(a.yAxis, b.yAxis);
  });
  return matches.find((candidate) => candidate.id === view.id) ?? matches[0];
}

export function sameSpatialProjection(
  source: GeometryDocument,
  target: GeometryDocument,
  from: string,
  to: string,
) {
  const a = viewAxes(source, from);
  const b = viewAxes(target, to);
  return (
    Object.keys(a).length === Object.keys(b).length &&
    Object.entries(a).every(([key, axis]) => b[key] && near(axis, b[key]))
  );
}

// 以当前可见区中的落点居中选集，保留原图的毫米比例。
export function copyPlacement(
  target: GeometryDocument,
  view: View,
  bounds: Bounds,
  visible?: Bounds,
) {
  const fallback = localToSheet(
    target,
    view.id,
    orthographic(target) ? { x: 24 * view.signs[0], y: 24 * view.signs[1] } : { x: 0, y: 8 },
  );
  const center = (box: Bounds) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  let anchor = fallback;
  if (visible) {
    const middle = center(visible);
    anchor =
      orthographic(target) && drawingViewAt(target, middle, view.id) !== view.id
        ? {
            x: Math.max(
              visible.x + visible.width * 0.18,
              Math.min(visible.x + visible.width * 0.82, fallback.x),
            ),
            y: Math.max(
              visible.y + visible.height * 0.18,
              Math.min(visible.y + visible.height * 0.82, fallback.y),
            ),
          }
        : middle;
    if (orthographic(target) && drawingViewAt(target, anchor, view.id) !== view.id)
      anchor = fallback;
  }
  return sub(anchor, center(bounds));
}

// 固定参考只有在目标图纸中存在等价几何时才继续绑定。
export function copyFixedReference(
  source: GeometryDocument,
  target: GeometryDocument,
  relation: ReferenceRelation,
  frames: ReadonlyMap<string, View | undefined>,
  mapSheet: (p: Vec2) => Vec2,
): Reference | undefined {
  const ref = relation.reference;
  let candidate: Reference;
  if (ref.kind === 'entity') return ref;
  if (ref.kind === 'baseAxis') {
    if (!hasGeometryBaseAxis(target.editorType, ref.axisId)) return;
    candidate = ref;
  } else if (ref.kind === 'origin') {
    const view = frames.get(ref.frameId);
    if (!view) return;
    candidate = { kind: 'origin', frameId: view.id };
  } else {
    const axis = source.auxiliarySystems?.find((item) => item.id === ref.systemId);
    const view = axis && frames.get(axis.newViewId);
    const match = view && target.auxiliarySystems?.find((item) => item.newViewId === view.id);
    if (!match) return;
    candidate = { kind: 'projectionAxis', systemId: match.id };
  }
  const a = resolveReference(source, ref);
  const b = resolveReference(target, candidate);
  const anchor = mapSheet(a.anchor);
  const other = b.anchor;
  if (!a.direction || !b.direction) return near(anchor, other) ? candidate : undefined;
  const tangent = unit(sub(mapSheet(add(a.anchor, a.direction)), anchor));
  const direction = unit(b.direction);
  if (Math.abs(cross(tangent, direction)) > 1e-7) return;
  if (relation.kind !== 'POINT_ON_REFERENCE') return candidate;
  if (Math.abs(cross(sub(anchor, other), direction)) < 1e-7) return candidate;
}
