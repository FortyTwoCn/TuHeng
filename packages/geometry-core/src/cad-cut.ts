import { createId, type GeometryDocument, type GeometryEntity, type Vec2 } from '@tuheng/contracts';
import { pointReferences, editable, removeUnusedControlPoints } from './document';
import { add, scale, sub, dot, cross, unit, lineGeometry, minorArc, angle, distance } from './math';
import {
  boundaryShape,
  boundaryAt,
  nearestOnShape,
  shapeIntersections,
  overlappingBoundaries,
  type BoundaryShape,
} from './parametric-geometry';
import { cadMutation, type CadRole } from './cad-transforms';
import { distinct } from './curve-roots';
import { localToSheet, sheetToLocal } from './sheet';

const epsilon = 1e-8;
const wrapAngle = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;
type Segment = Extract<GeometryEntity, { kind: 'segment' }>;
type Trimmable = Extract<
  GeometryEntity,
  { kind: 'segment' | 'circle' | 'arc' | 'ellipse' | 'curve' }
>;
function getTarget(doc: GeometryDocument, id: string, role: CadRole) {
  const e = doc.entities.find((v) => v.id === id);
  if (!e || !editable(doc, e, role)) throw Error('请选择可编辑的目标图元');
  if (
    doc.referenceRelations?.some((r) => r.targetId === id && r.mode === 'BINDING') ||
    doc.constraints.some((r) => r.entityIds[0] === id && r.mode === 'BINDING')
  )
    throw Error('目标图元受绑定控制，请先解除绑定');
  if (
    doc.auxiliarySystems?.some((s) => s.referenceEntityId === id) ||
    doc.entities.some((e) => e.kind === 'hatch' && e.loops.some((loop) => loop.includes(id)))
  )
    throw Error('该边界已用于换面轴或剖面线，请先处理依赖');
  return e;
}
function readBoundaries(doc: GeometryDocument, ids: string[], target: GeometryEntity) {
  if (!ids.length || ids.includes(target.id)) throw Error('请选择其他图元作为边界');
  return [...new Set(ids)].map((id) => {
    const e = doc.entities.find((v) => v.id === id);
    if (!e || (e.viewId !== target.viewId && e.scope !== 'SHEET'))
      throw Error('边界必须在同一投影面或为图纸辅助线');
    const shape = boundaryShape(doc, e);
    if (!shape) throw Error('边界需要线、圆、圆弧、椭圆或样条');
    if (e.viewId !== target.viewId && shape.kind === 'line') {
      const convert = (p: Vec2) => sheetToLocal(doc, target.viewId, localToSheet(doc, e.viewId, p));
      const a = convert(shape.line.a),
        d = sub(convert(add(shape.line.a, shape.line.d)), a);
      return { kind: 'line' as const, line: { ...shape.line, a, d } };
    }
    return shape;
  });
}
function addNode(d: GeometryDocument, source: GeometryEntity, position: Vec2) {
  const id = createId();
  d.entities.push({
    id,
    viewId: source.viewId,
    layerId: source.layerId,
    lineStyle: source.lineStyle,
    kind: 'point',
    name: '',
    position,
    spatial: null,
    labelVisible: false,
  });
  return id;
}
type Range = [number, number];
function visibleRange(shape: BoundaryShape): Range {
  if (shape.kind === 'line' || shape.conic) return [0, 1];
  const first = shape.pieces[0], last = shape.pieces.at(-1)!;
  return [first.parameter(first.lo), last.parameter(last.hi)];
}
function cutIntervals(shape: BoundaryShape, boundaries: BoundaryShape[]): Range[] {
  const [lo, hi] = visibleRange(shape);
  const closed = shape.kind === 'parametric' && shape.closed;
  if (boundaries.some((b) => overlappingBoundaries(shape, b)))
    throw Error('边界与目标区段重合，无法唯一确定交点');
  const intersections = boundaries.flatMap((b) => shapeIntersections(shape, b)).filter((h) => !h.tangent);
  let cuts = distinct(intersections.map((h) => closed && h.a > 1 - epsilon ? 0 : h.a), epsilon);
  if (!closed) cuts = cuts.filter((t) => t > lo + epsilon && t < hi - epsilon);
  if (cuts.length < (closed ? 2 : 1)) return [];
  const breaks = closed ? [...cuts, cuts[0] + 1] : [lo, ...cuts, hi];
  return breaks.slice(1).map((t, i) => [breaks[i], t]);
}
function remainingIntervals(shape: BoundaryShape, all: Range[], removes: Set<Range>): Range[] {
  const kept: Range[] = [];
  for (const range of all) {
    if (removes.has(range)) continue;
    const last = kept.at(-1);
    if (last && Math.abs(last[1] - range[0]) < epsilon) last[1] = range[1];
    else kept.push([...range]);
  }
  if (shape.kind === 'parametric' && shape.closed && kept.length > 1 &&
      Math.abs(kept.at(-1)![1] - kept[0][0] - 1) < epsilon) {
    const last = kept.pop()!;
    kept[0][0] = last[0] - 1;
  }
  return kept;
}
function preservedFragment(
  d: GeometryDocument,
  e: Trimmable,
  lo: number,
  hi: number,
  id: string,
): Trimmable {
  if (e.kind === 'segment') {
    const l = lineGeometry(d, e);
    return {
      ...e,
      id,
      startPoint: lo <= epsilon ? e.startPoint : addNode(d, e, add(l.a, scale(l.d, lo))),
      endPoint: hi >= 1 - epsilon ? e.endPoint : addNode(d, e, add(l.a, scale(l.d, hi))),
    };
  }
  if (e.kind === 'curve') return { ...e, id, parameterRange: [lo, hi] };
  const start = e.kind === 'circle' ? 0 : e.startAngle,
    sweep = e.kind === 'circle' ? 360 : e.sweep;
  const range = { id, startAngle: wrapAngle(start + lo * sweep), sweep: (hi - lo) * sweep };
  if (e.kind === 'ellipse') return { ...e, ...range };
  return { ...e, kind: 'arc', ...range };
}
function trimmable(e: GeometryEntity): e is Trimmable {
  return e.kind === 'segment' || e.kind === 'circle' || e.kind === 'arc' ||
    e.kind === 'ellipse' || e.kind === 'curve';
}
function trimFragments(doc: GeometryDocument, targets: { entity: Trimmable; kept: Range[] }[],
    role: CadRole, preview: boolean) {
  for (const {entity:e, kept} of targets)
    if (kept.length !== 1 &&
      (doc.entities.some(o => o.kind === 'dimension' && o.referenceIds.includes(e.id)) ||
       doc.referenceRelations?.some(r => r.targetId === e.id || (r.reference.kind === 'entity' && r.reference.entityId === e.id)) ||
       doc.constraints.some(r => r.entityIds.includes(e.id)) ||
       doc.projectionGroups.some(g => g.entityIds.includes(e.id))))
      throw Error('修剪会改变所引用的图元，请先处理标注或关系');
  return cadMutation(doc, role, preview, new Set(targets.map(t => t.entity.id)), d => {
    const nodes = new Set<string>();
    for (const {entity, kept} of targets) {
      if (entity.kind === 'curve') d.schemaVersion = 'tuheng.geometry/3.0.0';
      const fragments = kept.map(([from,to], i) => preservedFragment(d, entity, from, to, i ? createId() : entity.id));
      d.entities.splice(d.entities.findIndex(e => e.id === entity.id), 1, ...fragments);
      for (const id of pointReferences(entity)) nodes.add(id);
    }
    removeUnusedControlPoints(d, nodes, role);
  });
}
export function trimAt(
  doc: GeometryDocument, boundaryIds: string[], targetId: string, pick: Vec2,
  role: CadRole, preview = false,
) {
  const e = getTarget(doc, targetId, role);
  if (!trimmable(e)) throw Error('请选择有限线段、圆、圆弧、椭圆或样条作为被修剪对象');
  const shape = boundaryShape(doc,e)!;
  const intervals = cutIntervals(shape, readBoundaries(doc, boundaryIds, e));
  if (!intervals.length) throw Error('缺少可确定修剪区段的交点，检查重合、相切或边界范围');
  let t = nearestOnShape(shape, pick).t;
  if (shape.kind === 'parametric' && shape.closed && t < intervals[0][0]) t += 1;
  const range = intervals.find(([a,b]) => t >= a - epsilon && t <= b + epsilon);
  const [lo, hi] = visibleRange(shape);
  if (!range || [range[0],range[1]].some(point =>
    Math.abs(t - point) < epsilon && (shape.kind === 'parametric' && shape.closed || (point > lo + epsilon && point < hi - epsilon))))
    throw Error('请选择交点之间要移除的区段');
  return trimFragments(doc, [{entity:e, kept:remainingIntervals(shape, intervals, new Set([range]))}], role, preview);
}
export function trimInBox(doc: GeometryDocument, boundaryIds: string[], viewId: string,
    first: Vec2, second: Vec2, role: CadRole, hidden: readonly string[] = [], preview = false) {
  const min = {x:Math.min(first.x,second.x),y:Math.min(first.y,second.y)};
  const max = {x:Math.max(first.x,second.x),y:Math.max(first.y,second.y)};
  if (max.x - min.x < epsilon || max.y - min.y < epsilon) throw Error('请选择有宽高的修剪范围');
  const corners = [min,{x:max.x,y:min.y},max,{x:min.x,y:max.y}];
  const sides: BoundaryShape[] = corners.map((p,i) => ({
    kind:'line', line:{a:p, d:sub(corners[(i+1)%4],p), finite:true},
  }));
  const contains = (p:Vec2) => p.x > min.x+epsilon && p.x < max.x-epsilon && p.y > min.y+epsilon && p.y < max.y-epsilon;
  const targets: {entity:Trimmable; kept:Range[]}[] = [];
  for (const entity of doc.entities) {
    if (!trimmable(entity) || entity.viewId !== viewId || boundaryIds.includes(entity.id) ||
        hidden.includes(entity.layerId) || !editable(doc,entity,role)) continue;
    const shape = boundaryShape(doc,entity)!;
    const [lo,hi] = visibleRange(shape);
    const hits = sides.flatMap(side=>shapeIntersections(shape,side)).map(hit=>hit.a);
    const checks = distinct([lo,hi,...hits],epsilon);
    const inside: Range[] = [];
    for (let i=1;i<checks.length;i++)
      if (contains(boundaryAt(shape,(checks[i-1]+checks[i])/2))) inside.push([checks[i-1],checks[i]]);
    if (!inside.length) continue;
    const intervals = cutIntervals(shape,readBoundaries(doc,boundaryIds,entity));
    const closed = shape.kind === 'parametric' && shape.closed;
    const removes = new Set(intervals.filter(([from,to])=>inside.some(([a,b]) =>
      Math.min(to,b)-Math.max(from,a)>epsilon ||
      (closed && Math.min(to,b+1)-Math.max(from,a+1)>epsilon))));
    if (!removes.size) continue;
    getTarget(doc,entity.id,role);
    targets.push({entity,kept:remainingIntervals(shape,intervals,removes)});
  }
  if (!targets.length) throw Error('框内没有可修剪的区段');
  return trimFragments(doc,targets,role,preview);
}
function movingEndpoint(
  doc: GeometryDocument,
  e: Segment,
  end: 'startPoint' | 'endPoint',
  role: CadRole,
) {
  const id = e[end],
    p = doc.entities.find((v) => v.id === id)!;
  if (!editable(doc, p, role)) throw Error('延伸涉及只读锚点，请先解除端点连接');
  if (
    doc.entities.some((o) => o.id !== e.id && pointReferences(o).includes(id)) ||
    doc.referenceRelations?.some((r) => r.targetId === id && r.mode === 'BINDING') ||
    doc.constraints.some((r) => r.entityIds[0] === id && r.mode === 'BINDING')
  )
    throw Error('端点被共享或绑定，请先解除连接');
  return id;
}
export function extendAt(
  doc: GeometryDocument,
  boundaryIds: string[],
  targetId: string,
  pick: Vec2,
  role: CadRole,
  preview = false,
) {
  const e = getTarget(doc, targetId, role);
  if (e.kind !== 'segment') throw Error('延伸需要一条有限线段');
  const l = lineGeometry(doc, e),
    mid = dot(sub(pick, l.a), l.d) / dot(l.d, l.d);
  if (Math.abs(mid - 0.5) < epsilon) throw Error('请选择靠近需要延伸的端点');
  const start = mid < 0.5,
    id = movingEndpoint(doc, e, start ? 'startPoint' : 'endPoint', role);
  const line: BoundaryShape = { kind: 'line', line: { ...l, finite: false } };
  const hits = readBoundaries(doc, boundaryIds, e)
    .flatMap((b) => shapeIntersections(line, b))
    .filter((h) => (start ? h.a < -epsilon : h.a > 1 + epsilon))
    .sort((a, b) => (start ? b.a - a.a : a.a - b.a));
  if (!hits.length) throw Error('所选端点向外延伸没有有效交点');
  return cadMutation(doc, role, preview, new Set([id]), (d) => {
    const p = d.entities.find((v) => v.id === id)!;
    if (p.kind === 'point') {
      p.position = hits[0].position;
      p.spatial = null;
    }
  });
}
export type CornerSpec =
  { kind: 'chamfer'; distanceA?: number; distanceB?: number } | { kind: 'fillet'; radius?: number };
