import type { GeometryDocument, GeometryTargetRef, GeometryEntity, Vec2 } from '@tuheng/contracts';
import { transact, editable, pointReferences } from './document';
import { addDrawing, setLineStyle } from './tools';
import { add, sub, scale, point, angle, length, lineGeometry } from './math';
import { referenceDirection, writeReferenceRelation } from './reference-relations';
export type FixedEnd = 'start' | 'end' | 'midpoint';
export interface ConstructionSpec {
  directionMode: 'PARALLEL' | 'PERPENDICULAR';
  geometryExtent: 'line' | 'segment';
  semanticStyle: 'visible' | 'hidden';
  length: number;
}
export function constructLine(
  doc: GeometryDocument,
  viewId: string,
  ref: GeometryTargetRef,
  position: Vec2,
  pointId: string | undefined,
  spec: ConstructionSpec,
  role: 'teacher' | 'student',
) {
  if (!Number.isFinite(spec.length) || spec.length <= 0) throw Error('长度必须大于零');
  const d = referenceDirection(doc, viewId, ref, spec.directionMode);
  const next = addDrawing(
    doc,
    spec.geometryExtent === 'line'
      ? 'line'
      : spec.semanticStyle === 'hidden'
        ? 'hidden'
        : 'segment',
    viewId,
    [position, add(position, scale(d, spec.length))],
    role,
    undefined,
    pointId ? [pointId] : undefined,
  );
  return transact(
    next,
    (draft) => {
      const created = draft.entities.at(-1)!;
      writeReferenceRelation(draft, created.id, ref, spec.directionMode, 'POSITION');
      if (pointId && created.kind === 'line')
        writeReferenceRelation(
          draft,
          created.id,
          { kind: 'entity', entityId: pointId },
          'THROUGH_POINT',
          created.lineStyle.startsWith('PROBLEM') ? 'POSITION' : 'BINDING',
        );
    },
    role,
  );
}
export function assertIndependentEndpoint(
  doc: GeometryDocument,
  id: string,
  ownerId: string,
  role: 'teacher' | 'student',
) {
  const p = doc.entities.find((e) => e.id === id);
  if (!p || !editable(doc, p, role)) throw Error('端点为只读锚点；请选择固定该端，或显式解除连接');
  const incident = doc.entities.filter((e) => e.id !== ownerId && pointReferences(e).includes(id));
  if (incident.length) throw Error(`端点被 ${incident.length} 个相邻对象共享；请先明确解除连接`);
  if (
    doc.referenceRelations?.some(
      (r) => r.mode === 'BINDING' && (r.targetId === id || r.targetId === ownerId),
    ) ||
    doc.constraints.some((c) => c.mode === 'BINDING' && c.entityIds[0] === id)
  )
    throw Error('端点受绑定控制，请先解除绑定');
}
export function setSegmentParameters(
  doc: GeometryDocument,
  id: string,
  size: number,
  degrees: number,
  fixed: FixedEnd,
  role: 'teacher' | 'student',
) {
  const e = doc.entities.find((e) => e.id === id);
  if (e?.kind !== 'segment' || !editable(doc, e, role)) throw Error('请选择可编辑线段');
  if (!Number.isFinite(size) || size <= 0 || !Number.isFinite(degrees))
    throw Error('请输入有效的正长度和角度');
  const a = point(doc, e.startPoint),
    b = point(doc, e.endPoint),
    v = {
      x: size * Math.cos((degrees * Math.PI) / 180),
      y: size * Math.sin((degrees * Math.PI) / 180),
    };
  const start =
    fixed === 'start' ? a : fixed === 'end' ? sub(b, v) : sub(scale(add(a, b), 0.5), scale(v, 0.5));
  const end = add(start, v);
  if (fixed !== 'start') assertIndependentEndpoint(doc, e.startPoint, e.id, role);
  if (fixed !== 'end') assertIndependentEndpoint(doc, e.endPoint, e.id, role);
  return transact(
    doc,
    (d) => {
      for (const [id, position] of [
        [e.startPoint, start],
        [e.endPoint, end],
      ] as const) {
        const p = d.entities.find((e) => e.id === id);
        if (p?.kind === 'point' && (p.position.x !== position.x || p.position.y !== position.y)) {
          p.position = position;
          p.spatial = null;
        }
      }
    },
    role,
  );
}
export function adjustDirection(
  doc: GeometryDocument,
  targetId: string,
  reference: GeometryTargetRef,
  kind: 'PARALLEL' | 'PERPENDICULAR',
  keep: boolean,
  role: 'teacher' | 'student',
) {
  const e = doc.entities.find((e) => e.id === targetId);
  if (!e || !editable(doc, e, role) || !['segment', 'line'].includes(e.kind))
    throw Error('待修改对象必须是可编辑线');
  let d = referenceDirection(doc, e.viewId, reference, kind);
  const l = lineGeometry(doc, e);
  if (d.x * l.d.x + d.y * l.d.y < 0) d = scale(d, -1);
  let next = doc;
  if (e.kind === 'segment')
    next = setSegmentParameters(doc, e.id, length(l.d), angle(d), 'start', role);
  else
    next = transact(
      doc,
      (v) => {
        const e = v.entities.find((e) => e.id === targetId);
        if (e?.kind === 'line') e.direction = d;
      },
      role,
    );
  return transact(
    next,
    (d) => writeReferenceRelation(d, targetId, reference, kind, keep ? 'BINDING' : 'POSITION'),
    role,
  );
}
export function bindToReference(
  doc: GeometryDocument,
  id: string,
  reference: GeometryTargetRef,
  role: 'teacher' | 'student',
) {
  const p = doc.entities.find((e) => e.id === id);
  if (p?.kind !== 'point' || !editable(doc, p, role)) throw Error('请选择可编辑点');
  return transact(
    doc,
    (d) => writeReferenceRelation(d, id, reference, 'POINT_ON_REFERENCE', 'BINDING'),
    role,
  );
}
export function unbindReferences(doc: GeometryDocument, id: string, role: 'teacher' | 'student') {
  const e = doc.entities.find((e) => e.id === id);
  if (!e || !editable(doc, e, role)) throw Error('题干关系只读');
  return transact(
    doc,
    (d) => {
      d.referenceRelations = d.referenceRelations?.filter(
        (r) => r.targetId !== id || r.mode !== 'BINDING',
      );
      d.constraints = d.constraints.filter((c) => c.mode !== 'BINDING' || c.entityIds[0] !== id);
    },
    role,
  );
}
export function propertyValues(doc: GeometryDocument, e: GeometryEntity): Record<string, string> {
  const common = { style: e.lineStyle };
  if (e.kind === 'point')
    return { ...common, name: e.name, u: String(e.position.x), v: String(e.position.y) };
  if (e.kind === 'line' || e.kind === 'segment') {
    const l = lineGeometry(doc, e);
    return {
      ...common,
      angle: String(angle(l.d)),
      ...(e.kind === 'segment'
        ? { length: String(length(l.d)), fixed: 'start' }
        : { u: String(l.a.x), v: String(l.a.y) }),
    };
  }
  if (e.kind === 'circle' || e.kind === 'arc')
    return {
      ...common,
      radius: String(e.radius),
      u: String(point(doc, e.center).x),
      v: String(point(doc, e.center).y),
      ...(e.kind === 'arc' ? { startAngle: String(e.startAngle), sweep: String(e.sweep) } : {}),
    };
  return common;
}
export function applyProperties(
  doc: GeometryDocument,
  id: string,
  values: Record<string, string>,
  role: 'teacher' | 'student',
) {
  const e = doc.entities.find((e) => e.id === id);
  if (!e || !editable(doc, e, role)) throw Error('对象只读');
  const number = (key: string) => {
    const text = values[key]?.trim();
    if (!text || !Number.isFinite(Number(text))) throw Error('请输入完整的有限数值');
    return Number(text);
  };
  const current = propertyValues(doc, e);
  const geometryChanged = Object.keys(current).some(
    (key) =>
      key !== 'style' &&
      key !== 'fixed' &&
      key !== 'name' &&
      (Number(values[key]) !== Number(current[key]) || !values[key]?.trim()),
  );
  if (
    !geometryChanged &&
    values.style === e.lineStyle &&
    (e.kind !== 'point' || values.name === current.name)
  )
    return doc;
  let next =
    e.kind === 'segment' && geometryChanged
      ? setSegmentParameters(
          doc,
          id,
          number('length'),
          number('angle'),
          values.fixed as FixedEnd,
          role,
        )
      : transact(
          doc,
          (d) => {
            const target = d.entities.find((e) => e.id === id)!;
            if (target.kind === 'point') {
              if (
                geometryChanged &&
                (d.referenceRelations?.some((r) => r.targetId === id && r.mode === 'BINDING') ||
                  d.constraints.some((r) => r.mode === 'BINDING' && r.entityIds[0] === id))
              )
                throw Error('坐标受绑定控制，请先解除绑定');
              target.position = { x: number('u'), y: number('v') };
              target.name = values.name;
              if (geometryChanged) target.spatial = null;
            }
            if (target.kind === 'line' && geometryChanged) {
              if (d.referenceRelations?.some((r) => r.targetId === id && r.mode === 'BINDING'))
                throw Error('方向或锚点受绑定控制，请先解除绑定');
              target.anchor = { x: number('u'), y: number('v') };
              target.direction = {
                x: Math.cos((number('angle') * Math.PI) / 180),
                y: Math.sin((number('angle') * Math.PI) / 180),
              };
            }
            if (target.kind === 'circle' || target.kind === 'arc') {
              const radius = number('radius');
              if (radius <= 0) throw Error('半径必须大于零');
              target.radius = radius;
              const p = d.entities.find((e) => e.id === target.center);
              if (
                p?.kind === 'point' &&
                (p.position.x !== number('u') || p.position.y !== number('v'))
              ) {
                assertIndependentEndpoint(doc, p.id, id, role);
                p.position = { x: number('u'), y: number('v') };
              }
              if (target.kind === 'arc') {
                target.startAngle = number('startAngle');
                const sweep = number('sweep');
                if (!sweep || Math.abs(sweep) > 360) throw Error('扫角须非零且不超过 360°');
                target.sweep = sweep;
              }
            }
          },
          role,
        );
  if (values.style !== e.lineStyle)
    next = setLineStyle(next, id, values.style as GeometryEntity['lineStyle'], role);
  return next;
}
