import {
  type GeometryDocument,
  type GeometryEntity,
  type GeometryTargetRef,
  type Vec2,
} from '@tuheng/contracts';
import {
  boundaryShape,
  atPiece,
  nearestOnShape,
  stationaryPoints,
  shapeIntersections,
  conicPoint,
  conicParameter,
  curvedMidpoint,
  type BoundaryShape,
} from './parametric-geometry';
import { referenceGeometry, referenceKey } from './references';
import { sheetDeltaToLocal, sheetToLocal, localToSheet } from './sheet';
import {
  distance,
  foot,
  add,
  dot,
  sub,
  unit,
  scale,
  cross,
  length,
  lineGeometry,
  type LineGeometry,
} from './math';
import { diffPoly, polynomialRoots, evalPoly } from './curve-roots';
import type { SnapCandidate, SnapGuide, SnapOptions } from './snapping';

export type ObjectSnapType =
  | 'endpoint'
  | 'midpoint'
  | 'center'
  | 'intersection'
  | 'perpendicular'
  | 'tangent'
  | 'quadrant'
  | 'nearest';
export const objectSnapEnabled = (options: SnapOptions, type: ObjectSnapType) =>
  options.objects !== false && (!options.objectTypes || options.objectTypes.includes(type));
export interface IndexEntry {
  ref: GeometryTargetRef;
  entity?: GeometryEntity;
  name: string;
  shape: BoundaryShape;
  ray: boolean;
  bounds?: number[];
  midpoint?: Vec2;
}
interface Index {
  entries: IndexEntry[];
  centerPoints: Set<string>;
  endpoints: Set<string>;
}
const cache = new WeakMap<GeometryDocument, Map<string, Index>>();

function lineInView(
  doc: GeometryDocument,
  line: LineGeometry,
  from: string,
  to: string,
): LineGeometry {
  const local = (p: Vec2) => sheetToLocal(doc, to, localToSheet(doc, from, p));
  const a = local(line.a);
  return { ...line, a, d: sub(local(add(line.a, line.d)), a) };
}

export function shapeBounds(s: BoundaryShape): number[] | undefined {
  if (s.kind === 'line') {
    if (!s.line.finite) return;
    const a = s.line.a,
      b = add(a, s.line.d);
    return [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)];
  }
  if (s.conic) {
    const c = s.conic;
    return [c.center.x - c.a, c.center.y - c.a, c.center.x + c.a, c.center.y + c.a];
  }
  const xs: number[] = [],
    ys: number[] = [];
  for (const b of s.pieces) {
    for (const [poly, values] of [
      [b.x, xs],
      [b.y, ys],
    ] as const)
      for (const t of [b.lo, b.hi, ...polynomialRoots(diffPoly(poly), b.lo, b.hi)])
        values.push(evalPoly(poly, t));
  }
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}
export function snapIndex(doc: GeometryDocument, viewId: string): Index {
  let frames = cache.get(doc);
  if (!frames) {
    frames = new Map();
    cache.set(doc, frames);
  }
  const stored = frames.get(viewId);
  if (stored) return stored;
  const entries: IndexEntry[] = [],
    centerPoints = new Set<string>(),
    endpoints = new Set<string>();
  for (const e of doc.entities) {
    if (e.viewId !== viewId && e.scope !== 'SHEET') continue;
    if (e.kind === 'segment') {
      endpoints.add(e.startPoint);
      endpoints.add(e.endPoint);
    }
    if (e.kind === 'circle' || e.kind === 'arc' || e.kind === 'ellipse') centerPoints.add(e.center);
    if (e.kind === 'curve') for (const id of e.pointIds) endpoints.add(id);
    let shape = boundaryShape(doc, e);
    if (!shape) continue;
    if (e.viewId !== viewId && shape.kind === 'line')
      shape = { kind: 'line', line: lineInView(doc, shape.line, e.viewId, viewId) };
    entries.push({
      ref: { kind: 'entity', entityId: e.id },
      entity: e,
      name: (
        {
          line: '辅助线',
          segment: '线段',
          curve: '样条',
          circle: '圆',
          arc: '圆弧',
          ellipse: '椭圆',
        } as Record<string, string>
      )[e.kind],
      shape,
      ray: false,
      bounds: shapeBounds(shape),
    });
  }
  for (const r of referenceGeometry(doc))
    if (r.direction) {
      entries.push({
        ref: r.ref,
        name: r.name,
        ray: r.extent === 'ray',
        shape: {
          kind: 'line',
          line: {
            a: sheetToLocal(doc, viewId, r.anchor),
            d: sheetDeltaToLocal(doc, viewId, r.direction),
            finite: false,
          },
        },
      });
    }
  const index = { entries, centerPoints, endpoints };
  frames.set(viewId, index);
  return index;
}
export function nearbyEntries(
  doc: GeometryDocument,
  viewId: string,
  p: Vec2,
  radius: number,
  options: SnapOptions,
) {
  return snapIndex(doc, viewId).entries.filter((e) => {
    if (!visibleSnapEntry(e, options)) return false;
    const b = e.bounds;
    if (
      b &&
      (p.x + radius < b[0] || p.y + radius < b[1] || p.x - radius > b[2] || p.y - radius > b[3])
    )
      return false;
    if (e.shape.kind === 'line') {
      const l = e.shape.line;
      return distance(p, foot(p, l)) <= radius && (!e.ray || dot(sub(p, l.a), l.d) >= -radius);
    }
    return true;
  });
}