export function cornerAt(
  doc: GeometryDocument,
  aId: string,
  bId: string,
  aPick: Vec2,
  bPick: Vec2,
  spec: CornerSpec,
  role: CadRole,
  trim = true,
  preview = false,
) {
  const a = getTarget(doc, aId, role),
    b = getTarget(doc, bId, role);
  if (a.id === b.id || a.kind !== 'segment' || b.kind !== 'segment' || a.viewId !== b.viewId)
    throw Error('请选择同一投影视图中的两条不同有限线段');
  const al = lineGeometry(doc, a), bl = lineGeometry(doc, b);
  const ad = unit(al.d), bd = unit(bl.d);
  if (Math.abs(cross(ad, bd)) < 1e-8) {
    const gap = cross(ad, sub(bl.a, al.a));
    if (spec.kind !== 'fillet' || Math.abs(gap) <= epsilon)
      throw Error('平行边只能倒圆角，重合边不能接角');
    const along = (p:Vec2) => dot(sub(p,al.a),ad);
    const aEnd = along(aPick) >= along(add(al.a,scale(al.d,0.5)));
    const bEnd = along(bPick) >= along(add(bl.a,scale(bl.d,0.5)));
    if (aEnd !== bEnd) throw Error('请点两条平行边的同一端');
    const end = aEnd ? Math.min : Math.max;
    const endAt = end(
      aEnd ? Math.max(along(al.a),along(add(al.a,al.d))) : Math.min(along(al.a),along(add(al.a,al.d))),
      aEnd ? Math.max(along(bl.a),along(add(bl.a,bl.d))) : Math.min(along(bl.a),along(add(bl.a,bl.d))),
    );
    const first = parallelEnd(al, ad, aEnd), second = parallelEnd(bl, ad, aEnd);
    const ta = add(al.a,scale(ad,endAt));
    const tb = add(ta,scale({x:-ad.y,y:ad.x},gap));
    const outward = scale(ad,aEnd ? 1 : -1);
    if (trim && ([[al,first,ta], [bl,second,tb]] as const).some(([line, key, p]) =>
      dot(sub(p, key==='endPoint' ? line.a : add(line.a,line.d)),outward) <= epsilon)) throw Error('两条平行边没有可保留的共同范围');
    const center = scale(add(ta,tb),0.5);
    return writeCorner(doc,a,b,first,second,ta,tb,role,trim,preview,{
      center, radius:Math.abs(gap)/2, startAngle:angle(sub(ta,center)),
      sweep:cross(sub(ta,center),outward)>0 ? 180 : -180,
    });
  }
  const vertex = add(al.a, scale(al.d, cross(sub(bl.a, al.a), bl.d) / cross(al.d, bl.d)));
  function ray(line: ReturnType<typeof lineGeometry>, pick: Vec2) {
    const u = unit(line.d), projection = dot(sub(pick, vertex), u);
    const dir = scale(u, Math.sign(projection || dot(sub(add(line.a,scale(line.d,0.5)),vertex),u) || 1));
    const near = dot(sub(line.a, vertex), dir), far = dot(sub(add(line.a, line.d), vertex), dir);
    return {
      dir,
      distance:Math.abs(projection),
      far: Math.max(near, far),
      end: near < far ? ('startPoint' as const) : ('endPoint' as const),
    };
  }
  const first = ray(al, aPick), second = ray(bl, bPick);
  const half = Math.acos(Math.max(-1, Math.min(1, dot(first.dir, second.dir)))) / 2;
  const distances = spec.kind === 'fillet'
    ? [(spec.radius ?? second.distance*Math.tan(half)) / Math.tan(half),
       (spec.radius ?? second.distance*Math.tan(half)) / Math.tan(half)]
    : [spec.distanceA ?? first.distance, spec.distanceB ?? second.distance];
  if (distances.some((n) => !Number.isFinite(n) || n < 0)) throw Error('请输入有效的非负半径或倒角距离');
  if (trim && [first, second].some((r, i) => distances[i] >= r.far - epsilon))
    throw Error('半径或倒角距离超出所选边的可用长度');
  const ta = add(vertex, scale(first.dir, distances[0])), tb = add(vertex, scale(second.dir, distances[1]));
  if (distance(ta,tb) <= epsilon && !trim) throw Error('尖角需要修剪或延长原边');
  const arc = spec.kind === 'fillet' && distances[0] > epsilon ? (() => {
    const radius = spec.radius ?? distances[0]*Math.tan(half);
    const center = add(vertex,scale(unit(add(first.dir,second.dir)),radius/Math.sin(half)));
    return {center,...minorArc(center,ta,tb)};
  })() : undefined;
  return writeCorner(doc,a,b,first.end,second.end,ta,tb,role,trim,preview,arc);
}

