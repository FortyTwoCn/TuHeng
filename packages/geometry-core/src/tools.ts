import { createId } from '@tuheng/contracts';
import type { GeometryDocument, GeometryEntity, Vec2 } from '@tuheng/contracts';
import { editable, transact } from './document';
import { distance, minorArc, sub, unit, scale, add, lineGeometry } from './math';
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
  | 'connect'
  | 'curve';
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
        const id = createId();
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
      const [a, b] = positions;
      if (!a) throw Error('请选择起点');
      if (tool === 'point') {
        makePoint(a, 0);
        return;
      }
      if (!b) throw Error('请确定第二个点后再提交图形');
      if (tool === 'arc' && !positions[2]) throw Error('请确定圆弧终点');
      const id = createId();
      if (tool === 'curve') {
        if (d.schemaVersion !== 'tuheng.geometry/3.0.0') d.schemaVersion = 'tuheng.geometry/2.2.0';
        d.entities.push({
          ...base,
          id,
          kind: 'curve',
          pointIds: positions.map(makePoint),
          interpolation: 'CUBIC_HERMITE',
        });
        return;
      }
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
          endPoint: makePoint(referenceId ? add(a, scale(unit(direction), distance(a, b))) : b, 1),
        });
      if (referenceId)
        d.constraints.push({
          id: createId(),
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
export function addCurve(
  doc: GeometryDocument,
  viewId: string,
  positions: Vec2[],
  role: 'teacher' | 'student',
  existingIds?: string[],
  style: PenStrokeStyle = 'visible',
) {
  const next = addDrawing(doc, 'curve', viewId, positions, role, undefined, existingIds);
  const existing = new Set(doc.entities.map((e) => e.id));
  return transact(
    next,
    (d) => {
      for (const e of d.entities)
        if (!existing.has(e.id)) Object.assign(e, penAppearance(d, role, style));
    },
    role,
  );
}
export function addRawPenStroke(
  doc: GeometryDocument,
  viewId: string,
  samples: (Vec2 & { pressure: number })[],
  role: 'teacher' | 'student',
  options: PenOptions = { cssPixelsPerMm: 4 },
  id = createId(),
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
  if (fit.kind === 'curve') {
    next = addCurve(doc, viewId, fit.points, role);
  } else if (fit.kind === 'segment') {
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
      if (
        e.kind === 'segment' ||
        e.kind === 'line' ||
        e.kind === 'curve' ||
        e.kind === 'circle' ||
        e.kind === 'arc' ||
        e.kind === 'polyline'
      ) {
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
      id: createId(),
      kind: e.kind === 'point' ? 'POINT' : 'SEGMENT',
      entityIds: merged,
      source: 'USER',
    });
  });
}
export function availableLineStyles(
  doc: GeometryDocument,
  ids: string[],
  role: 'teacher' | 'student',
): GeometryEntity['lineStyle'][] {
  if (!ids.length) return [];
  const entities = ids.map((id) => doc.entities.find((e) => e.id === id));
  if (entities.some((e) => !e || !editable(doc, e, role))) return [];
  const layer = doc.layers.find((l) => l.id === entities[0]?.layerId);
  if (!layer || entities.some((e) => e?.layerId !== layer.id)) return [];
  if (layer.role === 'PROBLEM_STEM') return ['PROBLEM_VISIBLE', 'PROBLEM_HIDDEN'];
  if (layer.role === 'CONSTRUCTION') return ['CONSTRUCTION'];
  return ['ANSWER_VISIBLE', 'ANSWER_HIDDEN'];
}
export function setLineStyle(
  doc: GeometryDocument,
  id: string,
  lineStyle: GeometryEntity['lineStyle'],
  role: 'teacher' | 'student',
) {
  if (!availableLineStyles(doc, [id], role).includes(lineStyle))
    throw Error('线型必须属于当前对象的图层');
  const entity = doc.entities.find((e) => e.id === id);
  if (entity?.lineStyle === lineStyle) return doc;
  return transact(
    doc,
    (d) => {
      const target = d.entities.find(e => e.id === id)!;
      target.lineStyle=lineStyle;
      if (target.appearance?.pattern) delete target.appearance.pattern;
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
