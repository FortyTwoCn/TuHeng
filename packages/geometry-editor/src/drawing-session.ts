import type { GeometryDocument, Vec2 } from '@tuheng/contracts';
import {
  addDrawing,
  addPenStroke,
  transact,
  distance,
  foot,
  fitStroke,
  type PenOptions,
} from '@tuheng/geometry-core';
import type { Tool, Ruler } from './types';
export type StrokeSample = Vec2 & { pressure: number };
export function rawStrokeDocument(
  base: GeometryDocument,
  viewId: string,
  samples: StrokeSample[],
  role: 'teacher' | 'student',
  id = crypto.randomUUID(),
) {
  return transact(
    base,
    (d) =>
      d.entities.push({
        id,
        kind: 'polyline',
        viewId,
        layerId: d.layers.find(
          (l) => l.role === (role === 'teacher' ? 'PROBLEM_STEM' : 'STUDENT_ANSWER'),
        )!.id,
        lineStyle: role === 'teacher' ? 'PROBLEM_VISIBLE' : 'ANSWER_VISIBLE',
        points: samples.map((p) => ({ x: p.x, y: p.y })),
        samples,
        fitStatus: 'UNFITTED',
      }),
    role,
  );
}
export function rulerSamples(samples: StrokeSample[], ruler: Ruler, scale: number) {
  if (!ruler.visible) return samples;
  const a = (ruler.angle * Math.PI) / 180,
    line = {
      a: ruler.origin,
      d: { x: Math.cos(a) * ruler.length, y: Math.sin(a) * ruler.length },
      finite: true,
    };
  if (
    samples.filter((p) => distance(p, foot(p, line)) * scale < 8).length / samples.length > 0.9 &&
    distance(samples[0], samples.at(-1)!) * scale > 12
  )
    return samples.map((p) => ({ ...foot(p, line), pressure: p.pressure }));
  return samples;
}
export type DrawingResult =
  | { kind: 'steps'; steps: Vec2[]; reference?: string; message: string }
  | {
      kind: 'document';
      document: GeometryDocument;
      rawStroke?: GeometryDocument;
      message?: string;
      suggestion?: PenOptions;
    };
export function finishDrawing(
  doc: GeometryDocument,
  options: {
    tool: Tool;
    viewId: string;
    role: 'teacher' | 'student';
    start: Vec2;
    end: Vec2;
    targetId?: string;
    steps: Vec2[];
    reference?: string;
    samples: StrokeSample[];
    scale: number;
    clickThreshold?: number;
  },
): DrawingResult {
  const { tool, viewId, role, start, end, steps, reference, samples, scale } = options;
  const target = doc.entities.find((e) => e.id === options.targetId && e.viewId === viewId);
  if (tool === 'pen') {
    if (samples.length >= 4096)
      return {
        kind: 'document',
        document: rawStrokeDocument(doc, viewId, samples, role),
        message: '采样达到 4096 上限，已保留原始折线与最终落点；请分段绘制',
      };
    const document = addPenStroke(doc, viewId, samples, role, { cssPixelsPerMm: scale }),
      entity = document.entities.at(-1)!;
    const rawStroke = rawStrokeDocument(doc, viewId, samples, role, entity.id);
    const candidate =
      entity.kind === 'polyline'
        ? fitStroke(samples, { cssPixelsPerMm: scale, noisePixels: 3.4 })
        : null;
    return {
      kind: 'document',
      document,
      rawStroke,
      message:
        entity.kind === 'polyline'
          ? candidate?.kind !== 'polyline'
            ? '存在拟合候选，请检查后采用；当前保留笔迹'
            : '笔迹不满足可靠拟合条件，已保留原轨迹'
          : `已拟合为${{ circle: '圆', arc: '圆弧', segment: '直线' }[entity.kind as 'circle' | 'arc' | 'segment']}，可恢复笔迹`,
      suggestion:
        entity.kind === 'polyline'
          ? {
              cssPixelsPerMm: scale,
              ...(candidate?.kind !== 'polyline'
                ? { noisePixels: 3.4 }
                : { allowApproximateCircle: true }),
            }
          : undefined,
    };
  }
  if (
    ['parallel', 'perpendicular', 'parallel-hidden', 'perpendicular-hidden'].includes(tool) &&
    !reference
  ) {
    if (!target || !['line', 'segment'].includes(target.kind))
      throw new Error('请点击当前投影中的参考线');
    return {
      kind: 'steps',
      steps: [],
      reference: target.id,
      message: '参考线已选，点击新线通过的位置',
    };
  }
  if (tool === 'connect') {
    if (target?.kind !== 'point') throw new Error('请选择同一投影中的两个点');
    if (!reference)
      return {
        kind: 'steps',
        steps: [target.position],
        reference: target.id,
        message: '选择另一个点',
      };
    return {
      kind: 'document',
      document: addDrawing(doc, 'connect', viewId, [steps[0], target.position], role, undefined, [
        reference,
        target.id,
      ]),
    };
  }
  if (tool === 'circle' || tool === 'arc') {
    if (steps.length < (tool === 'circle' ? 1 : 2))
      return {
        kind: 'steps',
        steps: [...steps, !steps.length && target?.kind === 'point' ? target.position : end],
        reference: !steps.length && target?.kind === 'point' ? target.id : reference,
        message: tool === 'circle' ? '选择圆周点' : '依次选择起点与终点',
      };
    return {
      kind: 'document',
      document: addDrawing(
        doc,
        tool,
        viewId,
        [...steps, end],
        role,
        undefined,
        reference ? [reference] : undefined,
      ),
    };
  }
  if (['pan', 'projection', 'select', 'box'].includes(tool))
    throw new Error('当前工具不是绘图工具');
  const positions =
    tool === 'point'
      ? [end]
      : distance(start, end) * scale > (options.clickThreshold ?? 3)
        ? [start, end]
        : [end];
  return {
    kind: 'document',
    document: addDrawing(
      doc,
      tool as Parameters<typeof addDrawing>[1],
      viewId,
      positions,
      role,
      reference,
    ),
  };
}
