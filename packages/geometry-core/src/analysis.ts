import { localToSheet } from './sheet';
import { changedPlaneProjection } from './projection-systems';
import { evaluateDependencies } from './dependencies';
import type { GeometryDocument, GeometryEntity, GeometryRelation } from '@tuheng/contracts';
import {
  angle,
  distance,
  foot,
  intersect,
  lineGeometry,
  parallel,
  perpendicular,
  point,
  sub,
  length,
  add,
  scale,
} from './math';
import { editorRegistry } from './projections';
import { serializeGeometryDocument } from './document';
export function analyzeGeometryDocument(doc: GeometryDocument): GeometryRelation[] {
  const relations: GeometryRelation[] = [];
  const tolerance = doc.settings.tolerance;
  const record = (
    kind: GeometryRelation['kind'],
    entityIds: string[],
    deviation: number | null,
    description: string,
  ) => {
    if (relations.length < 3000)
      relations.push({
        id: `${kind}.${entityIds.join('.')}`,
        kind,
        entityIds,
        source: 'COMPUTED',
        tolerance,
        deviation,
        description,
      });
  };
  const lines = doc.entities.filter((e) => e.kind === 'segment' || e.kind === 'line');
  for (let i = 0; i < lines.length; i++) {
    const first = lines[i],
      a = lineGeometry(doc, first);
    for (const second of lines.slice(i + 1).filter((e) => e.viewId === first.viewId)) {
      const b = lineGeometry(doc, second),
        ids = [first.id, second.id];
      if (parallel(a.d, b.d)) {
        record('PARALLEL', ids, null, '方向在 0.001 弧度容差内近似平行');
        if (distance(a.a, foot(a.a, { ...b, finite: false })) <= tolerance)
          record('COLLINEAR', ids, null, '在距离容差内近似共线');
      }
      if (perpendicular(a.d, b.d))
        record('PERPENDICULAR', ids, null, '方向在 0.001 弧度容差内近似垂直');
      const p = intersect(a, b);
      if (p) record('INTERSECTION', ids, 0, `交点 (${p.x.toFixed(3)}, ${p.y.toFixed(3)}) mm`);
    }
    for (const e of doc.entities.filter((e) => e.viewId === first.viewId)) {
      if (e.kind === 'point' && distance(e.position, foot(e.position, a)) <= tolerance)
        record(
          'POINT_ON_LINE',
          [e.id, first.id],
          distance(e.position, foot(e.position, a)),
          '点位于线的距离容差内',
        );
      if (e.kind === 'circle') {
        const center = point(doc, e.center);
        const perpendicularFoot = foot(center, { ...a, finite: false });
        const residual = Math.abs(distance(center, perpendicularFoot) - e.radius);
        if (residual <= tolerance && distance(perpendicularFoot, foot(center, a)) <= tolerance)
          record('TANGENT', [e.id, first.id], residual, '圆与线在距离容差内近似相切');
      }
      if (e.kind === 'point' && a.finite) {
        const deviation = distance(e.position, add(a.a, scale(a.d, 0.5)));
        if (deviation <= tolerance)
          record('MIDPOINT', [e.id, first.id], deviation, '点位于线段中点容差内');
      }
    }
  }
  for (const group of doc.projectionGroups) {
    const members = group.entityIds.map((id) => doc.entities.find((e) => e.id === id)!);
    for (let i = 0; i < members.length; i++)
      for (const other of members.slice(i + 1)) {
        const first = members[i],
          v = doc.views.find((v) => v.id === first.viewId)!,
          w = doc.views.find((v) => v.id === other.viewId)!;
        if (doc.editorType === 'ISOMETRIC' || doc.editorType === 'OBLIQUE_DIMETRIC') continue;
        const coordinates = (e: GeometryEntity) =>
          e.kind === 'point'
            ? [e.position]
            : e.kind === 'segment'
              ? [point(doc, e.startPoint), point(doc, e.endPoint)]
              : [];
        if (doc.auxiliarySystems?.some((a) => [v.id, w.id].includes(a.newViewId))) continue;
        for (const axis of v.mapping.filter((a) => w.mapping.includes(a))) {
          const vi = v.mapping.indexOf(axis),
            wi = w.mapping.indexOf(axis);
          const a = coordinates(first)
            .map((p) => (vi === 0 ? p.x : p.y) * v.signs[vi])
            .sort((a, b) => a - b);
          const b = coordinates(other)
            .map((p) => (wi === 0 ? p.x : p.y) * w.signs[wi])
            .sort((a, b) => a - b);
          const deviation = Math.max(...a.map((value, i) => Math.abs(value - b[i])));
          record(
            'PROJECTION_ALIGNMENT',
            [first.id, other.id],
            deviation,
            `${v.name} 与 ${w.name} 的 ${axis} 坐标偏差 ${deviation.toFixed(3)} mm`,
          );
        }
      }
  }
  for (const axis of doc.auxiliarySystems ?? [])
    for (const group of doc.projectionGroups.filter((g) => g.kind === 'POINT')) {
      const members = group.entityIds.map((id) => doc.entities.find((e) => e.id === id)!);
      const retained = members.find((e) => e.viewId === axis.retainedViewId),
        replaced = members.find((e) => e.viewId === axis.replacedViewId),
        next = members.find((e) => e.viewId === axis.newViewId);
      if (retained?.kind !== 'point' || replaced?.kind !== 'point' || next?.kind !== 'point')
        continue;
      const expected = changedPlaneProjection(
          localToSheet(doc, retained.viewId, retained.position),
          localToSheet(doc, replaced.viewId, replaced.position),
          axis,
        ),
        actual = localToSheet(doc, next.viewId, next.position),
        deviation = distance(expected, actual);
      record(
        'PROJECTION_ALIGNMENT',
        [retained.id, replaced.id, next.id],
        deviation,
        `换面 ${axis.name} 实际偏差 ${deviation.toFixed(3)} mm`,
      );
    }
  return relations;
}
export function exportGeometryNarrative(
  doc: GeometryDocument,
  relations = analyzeGeometryDocument(doc),
) {
  doc = structuredClone(doc);
  evaluateDependencies(doc, { resolveBindings: false });
  const referenceDescriptions = (doc.referenceRelations ?? []).map(
    (r) =>
      `参考关系 ${r.id}：对象 ${r.targetId}，${r.kind}，参考 ${JSON.stringify(r.reference)}，${r.mode === 'BINDING' ? '持续有向绑定' : '本次定位/方向调整'}，实际校验 ${r.status}。`,
  );
  const lines = [
    ...referenceDescriptions,
    `${editorRegistry[doc.editorType].name}，单位 mm。计算距离容差 ${doc.settings.tolerance} mm。`,
  ];
  if (relations.length === 3000)
    lines.push('计算关系达到 3000 条上限，以下仅列出部分关系。原始几何对象完整保留。');
  for (const a of doc.auxiliarySystems ?? [])
    lines.push(
      `换面轴 ${a.name}（${a.id}），保留 ${a.retainedViewId}，替换 ${a.replacedViewId}，新面 ${a.newViewId}，轴锚点 ${JSON.stringify(a.anchor)}，切向 ${JSON.stringify(a.tangent)}，正法向 ${JSON.stringify(a.positiveNormal)}；参考方向当前校验 ${a.referenceStatus ?? 'UNVERIFIED'}；创建轴不代表已完成投影。`,
    );
  for (const e of doc.entities) {
    const prefix = `${e.id}（${doc.views.find((v) => v.id === e.viewId)?.name}，${e.lineStyle}）`;
    if (e.kind === 'point')
      lines.push(
        `${prefix} 点 ${e.name}，局部坐标 (${e.position.x}, ${e.position.y})，图纸坐标 ${JSON.stringify(localToSheet(doc, e.viewId, e.position))}，空间坐标${e.spatial ? JSON.stringify(e.spatial) : '未知'}。`,
      );
    if (e.kind === 'segment') {
      const d = sub(point(doc, e.endPoint), point(doc, e.startPoint));
      lines.push(
        `${prefix} 连接 ${e.startPoint} 与 ${e.endPoint}，长 ${length(d).toFixed(3)} mm，角度 ${angle(d).toFixed(3)}°。`,
      );
    }
    if (e.kind === 'line')
      lines.push(
        `${prefix} 无限辅助线，锚点 (${e.anchor.x}, ${e.anchor.y})，方向 (${e.direction.x}, ${e.direction.y})。`,
      );
    if (e.kind === 'circle' || e.kind === 'arc')
      lines.push(
        `${prefix} ${e.kind === 'circle' ? '圆' : '圆弧'}，圆心 ${e.center}，半径 ${e.radius} mm${e.kind === 'arc' ? `，起始角 ${e.startAngle}°，有向扫角 ${e.sweep}°，弧长 ${(((Math.abs(e.sweep) * Math.PI) / 180) * e.radius).toFixed(3)} mm` : ''}。`,
      );
    if (e.kind === 'curve')
      lines.push(
        `${prefix} 三次 Hermite 插值曲线，依次穿过 ${e.pointIds.join('、')}；端点 ${e.pointIds[0]} 与 ${e.pointIds.at(-1)}，局部坐标与实际点引用一致。`,
      );
    if (e.kind === 'polyline') lines.push(`${prefix} 未拟合笔迹，共 ${e.points.length} 个轨迹点。`);
    if (e.kind === 'plane')
      lines.push(
        `${prefix} 投影面，原点 ${JSON.stringify(e.origin)}，法向 ${JSON.stringify(e.normal)}。`,
      );
  }
  for (const c of doc.constraints)
    lines.push(
      `${c.source === 'USER' ? '用户显式关系' : '用户确认吸附'} ${c.kind}，对象 ${c.entityIds.join('、')}，当前校验 ${c.status ?? 'UNVERIFIED'}（声明关系不代表实际满足）。`,
    );
  for (const g of doc.projectionGroups)
    lines.push(`用户投影关联 ${g.id}，对象 ${g.entityIds.join('、')}。`);
  for (const r of relations) lines.push(`计算关系 ${r.entityIds.join('、')}，${r.description}。`);
  return lines.join('\n');
}
export function exportGeometryBundle(doc: GeometryDocument) {
  const document = JSON.parse(serializeGeometryDocument(doc)) as GeometryDocument;
  const derivedRelations = analyzeGeometryDocument(document);
  return {
    document,
    derivedRelations,
    narrative: exportGeometryNarrative(document, derivedRelations),
  };
}
export const exportGeometryJson = serializeGeometryDocument;
