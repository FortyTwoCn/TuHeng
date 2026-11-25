import { createId } from '@tuheng/contracts';
import type { GeometryDocument, Vec2 } from '@tuheng/contracts';
import {
  addPenStroke,
  addRawPenStroke,
  distance,
  penLinePreview,
  snapPenCurve,
  snapCandidates,
  confirmSnap,
  applyPenLineFit,
  moveEntities,
  sub,
  sheetToLocal,
  foot,
  type PenOptions,
  type PenStrokeStyle,
} from '@tuheng/geometry-core';
import type { Ruler } from './types';
import type { EditorControls } from './types';
import type { Appearance } from './CadPreferences';
export type StrokeSample = Vec2 & { pressure: number };
export function penStrokeStyle({ pattern }: Appearance): PenStrokeStyle {
  return pattern === 'GUIDE' ? 'construction' : pattern === 'DASHED' ? 'hidden' : 'visible';
}
export function rawStrokeDocument(
  base: GeometryDocument,
  viewId: string,
  samples: StrokeSample[],
  role: 'teacher' | 'student',
  id = createId(),
  options: PenOptions = { cssPixelsPerMm: 4 },
) {
  return addRawPenStroke(base, viewId, samples, role, options, id);
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
export function finishPen(
  doc: GeometryDocument,
  options: {
    viewId: string;
    role: 'teacher' | 'student';
    samples: StrokeSample[];
    scale: number;
    penStyle?: PenStrokeStyle;
  },
) {
  const { viewId, role, samples, scale } = options;
  const penOptions: PenOptions = { cssPixelsPerMm: scale, style: options.penStyle };
  if (samples.length >= 4096)
    return {
      kind: 'document' as const,
      document: rawStrokeDocument(doc, viewId, samples, role, undefined, penOptions),
      message: '采样达到 4096 上限，已保留原始折线与最终落点；请分段绘制',
    };
  const document = addPenStroke(doc, viewId, samples, role, penOptions),
    entity = document.entities.at(-1)!;
  return {
    kind: 'document' as const,
    document,
    rawStroke:
      entity.kind === 'polyline'
        ? undefined
        : rawStrokeDocument(doc, viewId, samples, role, entity.id, penOptions),
    message:
      entity.kind === 'polyline'
        ? '未能可靠拟合为直线、圆、圆弧或曲线，已保留原笔迹'
        : `已自动拟合为${{ circle: '圆', arc: '圆弧', segment: '直线', line: '无限辅助线', curve: '曲线' }[entity.kind as 'circle' | 'arc' | 'segment' | 'line' | 'curve']}，可恢复原始笔迹`,
  };
}

export function settlePen(
  controls: EditorControls,
  samples: StrokeSample[],
  viewId: string,
  scale: number,
  threshold: number,
  paused: boolean,
  style: PenStrokeStyle,
) {
  const { document: doc, role } = controls;
  const guided = rulerSamples(samples, controls.ruler, scale);
  const result = finishPen(doc, {
    viewId,
    role,
    scale,
    penStyle: style,
    samples: guided.map((p) => ({ ...sheetToLocal(doc, viewId, p), pressure: p.pressure })),
  });
  const raw = result.document,
    entity = raw.entities.at(-1)!;
  let next = raw,
    message = result.message;
  if (controls.snapping && !controls.skipSnap && !paused) {
    const options = {
      axes: controls.axes && controls.axesSnap,
      objects: controls.objectSnap,
      objectTypes: controls.objectTypes,
      grid: controls.gridSnap,
      gridSpacing: controls.gridSpacing,
      direction: controls.direction && guided === samples,
      hiddenLayers: controls.hiddenLayers,
      projection: controls.projectionSnap,
      threshold,
    };
    try {
      if (entity.kind === 'line' || entity.kind === 'segment') {
        const fit = penLinePreview(doc, raw, scale, options);
        if (fit) {
          next = applyPenLineFit(doc, raw, fit, role);
          if (fit.directionLabel)
            message = `已自动拟合并校正为${fit.directionLabel}${entity.kind === 'line' ? '辅助线' : '直线'}，可取消本次吸附或恢复原始笔迹`;
        }
      } else if (entity.kind === 'curve') {
        next = snapPenCurve(doc, raw, role, scale, options);
      } else if (entity.kind === 'arc' || entity.kind === 'circle') {
        const center = raw.entities.find((e) => e.id === entity.center);
        if (center?.kind === 'point') {
          const candidate = snapCandidates(
            doc,
            viewId,
            center.position,
            scale,
            undefined,
            options,
          )[0];
          if (candidate)
            next = confirmSnap(
              doc,
              moveEntities(raw, [center.id], sub(candidate.position, center.position), role),
              candidate,
              center.id,
              role,
            );
        }
      }
    } catch {
      next = raw;
      message = '本次吸附与已有几何冲突，已保留拟合笔迹';
    }
  }
  return { raw, next, rawStroke: result.rawStroke, message };
}
