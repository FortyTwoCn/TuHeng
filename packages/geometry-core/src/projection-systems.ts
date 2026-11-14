import type { GeometryDocument, ProjectionAxis, Vec2 } from '@tuheng/contracts';
import { add, sub, dot, scale, unit, lineGeometry } from './math';
import { transact } from './document';
import { localToSheet, upgradeGeometryDocument, viewTransform } from './sheet';
export function changedPlaneProjection(
  retained: Vec2,
  replaced: Vec2,
  axis: Pick<ProjectionAxis, 'anchor' | 'tangent' | 'positiveNormal' | 'oldAxis'>,
): Vec2 {
  const q = add(axis.anchor, scale(axis.tangent, dot(sub(retained, axis.anchor), axis.tangent)));
  const d = dot(sub(replaced, axis.oldAxis.anchor), axis.oldAxis.positiveNormal);
  return add(q, scale(axis.positiveNormal, d));
}
export interface AxisConstruction {
  name: string;
  viewName: string;
  retainedViewId: string;
  replacedViewId: string;
  parentId: string | null;
  method: ProjectionAxis['method'];
  referenceEntityId: string | null;
  anchor: Vec2;
  through: Vec2;
  side: 1 | -1;
}
export function suggestAxisNames(doc: GeometryDocument, replacedViewId: string) {
  const view = doc.views.find((v) => v.id === replacedViewId);
  const prefix =
    view?.mapping.join(',') === 'x,y' ? 'H' : view?.mapping.join(',') === 'y,z' ? 'W' : 'V';
  const unused = (prefix: string, names: string[]) => {
    let n = 1;
    while (names.includes(`${prefix}${n}`)) n++;
    return `${prefix}${n}`;
  };
  return {
    name: unused(
      'X',
      (doc.auxiliarySystems ?? []).map((a) => a.name),
    ),
    viewName: unused(
      prefix,
      doc.views.map((v) => v.name),
    ),
  };
}
export function renameProjectionAxis(
  doc: GeometryDocument,
  id: string,
  name: string,
  viewName: string,
  role: 'teacher' | 'student',
) {
  const axis = doc.auxiliarySystems?.find((a) => a.id === id);
  if (!axis || (role === 'student' && axis.owner !== 'STUDENT')) throw new Error('题干轴只读');
  return transact(
    doc,
    (d) => {
      d.auxiliarySystems!.find((a) => a.id === id)!.name = name;
      d.views.find((v) => v.id === axis.newViewId)!.name = viewName;
    },
    role,
  );
}
export function axisDirection(
  doc: GeometryDocument,
  spec: Pick<AxisConstruction, 'method' | 'referenceEntityId' | 'anchor' | 'through'>,
): Vec2 {
  if (spec.method === 'FREE') return unit(sub(spec.through, spec.anchor));
  const e = doc.entities.find((e) => e.id === spec.referenceEntityId);
  if (!e || !['segment', 'line'].includes(e.kind)) throw new Error('请选择保留面中的参考线');
  const l = lineGeometry(doc, e),
    a = localToSheet(doc, e.viewId, l.a),
    b = localToSheet(doc, e.viewId, add(l.a, l.d)),
    d = sub(b, a);
  return unit(spec.method === 'PARALLEL' ? d : { x: -d.y, y: d.x });
}
export function addProjectionAxis(
  input: GeometryDocument,
  spec: AxisConstruction,
  role: 'teacher' | 'student',
) {
  const doc = upgradeGeometryDocument(input);
  if (role === 'student' && !doc.sheet?.allowAuxiliaryViews)
    throw new Error('本题不允许新增换面轴');
  const tangent = axisDirection(doc, spec),
    positiveNormal = { x: -tangent.y * spec.side || 0, y: tangent.x * spec.side || 0 };
  const parent = doc.auxiliarySystems?.find((a) => a.id === spec.parentId);
  let oldAxis: ProjectionAxis['oldAxis'];
  if (parent) {
    oldAxis = {
      anchor: parent.anchor,
      tangent: parent.tangent,
      positiveNormal:
        spec.replacedViewId === parent.newViewId
          ? parent.positiveNormal
          : scale(parent.positiveNormal, -1),
    };
  } else {
    const retained = doc.views.find((v) => v.id === spec.retainedViewId)!,
      replaced = doc.views.find((v) => v.id === spec.replacedViewId)!;
    const common = retained.mapping.find((a) => replaced.mapping.includes(a));
    if (!common || common === 'y') throw new Error('基准换面请选择 V/H 或 V/W 投影系');
    const index = replaced.mapping.indexOf(common),
      f = viewTransform(doc, replaced.id);
    oldAxis = {
      anchor: { x: 0, y: 0 },
      tangent: common === 'x' ? { x: -1, y: 0 } : { x: 0, y: 1 },
      positiveNormal: scale(index === 0 ? f.yAxis : f.xAxis, replaced.signs[index === 0 ? 1 : 0]),
    };
  }
  return transact(
    doc,
    (d) => {
      const id = crypto.randomUUID(),
        newViewId = crypto.randomUUID();
      d.auxiliarySystems!.push({
        id,
        version: 1,
        name: spec.name,
        owner: role === 'teacher' ? 'TEACHER' : 'STUDENT',
        locked: role === 'teacher',
        parentId: spec.parentId,
        retainedViewId: spec.retainedViewId,
        replacedViewId: spec.replacedViewId,
        newViewId,
        anchor: spec.anchor,
        tangent,
        side: spec.side,
        positiveNormal,
        oldAxis,
        method: spec.method,
        referenceEntityId: spec.referenceEntityId,
      });
      d.views.push({
        id: newViewId,
        name: spec.viewName,
        mapping: ['x', 'z'],
        signs: [1, 1],
        transform: { origin: spec.anchor, xAxis: tangent, yAxis: positiveNormal },
      });
    },
    role,
  );
}
export function deleteProjectionAxis(
  doc: GeometryDocument,
  id: string,
  role: 'teacher' | 'student',
) {
  const axis = doc.auxiliarySystems?.find((a) => a.id === id);
  if (!axis) throw new Error('轴不存在');
  if (role === 'student' && axis.owner !== 'STUDENT') throw new Error('题干轴只读');
  const dependents = (doc.auxiliarySystems ?? []).filter((a) => a.parentId === id);
  const objects = doc.entities.filter((e) => e.viewId === axis.newViewId);
  if (dependents.length || objects.length)
    throw new Error(
      `此轴被 ${dependents.length} 个换面和 ${objects.length} 个对象依赖，请先处理依赖`,
    );
  return transact(
    doc,
    (d) => {
      d.auxiliarySystems = d.auxiliarySystems!.filter((a) => a.id !== id);
      d.views = d.views.filter((v) => v.id !== axis.newViewId);
    },
    role,
  );
}
