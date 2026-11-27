import {
  hasGeometryBaseAxis,
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
import { referenceGeometry, referenceKey, resolveReference } from './references';
import { sheetDeltaToLocal, sheetToLocal, localToSheet } from './sheet';
import { distance, foot, add, dot, sub, unit, scale, cross, length, lineGeometry } from './math';
import { diffPoly, polynomialRoots, evalPoly } from './curve-roots';
import type { SnapCandidate, SnapGuide, SnapOptions } from './snapping';

export type ObjectSnapType =
  'endpoint' | 'midpoint' | 'center' | 'intersection' | 'perpendicular' | 'tangent' | 'quadrant' | 'nearest';
export const objectSnapEnabled = (options: SnapOptions, type: ObjectSnapType) =>
  options.objects !== false && (!options.objectTypes || options.objectTypes.includes(type));
interface IndexEntry {
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
    if (e.viewId !== viewId && shape.kind === 'line') {
      const local = (p: Vec2) => sheetToLocal(doc, viewId, localToSheet(doc, e.viewId, p));
      const a = local(shape.line.a),
        d = sub(local(add(shape.line.a, shape.line.d)), a);
      shape = { kind: 'line', line: { ...shape.line, a, d } };
    }
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
    if (
      e.entity
        ? options.objects === false ||
          options.exclude?.includes(e.entity.id) ||
          options.hiddenLayers?.includes(e.entity.layerId)
        : options.axes === false
    )
      return false;
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
  result.push(...transferIntersections(doc,viewId,p,radius,options));
  return result
    .sort((a, b) => a.distance - b.distance || a.id!.localeCompare(b.id!))
    .filter((c, i, all) => !all.slice(0, i).some((v) => distance(v.position, c.position) < 1e-7));
}
/** The transfer ray crosses the unused quadrant of the unfolded sheet. A bordering
 * line can belong to either view. Use paper coordinates without merging their nodes. */
function transferIntersections(doc:GeometryDocument, viewId:string, p:Vec2, radius:number, options:SnapOptions) {
  if (options.axes===false || !hasGeometryBaseAxis(doc.editorType, 'MITER_45')) return [];
  const ref = resolveReference(doc,{kind:'baseAxis',axisId:'MITER_45'});
  const a = sheetToLocal(doc,viewId,ref.anchor), axis = sheetDeltaToLocal(doc,viewId,ref.direction!);
  if (Math.abs(cross(sub(p,a),unit(axis)))>radius || dot(sub(p,a),unit(axis))<-radius) return [];
  const result:SnapCandidate[]=[];
  for (const e of doc.entities) {
    if (e.viewId===viewId || e.scope==='SHEET' || (e.kind!=='segment' && e.kind!=='line') ||
        options.hiddenLayers?.includes(e.layerId) || options.exclude?.includes(e.id)) continue;
    const l=lineGeometry(doc,e);
    const convert=(q:Vec2)=>sheetToLocal(doc,viewId,localToSheet(doc,e.viewId,q));
    const start=convert(l.a), d=sub(convert(add(l.a,l.d)),start);
    const det=cross(axis,d), delta=sub(start,a);
    if (Math.abs(det)<1e-9) continue;
    const t=cross(delta,d)/det, u=cross(delta,axis)/det;
    if (t < -1e-8 || l.finite&&(u < -1e-8 || u > 1+1e-8)) continue;
    const position=add(a,scale(axis,t)), gap=distance(position,p);
    if (gap<=radius) result.push({
      id:'INTERSECTION:axis:MITER_45,'+e.id, kind:'INTERSECTION', position, positionOnly:true,
      label:'交点 · 45° 传宽线', distance:gap, entityIds:[e.id],
    });
  }
  return result;
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