function visibleSnapEntry({ entity }: IndexEntry, options: SnapOptions) {
  return entity
    ? options.objects !== false &&
        !options.exclude?.includes(entity.id) &&
        !options.hiddenLayers?.includes(entity.layerId)
    : options.axes !== false;
}

/** A nearby hit on a carrier must also be within the snap radius of each carrier separately. */
export function extensionIntersections(
  doc: GeometryDocument,
  viewId: string,
  pointer: Vec2,
  radius: number,
  options: SnapOptions,
): SnapCandidate[] {
  if (!objectSnapEnabled(options, 'intersection')) return [];
  const entries = snapIndex(doc, viewId).entries;
  const transfer = miterNearPointer(entries, pointer, radius, options);
  const foreign = transfer ? transferBoundaryEntries(doc, viewId, options) : [];
  const aligned = [...entries, ...foreign].flatMap((entry) => {
    if (entry.shape.kind !== 'line' || !visibleSnapEntry(entry, options)) return [];
    const line = entry.shape.line;
    const direction = unit(line.d);
    const delta = sub(pointer, line.a);
    if (
      !length(direction) ||
      Math.abs(cross(delta, direction)) > radius ||
      (entry.ray && dot(delta, direction) < -radius)
    )
      return [];
    const transferOnly =
      entry.entity && entry.entity.viewId !== viewId && entry.entity.scope !== 'SHEET';
    return [{ entry, line, direction, transferOnly }];
  });
  const limit = 64;
  if (aligned.length > limit)
    aligned.sort(
      (a, b) => distance(pointer, foot(pointer, a.line)) - distance(pointer, foot(pointer, b.line)),
    );
  const result: SnapCandidate[] = [];
  for (const [i, a] of aligned.slice(0, limit).entries())
    for (const b of aligned.slice(i + 1, limit)) {
      if ((a.transferOnly && b.entry !== transfer) || (b.transferOnly && a.entry !== transfer))
        continue;
      if ((!a.line.finite && !b.line.finite) || Math.abs(cross(a.direction, b.direction)) <= 1e-6)
        continue;
      const [hit] = shapeIntersections(
        { kind: 'line', line: { ...a.line, finite: false } },
        { kind: 'line', line: { ...b.line, finite: false } },
      );
      if (!hit || (a.entry.ray && hit.a < -1e-8) || (b.entry.ray && hit.b < -1e-8)) continue;
      const gap = distance(pointer, hit.position);
      if (gap > radius) continue;
      const tracks = (
        [
          [a, hit.a],
          [b, hit.b],
        ] as const
      ).flatMap(([source, t]) => {
        if (!source.line.finite || (t >= -1e-9 && t <= 1 + 1e-9)) return [];
        const point = t < 0 ? source.line.a : add(source.line.a, source.line.d);
        return [{ point, direction: unit(sub(hit.position, point)) }];
      });
      if (!tracks.length) continue;
      const sources = [a.entry, b.entry];
      const axis = sources.find((entry) => !entry.entity);
      result.push({
        id: `EXTENSION_INTERSECTION:${sources
          .map(({ ref }) => referenceKey(ref))
          .sort()
          .join(',')}`,
        kind: 'INTERSECTION',
        composite: 'extension',
        label: axis ? `延长线交点 · ${axis.name}` : '延长线交点',
        position: hit.position,
        distance: gap,
        positionOnly: true,
        entityIds: sources.flatMap(({ entity }) => (entity ? [entity.id] : [])),
        reference: axis?.ref,
        tracks,
      });
    }
  return result;
}

