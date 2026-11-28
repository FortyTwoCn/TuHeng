import {
  hatchRing,
  type GeometryDocument,
  type GeometryEntity,
  type Vec2,
} from '@tuheng/contracts';
import { add, sub, angle, distance, cross, length, unit, dot, arcPoint } from './math';
import { cadLength, cadNumber, cadPolygonSides, cadText } from './cad-input';
import { angleMeasurement, automaticLinearAxis } from './cad-dimensions';
import { readRoughnessDetails } from './engineering-parameters';
import type { CadSession } from './cad-registry';

const epsilon = 1e-8;
const mod360 = (a: number) => ((a % 360) + 360) % 360;
function sweep(start: number, end: number, direction: string) {
  const ccw = mod360(end - start);
  if (ccw < 1e-7 || 360 - ccw < 1e-7) throw Error('圆弧起止方向不能重合');
  if (direction === '顺时针') return ccw - 360;
  return direction === '逆时针' || ccw <= 180 ? ccw : ccw - 360;
}
function throughThree(a: Vec2, b: Vec2, c: Vec2) {
  const u = sub(b, a),
    v = sub(c, a),
    denominator = 2 * cross(u, v);
  if (Math.abs(denominator) < epsilon * Math.max(1, length(u) * length(v)))
    throw Error('三个圆弧点重合或共线');
  const center = add(a, {
    x: (v.y * dot(u, u) - u.y * dot(v, v)) / denominator,
    y: (u.x * dot(v, v) - v.x * dot(u, u)) / denominator,
  });
  const startAngle = angle(sub(a, center)),
    end = angle(sub(c, center)),
    mid = angle(sub(b, center));
  const ccw = mod360(end - startAngle);
  return {
    center,
    startAngle,
    sweep: mod360(mid - startAngle) < ccw ? ccw : ccw - 360,
    radius: distance(center, a),
  };
}
function boundaryLoops(doc: GeometryDocument, ids: string[], viewId: string) {
  type Segment = Extract<GeometryEntity, { kind: 'segment' }>;
  const rings: string[][] = [],
    edges: Segment[] = [];
  for (const id of ids) {
    const e = doc.entities.find((item) => item.id === id);
    if (!e || e.viewId !== viewId) throw Error('请选择同一投影中的闭合边界');
    if (e.kind === 'circle' || (e.kind === 'ellipse' && Math.abs(e.sweep) === 360))
      rings.push([id]);
    else if (e.kind === 'segment') edges.push(e);
    else throw Error('边界需要完整圆、椭圆或相连的线段');
  }
  const incident = new Map<string, Segment[]>();
  for (const e of edges)
    for (const p of [e.startPoint, e.endPoint]) {
      const list = incident.get(p) ?? [];
      list.push(e);
      incident.set(p, list);
    }
  const remaining = new Set(edges);
  while (remaining.size) {
    const seed = remaining.values().next().value!;
    const part: Segment[] = [seed];
    remaining.delete(seed);
    for (let i = 0; i < part.length; i++)
      for (const p of [part[i].startPoint, part[i].endPoint])
        for (const e of incident.get(p)!) if (remaining.delete(e)) part.push(e);
    if (!hatchRing(part).length) throw Error('线段边界未闭合，或选中了相邻区域的公共边');
    rings.push(part.map((e) => e.id));
  }
  if (!rings.length) throw Error('请先选择剖面边界');
  return rings;
}
/** Produce only candidate entities. The same geometry is passed to validation on confirmation. */
export function cadPrimitiveEntities(
  doc: GeometryDocument,
  s: CadSession,
  pickedNodes?: Map<number, string>,
): GeometryEntity[] {
  const { points, pointIds, parameters: p, commandId: cmd, viewId } = s;
  const [a, b, c] = points;
  const role =
    s.role === 'teacher' ? 'PROBLEM_STEM' : cmd === 'line' ? 'CONSTRUCTION' : 'STUDENT_ANSWER';
  const layer = doc.layers.find((l) => l.role === role);
  if (!layer) throw Error('当前图纸缺少可编辑图层');
  const lineStyle: GeometryEntity['lineStyle'] =
    s.role === 'teacher'
      ? s.appearance?.pattern === 'DASHED'
        ? 'PROBLEM_HIDDEN'
        : 'PROBLEM_VISIBLE'
      : cmd === 'line'
        ? 'CONSTRUCTION'
        : s.appearance?.pattern === 'DASHED'
          ? 'ANSWER_HIDDEN'
          : 'ANSWER_VISIBLE';
  const base = {
    viewId,
    layerId: layer.id,
    lineStyle,
    ...(s.appearance ? { appearance: s.appearance } : {}),
  };
  const created: GeometryEntity[] = [];
  const id = () => s.prefix + '-' + created.length;
  function node(position: Vec2, sourceIndex?: number, visible = false) {
    const sourceId = sourceIndex === undefined ? undefined : pointIds[sourceIndex];
    if (sourceId) {
      const existing = doc.entities.find((e) => e.id === sourceId);
      if (
        existing?.kind === 'point' &&
        existing.viewId === viewId &&
        distance(existing.position, position) < epsilon
      )
        return existing.id;
    }
    const next = id();
    if (sourceIndex !== undefined) pickedNodes?.set(sourceIndex, next);
    created.push({
      ...base,
      id: next,
      kind: 'point',
      position,
      spatial: null,
      labelVisible: visible,
      name: 'P' + (doc.entities.length + created.length + 1),
    });
    return next;
  }
  function ring(corners: Vec2[], indices: (number | undefined)[]) {
    const nodes = corners.map((q, i) => node(q, indices[i]));
    for (let i = 0; i < nodes.length; i++)
      created.push({
        ...base,
        id: id(),
        kind: 'segment',
        startPoint: nodes[i],
        endPoint: nodes[(i + 1) % nodes.length],
      });
  }
  const optionalRadius = () => (p.radius?.trim() ? cadLength(p.radius, '半径') : undefined);
  switch (cmd) {
    case 'point':
      node(a, 0, true);
      break;
    case 'connect':
    case 'segment':
    case 'line': {
      if (distance(a, b) < epsilon) throw Error('线的两个点不能重合');
      if (cmd === 'line')
        created.push({
          ...base,
          id: id(),
          kind: 'line',
          anchor: a,
          direction: unit(sub(b, a)),
          scope: role === 'CONSTRUCTION' ? 'SHEET' : 'VIEW',
          referenceEntityId: null,
        });
      else {
        const startPoint = node(a, 0),
          endPoint = node(b, 1);
        created.push({ ...base, id: id(), kind: 'segment', startPoint, endPoint });
      }
      break;
    }
    case 'rectangle': {
      if (Math.abs(a.x - b.x) < epsilon || Math.abs(a.y - b.y) < epsilon)
        throw Error('矩形的宽、高不能为零');
      ring([a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }], [0, undefined, 1, undefined]);
      break;
    }
    case 'polygon': {
      const count = cadPolygonSides(p.sides);
      const inscribed = p.mode !== '外切于圆';
      const r = optionalRadius() ?? distance(a, b),
        theta = angle(sub(b, a));
      if (r < epsilon) throw Error('多边形半径必须大于零');
      const R = inscribed ? r : r / Math.cos(Math.PI / count);
      ring(
        Array.from({ length: count }, (_, i) =>
          arcPoint(a, R, theta + ((i + (inscribed ? 0 : 0.5)) * 360) / count),
        ),
        Array.from({ length: count }, (_, i) => (i === 0 && inscribed ? 1 : undefined)),
      );
      break;
    }
    case 'circle':
    case 'arc':
    case 'compass':
    case 'arc3': {
      if (cmd === 'arc3') {
        const { center, ...rest } = throughThree(a, b, c);
        const centerId = node(center);
        created.push({ ...base, id: id(), kind: 'arc', center: centerId, ...rest });
        break;
      }
      const r =
        cmd === 'compass' ? cadLength(p.opening, '开度') : (optionalRadius() ?? distance(a, b));
      if (r < epsilon) throw Error('圆半径必须大于零');
      const center = node(a, 0);
      if (cmd === 'circle') created.push({ ...base, id: id(), kind: 'circle', center, radius: r });
      else if (cmd === 'compass' && !c) {
        if (distance(a,b) < epsilon) throw Error('请指定短弧方向');
        const span = Math.min(179.9, (r < 50 ? 25 : 50) * 45 / r);
        const direction = angle(sub(b,a)) - span/2;
        created.push({...base,id:id(),kind:'arc',center,radius:r,startAngle:((direction+540)%360)-180,sweep:span});
      } else {
        if (distance(a, b) < epsilon || distance(a, c) < epsilon)
          throw Error('弧方向点不能位于圆心');
        const startAngle = angle(sub(b, a));
        created.push({
          ...base,
          id: id(),
          kind: 'arc',
          center,
          radius: r,
          startAngle,
          sweep: sweep(startAngle, angle(sub(c, a)), p.direction),
        });
      }
      break;
    }
    case 'ellipse': {
      const first = p.majorRadius?.trim() ? cadLength(p.majorRadius, '长半轴') : distance(a, b);
      if (first < epsilon) throw Error('轴端点不能与椭圆中心重合');
      const axis = unit(sub(b, a));
      const second = p.minorRadius?.trim()
        ? cadLength(p.minorRadius, '短半轴') : Math.abs(cross(axis, sub(c, a)));
      if (second < epsilon) throw Error('第二轴长度须大于零');
      if (p.majorRadius?.trim() && p.minorRadius?.trim() && second > first)
        throw Error('短半轴不可大于长半轴');
      const center = node(a, 0);
      created.push({
        ...base,
        id: id(),
        kind: 'ellipse',
        center,
        majorRadius: Math.max(first, second),
        minorRadius: Math.min(first, second),
        angle: angle(first >= second ? axis : { x: -axis.y, y: axis.x }),
        startAngle: 0,
        sweep: 360,
      });
      break;
    }
    case 'spline': {
      if (points.length < 2 || points.length > 128) throw Error('样条需要 2 至 128 个经过点');
      if (points.some((q, i) => i > 0 && distance(q, points[i - 1]) < epsilon))
        throw Error('相邻插值点不能重合');
      const ids = points.map((q, i) => node(q, i));
      if (ids.length === 2) {
        created.push({ ...base, id: id(), kind: 'segment', startPoint: ids[0], endPoint: ids[1] });
        break;
      }
      created.push({
        ...base,
        id: id(),
        kind: 'curve',
        interpolation: 'QUADRATIC_BSPLINE',
        pointIds: ids,
      });
      break;
    }
    case 'hatch':
      created.push({
        ...base,
        id: id(),
        kind: 'hatch',
        origin: { x: 0, y: 0 },
        angle: cadNumber(p.angle, '角度', '°'),
        spacing: cadLength(p.spacing, '间距'),
        loops: s.hatchSpans?.map(spans=>[...new Set(spans.map(span=>span.entityId))]) ?? boundaryLoops(doc, s.ids, viewId),
        ...(s.hatchSpans ? {spans:s.hatchSpans} : {}),
      });
      break;
    case 'linearDimension':
    case 'alignedDimension':
    case 'angularDimension':
    case 'radiusDimension':
    case 'diameterDimension': {
      const radial = cmd === 'radiusDimension' || cmd === 'diameterDimension';
      const types = {
        linearDimension: 'LINEAR',
        alignedDimension: 'ALIGNED',
        angularDimension: 'ANGULAR',
        radiusDimension: 'RADIUS',
        diameterDimension: 'DIAMETER',
      } as const;
      const twoLines = cmd === 'angularDimension' && s.ids.length === 2;
      const position = points.at(-1)!;
      if (twoLines) angleMeasurement(doc,s.ids,position);
      const referenceIds = radial || twoLines ? s.ids : points.slice(0, -1).map((q, i) => node(q, i));
      const code=p.toleranceCode.trim(), upper=p.toleranceUpper.trim(), lower=p.toleranceLower.trim();
      created.push({
        ...base,
        id: id(),
        kind: 'dimension',
        dimensionType: types[cmd],
        referenceIds,
        position,
        ...(cmd === 'linearDimension'
          ? { linearAxis: p.linearAxis==='X'||p.linearAxis==='Y' ? p.linearAxis : automaticLinearAxis(a,b,position) }
          : {}),
        ...(code || upper || lower ? {tolerance:{code,upper,lower,showCode:!!code,showDeviation:!!(upper||lower)}} : {}),
        precision: cadNumber(p.precision, '小数位数'),
        textSize: cadLength(p.size, '字高'),
        textOverride: p.textOverride,
        arrowStyle: p.arrowStyle === '开放' ? 'OPEN' : 'CLOSED',
      });
      break;
    }
    default: {
      const textBase = {
        ...base,
        id: id(),
        position: a,
        size: cadLength(p.size, '字高'),
        angle: cadNumber(p.angle || '0', '方向角', '°'),
      };
      if (cmd === 'text') {
        created.push({ ...textBase, kind: 'text', content: cadText(p.content) });
      } else if (cmd === 'direction' || cmd === 'leftDirection' || cmd === 'rightDirection') {
        created.push({
          ...textBase,
          kind: 'symbol',
          label: p.label,
          ...(cmd==='direction' && b && !p.angle.trim() ? {angle:angle(sub(b,a)),arrowLength:distance(a,b)} : {}),
          symbolType:
            cmd === 'direction'
              ? 'DIRECTION'
              : cmd === 'leftDirection'
                ? 'LEFT_ROTATION'
                : 'RIGHT_ROTATION',
        });
      } else if (
        cmd === 'datum' ||
        cmd === 'roughness' ||
        cmd === 'toleranceFrame' ||
        cmd === 'toleranceText'
      ) {
        const values = {
          datum: [p.content],
          roughness: [p.content],
          toleranceFrame: [p.characteristic, p.tolerance, p.datum],
          toleranceText: [p.nominal, p.upper, p.lower],
        };
        const types = {
          datum: 'DATUM',
          roughness: 'ROUGHNESS',
          toleranceFrame: 'GEOMETRIC_TOLERANCE',
          toleranceText: 'TOLERANCE_TEXT',
        } as const;
        created.push({
          ...textBase,
          kind: 'engineeringAnnotation',
          ...(b ? {leader:a, position:b} : {}),
          annotationType: types[cmd],
          fields: cmd === 'toleranceText' ? values[cmd] : values[cmd].filter((v) => v?.trim()),
          ...(cmd === 'roughness'
            ? {
                roughnessDetails: readRoughnessDetails(p),
                roughnessMode:
                  p.mode === '去除材料'
                    ? 'REMOVAL_REQUIRED'
                    : p.mode === '不去除材料'
                      ? 'REMOVAL_PROHIBITED'
                      : 'BASIC',
              }
            : {}),
        });
      } else throw Error('未知绘图命令');
    }
  }
  return created;
}