type End = 'startPoint' | 'endPoint';
function parallelEnd(line: ReturnType<typeof lineGeometry>, axis: Vec2, atHighEnd: boolean): End {
  return (dot(line.d,axis)>0) === atHighEnd ? 'endPoint' : 'startPoint';
}
function writeCorner(doc: GeometryDocument, a: Segment, b: Segment, aEnd: End, bEnd: End,
    ta: Vec2, tb: Vec2, role: CadRole, trim: boolean, preview: boolean,
    arc?: {center:Vec2;radius:number;startAngle:number;sweep:number}) {
  const sharp = distance(ta,tb) <= epsilon;
  return cadMutation(doc,role,preview,new Set([a.id,b.id]),d=>{
    const base = {viewId:a.viewId, layerId:a.layerId, lineStyle:a.lineStyle,
      ...(a.appearance ? {appearance:a.appearance} : {})};
    let start: string | undefined, end: string | undefined;
    const oldNodes = new Set<string>();
    if (trim) for (const [source, key, p] of [[a,aEnd,ta],[b,bEnd,tb]] as const) {
      const edge=d.entities.find(e=>e.id===source.id);
      if (edge?.kind !== 'segment') throw Error('倒角边不存在');
      const old=edge[key], node=d.entities.find(e=>e.id===old)!;
      if (!editable(doc,node,role) ||
        doc.constraints.some(r=>r.entityIds[0]===old&&r.mode==='BINDING') ||
        doc.referenceRelations?.some(r=>r.targetId===old&&r.mode==='BINDING'))
          throw Error('角点受题干或绑定保护，请先解除连接');
      edge[key]=(sharp && start) || addNode(d,source,p);
      oldNodes.add(old);
      if (source.id===a.id) start=edge[key];
      else end=edge[key];
    }
    if (arc) {
      const {center,...geometry}=arc;
      d.entities.push({...base,kind:'arc',id:createId(),center:addNode(d,a,center),...geometry});
    } else if (!sharp) {
      d.entities.push({...base,kind:'segment',id:createId(),startPoint:start ?? addNode(d,a,ta),endPoint:end ?? addNode(d,b,tb)});
    }
    removeUnusedControlPoints(d,oldNodes,role);
  });
}