export function geometricIntersections(
  doc: GeometryDocument,
  viewId: string,
  p: Vec2,
  radius: number,
  options: SnapOptions,
): SnapCandidate[] {
  if (!objectSnapEnabled(options, 'intersection')) return [];
  const near = nearbyEntries(doc, viewId, p, radius * 1.5, options).filter(
    (e) =>
      e.shape.kind === 'line' || distance(nearestOnShape(e.shape, p).position, p) <= radius * 1.5,
  );
  const result: SnapCandidate[] = [];
  for (let i = 0; i < near.length; i++)
    for (let j = i + 1; j < near.length; j++) {
      const a = near[i],
        b = near[j];
      if (!a.entity && !b.entity) continue; // Base-axis intersections are represented by the origin.
      const straight = a.shape.kind === 'line' && b.shape.kind === 'line';
      const native = straight && a.entity?.viewId === viewId && b.entity?.viewId === viewId;
      const refs = [a.ref, b.ref].sort((x, y) => referenceKey(x).localeCompare(referenceKey(y)));
      let hits;
      try {
        hits = shapeIntersections(a.shape, b.shape);
      } catch {
        continue;
      } // An indeterminate overlap is not a snap target.
      for (const h of hits) {
        if ((a.ray && h.a < -1e-8) || (b.ray && h.b < -1e-8)) continue;
        const id =
          'INTERSECTION:' +
          refs.map(referenceKey).join(',') +
          (straight ? '' : ':' + h.position.x.toFixed(7) + ',' + h.position.y.toFixed(7));
        const d = distance(p, h.position);
        if (d > radius * (options.previous?.id === id ? 1.5 : 1)) continue;
        result.push({
          id,
          label: '交点 · ' + a.name + ' / ' + b.name,
          position: h.position,
          kind: 'INTERSECTION',
          distance: d,
          entityIds: refs.flatMap((r) => (r.kind === 'entity' ? [r.entityId] : [])),
          ...(straight && !native ? { references: refs } : {}),
          ...(!straight ? { positionOnly: true } : {}),
        });
      }
    }
  result.push(...transferIntersections(doc, viewId, p, radius, options));
  return result
    .sort((a, b) => a.distance - b.distance || a.id!.localeCompare(b.id!))
    .filter((c, i, all) => !all.slice(0, i).some((v) => distance(v.position, c.position) < 1e-7));
}
function miterNearPointer(
  entries: readonly IndexEntry[],
  p: Vec2,
  radius: number,
  options: SnapOptions,
) {
  if (options.axes === false) return;
  return entries.find(
    ({ ref, shape }) =>
      ref.kind === 'baseAxis' &&
      ref.axisId === 'MITER_45' &&
      shape.kind === 'line' &&
      distance(p, foot(p, shape.line)) <= radius &&
      dot(sub(p, shape.line.a), unit(shape.line.d)) >= -radius,
  );
}

/** Edges in the neighbouring projection can also meet the transfer ray on the sheet. */
function transferBoundaryEntries(
  doc: GeometryDocument,
  viewId: string,
  options: SnapOptions,
): IndexEntry[] {
  return doc.entities.flatMap((entity): IndexEntry[] => {
    if (
      entity.viewId === viewId ||
      entity.scope === 'SHEET' ||
      (entity.kind !== 'segment' && entity.kind !== 'line') ||
      options.hiddenLayers?.includes(entity.layerId) ||
      options.exclude?.includes(entity.id)
    )
      return [];
    return [
      {
        entity,
        ref: { kind: 'entity', entityId: entity.id },
        ray: false,
        name: entity.kind === 'segment' ? '线段' : '辅助线',
        shape: {
          kind: 'line',
          line: lineInView(doc, lineGeometry(doc, entity), entity.viewId, viewId),
        },
      },
    ];
  });
}

function transferIntersections(
  doc: GeometryDocument,
  viewId: string,
  p: Vec2,
  radius: number,
  options: SnapOptions,
): SnapCandidate[] {
  const axis = miterNearPointer(snapIndex(doc, viewId).entries, p, radius, options);
  if (!axis) return [];
  return transferBoundaryEntries(doc, viewId, options).flatMap((entry): SnapCandidate[] => {
    const [hit] = shapeIntersections(axis.shape, entry.shape);
    if (!hit || hit.a < -1e-8 || distance(p, hit.position) > radius) return [];
    return [
      {
        id: `INTERSECTION:axis:MITER_45,${referenceKey(entry.ref)}`,
        kind: 'INTERSECTION',
        position: hit.position,
        positionOnly: true,
        label: '交点 · 45° 传宽线',
        distance: distance(p, hit.position),
        entityIds: [entry.entity!.id],
      },
    ];
  });
}

