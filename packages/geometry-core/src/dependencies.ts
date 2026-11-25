import { localToSheet } from './sheet';
import { resolveReference } from './references';
import type { GeometryDocument } from '@tuheng/contracts';
import { lineGeometry, unit, dot, cross, intersect, distance, point, foot } from './math';
import {
  referenceRelationGeometry,
  applyReferenceResult,
  referenceDependencyIds,
} from './reference-relations';
// Position snaps are observations. Only explicit BINDING intersections follow their parents.
export function evaluateDependencies(
  doc: GeometryDocument,
  { resolveBindings = true }: { resolveBindings?: boolean } = {},
) {
  for (const a of doc.auxiliarySystems ?? []) {
    if (a.referenceAxis) {
      const reference = resolveReference(doc, a.referenceAxis).direction!;
      const deviation =
        a.method === 'PARALLEL' ? cross(reference, a.tangent) : dot(reference, a.tangent);
      a.referenceStatus = Math.abs(deviation) < 0.001 ? 'SATISFIED' : 'INVALID';
      continue;
    }
    const e = doc.entities.find((e) => e.id === a.referenceEntityId);
    if (a.method === 'FREE' || !e) {
      a.referenceStatus = 'UNVERIFIED';
      continue;
    }
    const l = lineGeometry(doc, e),
      p = localToSheet(doc, e.viewId, l.a),
      q = localToSheet(doc, e.viewId, { x: l.a.x + l.d.x, y: l.a.y + l.d.y }),
      direction = unit({ x: q.x - p.x, y: q.y - p.y });
    const valid =
      a.method === 'PARALLEL'
        ? Math.abs(cross(direction, a.tangent)) < 0.001
        : Math.abs(dot(direction, a.tangent)) < 0.001;
    a.referenceStatus = valid ? 'SATISFIED' : 'INVALID';
  }
  const bindings = new Map(
    doc.constraints
      .filter((c) => c.mode === 'BINDING' && c.kind === 'INTERSECTION')
      .map((c) => [c.entityIds[0], c]),
  );
  const done = new Set<string>(),
    visiting = new Set<string>();
  const resolve = (id: string) => {
    if (done.has(id)) return;
    if (visiting.has(id)) throw new Error('交点绑定循环');
    visiting.add(id);
    const c = bindings.get(id);
    for (const r of doc.referenceRelations?.filter(
      (r) => r.targetId === id && r.mode === 'BINDING',
    ) ?? []) {
      for (const parent of referenceDependencyIds(doc, r.reference)) resolve(parent);
      const target = doc.entities.find((e) => e.id === id);
      if (target?.kind === 'segment') {
        resolve(target.startPoint);
        resolve(target.endPoint);
      }
      applyReferenceResult(doc, referenceRelationGeometry(doc, r));
    }
    if (c) {
      for (const lineId of c.entityIds.slice(1)) {
        const e = doc.entities.find((e) => e.id === lineId);
        if (e?.kind === 'segment') {
          resolve(e.startPoint);
          resolve(e.endPoint);
        }
      }
      const p = doc.entities.find((e) => e.id === id),
        a = doc.entities.find((e) => e.id === c.entityIds[1]),
        b = doc.entities.find((e) => e.id === c.entityIds[2]);
      if (p?.kind === 'point' && a && b && !p.lineStyle.startsWith('PROBLEM')) {
        const at = intersect(lineGeometry(doc, a), lineGeometry(doc, b));
        if (at) p.position = at;
      }
    }
    visiting.delete(id);
    done.add(id);
  };
  if (resolveBindings) {
    for (const id of bindings.keys()) resolve(id);
    for (const r of doc.referenceRelations ?? []) if (r.mode === 'BINDING') resolve(r.targetId);
  }
  for (const r of doc.referenceRelations ?? [])
    r.status = referenceRelationGeometry(doc, r).valid ? 'SATISFIED' : 'INVALID';
  for (const c of doc.constraints) {
    const e = c.entityIds.map((id) => doc.entities.find((e) => e.id === id)!);
    if (e.some((v) => !v)) continue;
    let valid: boolean | undefined;
    if (['PARALLEL', 'PERPENDICULAR', 'COLLINEAR'].includes(c.kind)) {
      const a = lineGeometry(doc, e[0]),
        b = lineGeometry(doc, e[1]);
      valid =
        c.kind === 'PERPENDICULAR'
          ? Math.abs(dot(unit(a.d), unit(b.d))) < 0.001
          : Math.abs(cross(unit(a.d), unit(b.d))) < 0.001;
      if (c.kind === 'COLLINEAR')
        valid =
          valid && distance(a.a, foot(a.a, { ...b, finite: false })) <= doc.settings.tolerance;
    }
    if (c.kind === 'INTERSECTION' && e[0].kind === 'point') {
      const at = intersect(lineGeometry(doc, e[1]), lineGeometry(doc, e[2]));
      valid = !!at && distance(e[0].position, at) <= doc.settings.tolerance;
    }
    if (c.kind === 'COINCIDENT')
      valid =
        distance(point(doc, c.entityIds[0]), point(doc, c.entityIds[1])) <= doc.settings.tolerance;
    if (['POINT_ON_LINE', 'MIDPOINT'].includes(c.kind) && e[0].kind === 'point') {
      const l = lineGeometry(doc, e[1]),
        at =
          c.kind === 'MIDPOINT'
            ? { x: l.a.x + l.d.x / 2, y: l.a.y + l.d.y / 2 }
            : foot(e[0].position, l);
      valid = distance(at, e[0].position) <= doc.settings.tolerance;
    }
    c.status = valid === undefined ? 'UNVERIFIED' : valid ? 'SATISFIED' : 'INVALID';
  }
}
