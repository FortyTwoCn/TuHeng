import type { GeometryDocument, GeometryEntity, Vec2 } from '@tuheng/contracts';
import { transact } from './document';
import { distance, minorArc, point, sub, unit, scale, add, lineGeometry } from './math';
import { viewTransform } from './sheet';
import { PenStrokeRecord } from '@tuheng/contracts';
import { fitStroke, type PenOptions, type PenStrokeStyle } from './pen';
export type DrawingTool =
  | 'point'
  | 'segment'
  | 'hidden'
  | 'line'
  | 'parallel'
  | 'perpendicular'
  | 'parallel-hidden'
  | 'perpendicular-hidden'
  | 'circle'
  | 'arc'
  | 'connect';
export function addDrawing(
  doc: GeometryDocument,
  tool: DrawingTool,
  viewId: string,
  positions: Vec2[],
  role: 'teacher' | 'student',
  referenceId?: string,
  existingIds?: string[],
): GeometryDocument {
  return transact(
    doc,
    (d) => {
      const construction = ['line', 'parallel', 'perpendicular'].includes(tool);
      const roleName =
        role === 'teacher' ? 'PROBLEM_STEM' : construction ? 'CONSTRUCTION' : 'STUDENT_ANSWER';
      const layerId = d.layers.find((l) => l.role === roleName)!.id;
      const lineStyle =
        role === 'teacher'
          ? tool.includes('hidden')
            ? 'PROBLEM_HIDDEN'
            : 'PROBLEM_VISIBLE'
          : construction
            ? 'CONSTRUCTION'
            : tool.includes('hidden')
              ? 'ANSWER_HIDDEN'
              : 'ANSWER_VISIBLE';
      const base = { viewId, layerId, lineStyle } as const;
      function makePoint(p: Vec2, index: number) {
        const existing = existingIds?.[index];
        if (existing) return existing;
        const id = crypto.randomUUID();
        d.entities.push({
          ...base,
          id,
          kind: 'point',
          position: p,
          spatial: null,
          name: `P${d.entities.filter((e) => e.kind === 'point').length + 1}`,
          labelVisible: tool === 'point',
        });
        return id;
      }
      const a = positions[0],
        b = positions[1] ?? add(a, { x: 10, y: 0 });
      if (tool === 'point') {
        makePoint(a, 0);
        return;
      }
      const id = crypto.randomUUID();
      if (tool === 'circle' || tool === 'arc') {
        const center = makePoint(a, 0);
        if (tool === 'circle')
          d.entities.push({ ...base, id, kind: 'circle', center, radius: distance(a, b) });
        else d.entities.push({ ...base, id, kind: 'arc', center, ...minorArc(a, b, positions[2]) });
        return;
      }
      let direction = sub(b, a);
      if (referenceId) {
        const reference = d.entities.find((e) => e.id === referenceId)!;
        direction = lineGeometry(d, reference).d;
        if (tool.startsWith('perpendicular')) direction = { x: -direction.y, y: direction.x };
      }
      if (construction)
        d.entities.push({
          ...base,
          id,
          kind: 'line',
          anchor: a,
          direction: unit(direction),
          referenceEntityId: referenceId ?? null,
          ...(lineStyle === 'CONSTRUCTION' ? { scope: 'SHEET' as const } : {}),
        });
      else
        d.entities.push({
          ...base,
          id,
          kind: 'segment',
          startPoint: makePoint(a, 0),
          endPoint: makePoint(referenceId ? add(a, scale(unit(direction), 10)) : b, 1),
        });
      if (referenceId)
        d.constraints.push({
          id: crypto.randomUUID(),
          kind: tool.startsWith('perpendicular') ? 'PERPENDICULAR' : 'PARALLEL',
          entityIds: [referenceId, id],
          source: 'USER',
        });
    },
    role,
  );
}
function penAppearance(
  doc: GeometryDocument,
  role: 'teacher' | 'student',
  style: PenStrokeStyle = 'visible',
) {
  const layerRole =
    role === 'teacher'
      ? 'PROBLEM_STEM'
      : style === 'construction'
        ? 'CONSTRUCTION'
        : 'STUDENT_ANSWER';
  const lineStyle: GeometryEntity['lineStyle'] =
    role === 'teacher'
      ? style === 'hidden'
        ? 'PROBLEM_HIDDEN'
        : 'PROBLEM_VISIBLE'
      : style === 'construction'
        ? 'CONSTRUCTION'
        : style === 'hidden'
          ? 'ANSWER_HIDDEN'
          : 'ANSWER_VISIBLE';
  return { layerId: doc.layers.find((l) => l.role === layerRole)!.id, lineStyle };
}
export function addRawPenStroke(
  doc: GeometryDocument,
  viewId: string,
  samples: (Vec2 & { pressure: number })[],
  role: 'teacher' | 'student',
  options: PenOptions = { cssPixelsPerMm: 4 },
  id = crypto.randomUUID(),
) {
  return transact(
    doc,
    (d) =>
      d.entities.push({
        ...penAppearance(d, role, options.style),
        id,
        kind: 'polyline',
        viewId,
        points: samples.map((p) => ({ x: p.x, y: p.y })),
        samples,
        sampling: { cssPixelsPerMm: options.cssPixelsPerMm, ...viewTransform(doc, viewId) },
        fitStatus: 'UNFITTED',
      }),
    role,
  );
}
export function addPenStroke(
  doc: GeometryDocument,
  viewId: string,
  samples: (Vec2 & { pressure: number })[],
  role: 'teacher' | 'student',
  options: PenOptions = { cssPixelsPerMm: 4 },
) {
  let fit = fitStroke(samples, options);
  // Apply the existing bounded-noise candidate automatically, using the same
  // classifier and all residual, winding and closure checks. Never force a circle.
  if (fit.kind === 'polyline' && options.noisePixels === undefined)
    fit = fitStroke(samples, { ...options, noisePixels: 3.4 });
  if (fit.kind === 'polyline') return addRawPenStroke(doc, viewId, samples, role, options);
  let next: GeometryDocument;
  if (fit.kind === 'segment') {
    const tool =
      options.style === 'construction' ? 'line' : options.style === 'hidden' ? 'hidden' : 'segment';
    next = addDrawing(doc, tool, viewId, [fit.start, fit.end], role);
  } else {
    next = addDrawing(
      doc,
      'circle',
      viewId,
      [fit.center, { x: fit.center.x + fit.radius, y: fit.center.y }],
      role,
    );
    if (fit.kind === 'arc') {
      const e = next.entities[next.entities.length - 1] as Extract<
        GeometryEntity,
        { kind: 'circle' }
      >;
      next.entities[next.entities.length - 1] = {
        ...e,
        kind: 'arc',
        startAngle: fit.startAngle,
        sweep: fit.sweep,
      };
    }
  }
  const existing = new Set(doc.entities.map((e) => e.id));
  return transact(
    next,
    (d) => {
      for (const e of d.entities) {
        if (!existing.has(e.id)) Object.assign(e, penAppearance(d, role, options.style));
      }
      const e = d.entities[d.entities.length - 1];
      if (e.kind !== 'point' && e.kind !== 'plane') {
        e.samples = samples;
        e.sampling = { cssPixelsPerMm: options.cssPixelsPerMm, ...viewTransform(doc, viewId) };
      }
    },
    role,
  );
}
export function linkProjection(doc: GeometryDocument, ids: string[]) {
  return transact(doc, (d) => {
    const e = d.entities.find((e) => e.id === ids[0]);
    if (e?.kind !== 'point' && e?.kind !== 'segment') throw new Error('投影关联请选择点或线段');
    const related = d.projectionGroups.filter((group) =>
      group.entityIds.some((id) => ids.includes(id)),
    );
    const merged = [...new Set([...ids, ...related.flatMap((group) => group.entityIds)])];
    d.projectionGroups = d.projectionGroups.filter((group) => !related.includes(group));
    d.projectionGroups.push({
      id: crypto.randomUUID(),
      kind: e.kind === 'point' ? 'POINT' : 'SEGMENT',
      entityIds: merged,
      source: 'USER',
    });
  });
}
export function setSegment(
  doc: GeometryDocument,
  id: string,
  size: number,
  degrees: number,
  role: 'teacher' | 'student',
) {
  const e = doc.entities.find((e) => e.id === id);
  if (e?.kind !== 'segment') throw new Error('请选择线段');
  return transact(
    doc,
    (d) => {
      const end = d.entities.find((p) => p.id === e.endPoint);
      if (end?.kind === 'point') {
        end.position = add(point(doc, e.startPoint), {
          x: Math.cos((degrees * Math.PI) / 180) * size,
          y: Math.sin((degrees * Math.PI) / 180) * size,
        });
        end.spatial = null;
      }
    },
    role,
  );
}
export function setLineStyle(
  doc: GeometryDocument,
  id: string,
  lineStyle: GeometryEntity['lineStyle'],
  role: 'teacher' | 'student',
) {
  return transact(
    doc,
    (d) => {
      const index = d.entities.findIndex((e) => e.id === id);
      const entity = d.entities[index];
      if (!entity) throw new Error('对象不存在');
      if (
        role === 'student' &&
        (lineStyle.startsWith('PROBLEM') || entity.lineStyle.startsWith('PROBLEM'))
      )
        throw new Error('题干对象只读');
      const layerRole = lineStyle.startsWith('PROBLEM')
        ? 'PROBLEM_STEM'
        : lineStyle === 'CONSTRUCTION'
          ? 'CONSTRUCTION'
          : 'STUDENT_ANSWER';
      const layerId = d.layers.find((l) => l.role === layerRole)!.id;
      if (entity.kind === 'segment' && lineStyle === 'CONSTRUCTION') {
        if (d.projectionGroups.some((g) => g.entityIds.includes(id)))
          throw new Error('关联的投影线段不能转换为无限辅助线');
        const geometry = lineGeometry(d, entity);
        d.entities[index] = {
          id,
          kind: 'line',
          viewId: entity.viewId,
          layerId,
          lineStyle,
          anchor: geometry.a,
          direction: unit(geometry.d),
          referenceEntityId: null,
          ...(entity.samples ? { samples: entity.samples } : {}),
        };
      } else if (entity.kind === 'line' && lineStyle.startsWith('ANSWER')) {
        const startPoint = crypto.randomUUID(),
          endPoint = crypto.randomUUID();
        for (const [pointId, position] of [
          [startPoint, entity.anchor],
          [endPoint, add(entity.anchor, scale(unit(entity.direction), 10))],
        ] as const)
          d.entities.push({
            id: pointId,
            kind: 'point',
            viewId: entity.viewId,
            layerId,
            lineStyle,
            position,
            spatial: null,
            name: `P${d.entities.filter((e) => e.kind === 'point').length + 1}`,
            labelVisible: true,
          });
        d.entities[index] = {
          id,
          kind: 'segment',
          viewId: entity.viewId,
          layerId,
          lineStyle,
          startPoint,
          endPoint,
          ...(entity.samples ? { samples: entity.samples } : {}),
        };
      } else {
        entity.lineStyle = lineStyle;
        entity.layerId = layerId;
      }
    },
    role,
  );
}

export function importPenStroke(
  doc: GeometryDocument,
  input: unknown,
  viewId: string,
  role: 'teacher' | 'student',
) {
  const record = PenStrokeRecord.parse(input);
  return addPenStroke(doc, viewId, record.samples, role, { cssPixelsPerMm: record.cssPixelsPerMm });
}