export function curvedSnapPositions(
  entry: IndexEntry,
  p: Vec2,
  origin: Vec2 | undefined,
  options: SnapOptions,
) {
  const s = entry.shape,
    res: { position: Vec2; kind: SnapCandidate['kind']; label: string; guide?: SnapGuide }[] = [];
  if (s.kind !== 'parametric') return res;
  const push = (position: Vec2, kind: SnapCandidate['kind'], label: string, guide?: SnapGuide) =>
    res.push({ position, kind, label: label + ' · ' + entry.name, guide });
  const c = s.conic;
  if (c) {
    if (objectSnapEnabled(options, 'center')) push(c.center, 'CENTER', '中心');
    if (objectSnapEnabled(options, 'quadrant'))
      for (const theta of [0, 90, 180, 270]) {
        const q = conicPoint({ ...c, start: theta, sweep: 360 }, 0);
        if (conicParameter(c, q) <= 1 + 1e-8) push(q, 'QUADRANT', '象限点');
      }
  }
  if (!s.closed && objectSnapEnabled(options, 'endpoint')) {
    const first = s.pieces[0],
      last = s.pieces.at(-1)!;
    push(atPiece(first, first.lo), 'ENDPOINT', '端点');
    push(atPiece(last, last.hi), 'ENDPOINT', '端点');
  }
  if (objectSnapEnabled(options, 'midpoint') && !s.closed) {
    entry.midpoint ??= curvedMidpoint(s);
    push(entry.midpoint, 'MIDPOINT', '弧长中点');
  }
  if (objectSnapEnabled(options, 'perpendicular'))
    for (const q of stationaryPoints(s, origin ?? p, 'normal')) {
      const normal = sub(q.position, origin ?? p);
      if (options.lineRelations && origin && length(normal) <= 1e-7) continue;
      const guide =
        options.lineRelations && origin && entry.entity
          ? {
              kind: 'perpendicular' as const,
              sourceId: entry.entity.id,
              origin: q.position,
              contact: q.position,
              direction: unit({ x: -normal.y, y: normal.x }),
            }
          : undefined;
      push(q.position, 'FOOT', '垂足', guide);
    }
  if (origin && objectSnapEnabled(options, 'tangent')) {
    // The derivative root at an on-circle origin is a double root. It belongs
    // to the departing tangent, handled below, not a second nearby contact.
    if (
      c &&
      (entry.entity?.kind === 'circle' || entry.entity?.kind === 'arc') &&
      distance(origin, c.center) <= c.a + 1e-9
    )
      return res;
    for (const q of stationaryPoints(s, origin, 'tangent')) {
      const v = sub(q.position, origin);
      if (length(v) <= 1e-7) continue;
      const guide =
        options.lineRelations && entry.entity
          ? {
              kind: 'tangent' as const,
              sourceId: entry.entity.id,
              origin: q.position,
              contact: q.position,
              direction: unit(v),
            }
          : undefined;
      push(q.position, 'TANGENT', '切点', guide);
    }
  }
  return res;
}

/** Require a meaningful drag direction as well as the caller's pixel-distance
 * snap threshold. Otherwise any tiny stroke could agree with every direction. */
export function directionalEndpoint(
  anchor: Vec2,
  pointer: Vec2,
  direction: Vec2,
  pixelsPerMm: number,
  retained: boolean,
) {
  const v = sub(pointer, anchor),
    size = length(v);
  if (size * pixelsPerMm < 5 || size < 1e-8) return;
  const tolerance = ((retained ? 7.5 : 5) * Math.PI) / 180;
  if (Math.abs(cross(v, direction)) > size * Math.sin(tolerance)) return;
  return add(anchor, scale(direction, dot(v, direction)));
}

/** Return only circles/arcs whose actual displayed circumference contains the
 * previously accepted point. The tolerance is a numerical tolerance in mm. */
export function tangentAtCircleOrigin(entry: IndexEntry, anchor: Vec2): SnapGuide | undefined {
  const entity = entry.entity;
  if (
    !entity ||
    (entity.kind !== 'circle' && entity.kind !== 'arc') ||
    entry.shape.kind !== 'parametric'
  )
    return;
  const c = entry.shape.conic!;
  const radial = sub(anchor, c.center);
  if (Math.abs(length(radial) - c.a) > 1e-8 || conicParameter(c, anchor) > 1 + 1e-9) return;
  return {
    kind: 'tangent',
    sourceId: entity.id,
    origin: anchor,
    contact: anchor,
    direction: unit({ x: -radial.y, y: radial.x }),
  };
}
