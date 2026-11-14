import type { GeometryDocument, Vec2 } from '@tuheng/contracts';
import { pointReferences, editable } from './document';
import { sheetDeltaToLocal } from './sheet';
import { add } from './math';
import { evaluateDependencies } from './dependencies';
// Trusted in-memory input only. No Schema, serialization, history or export in a pointer preview.
export function previewTransform(
  base: GeometryDocument,
  ids: string[],
  delta: Vec2,
  role: 'teacher' | 'student',
): GeometryDocument {
  const targets = new Set(ids);
  for (const e of base.entities)
    if (targets.has(e.id)) for (const id of pointReferences(e)) targets.add(id);
  const next: GeometryDocument = {
    ...base,
    entities: base.entities.map((e) => ({ ...e })),
    constraints: base.constraints.map((c) => ({ ...c })),
    auxiliarySystems: base.auxiliarySystems?.map((a) => ({ ...a })),
    referenceRelations: base.referenceRelations?.map((r) => ({ ...r })),
  };
  for (const e of next.entities)
    if (targets.has(e.id)) {
      if (!editable(base, e, role)) throw Error('移动涉及只读题干；请先显式解除连接');
      if (
        base.referenceRelations?.some(
          (r) => r.mode === 'BINDING' && r.targetId === e.id && r.kind !== 'POINT_ON_REFERENCE',
        )
      )
        throw Error('对象由关系驱动，请先解除绑定');
      const d = sheetDeltaToLocal(base, e.viewId, delta);
      if (e.kind === 'point') {
        e.position = add(e.position, d);
        e.spatial = null;
      }
      if (e.kind === 'line') e.anchor = add(e.anchor, d);
      if (e.kind === 'polyline') e.points = e.points.map((p) => add(p, d));
      if ('samples' in e && e.samples)
        e.samples = e.samples.map((p) => ({ ...add(p, d), pressure: p.pressure }));
    }
  evaluateDependencies(next);
  return next;
}
