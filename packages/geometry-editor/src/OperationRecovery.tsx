import type { GeometryDocument } from '@tuheng/contracts';
import { useMemo } from 'react';
import {
  addPenStroke,
  sheetToLocal,
  type PenOptions,
  type PenStrokeStyle,
} from '@tuheng/geometry-core';
import { rawStrokeDocument, type StrokeSample } from './drawing-session';
export interface ReversibleStep {
  raw: GeometryDocument;
  next: GeometryDocument;
}
export interface PenSuggestion {
  base: GeometryDocument;
  raw: GeometryDocument;
  samples: StrokeSample[];
  viewId: string;
  scale: number;
  options: PenOptions;
}
export interface InterruptedStroke {
  penStyle: PenStrokeStyle;
  scale: number;
  base: GeometryDocument;
  samples: StrokeSample[];
  viewId: string;
}
export function OperationRecovery({
  doc,
  role,
  lastSnap,
  lastPen,
  suggestion,
  interrupted,
  replace,
  commit,
  report,
  setLastSnap,
  setLastPen,
  setSuggestion,
  setInterrupted,
}: {
  doc: GeometryDocument;
  role: 'teacher' | 'student';
  lastSnap: ReversibleStep | null;
  lastPen: ReversibleStep | null;
  suggestion: PenSuggestion | null;
  interrupted: InterruptedStroke | null;
  replace: (d: GeometryDocument) => void;
  commit: (d: GeometryDocument) => void;
  report: (s: string) => void;
  setLastSnap: (s: ReversibleStep | null) => void;
  setLastPen: (s: ReversibleStep | null) => void;
  setSuggestion: (s: PenSuggestion | null) => void;
  setInterrupted: (s: InterruptedStroke | null) => void;
}) {
  const same = (d: GeometryDocument) => JSON.stringify(doc) === JSON.stringify(d);
  const snapCurrent = useMemo(
    () => !!lastSnap && JSON.stringify(doc) === JSON.stringify(lastSnap.next),
    [doc, lastSnap],
  );
  const penCurrent = useMemo(
    () => !!lastPen && JSON.stringify(doc) === JSON.stringify(lastPen.next),
    [doc, lastPen],
  );
  return (
    <div className="geo-recovery">
      {(lastSnap || lastPen) && (
        <div className="geo-toolbar">
          <button
            type="button"
            disabled={!snapCurrent}
            onClick={() => {
              if (lastSnap) {
                replace(lastSnap.raw);
                if (lastPen) setLastPen({ ...lastPen, next: lastSnap.raw });
                setLastSnap(null);
                report('已取消自动吸附，保留原始操作');
              }
            }}
          >
            取消本次吸附
          </button>
          <button
            type="button"
            disabled={!penCurrent}
            onClick={() => {
              if (lastPen) {
                replace(lastPen.raw);
                setLastSnap(null);
                setLastPen(null);
                setSuggestion(null);
                report('已恢复原始笔迹');
              }
            }}
          >
            恢复原始笔迹
          </button>
        </div>
      )}
      {suggestion && (
        <div className="geo-snap">
          <span>
            {suggestion.options.allowApproximateCircle
              ? '当前保留原笔迹。可显式尝试圆拟合，检查偏差后使用。'
              : '存在拟合候选；当前保留原笔迹，请检查后选择。'}
          </span>
          <button
            type="button"
            disabled={!same(suggestion.raw)}
            onClick={() => {
              try {
                if (!same(suggestion.raw)) throw Error('文档已变化，不能覆盖后续编辑');
                const next = addPenStroke(
                  suggestion.base,
                  suggestion.viewId,
                  suggestion.samples,
                  role,
                  suggestion.options,
                );
                replace(next);
                setLastPen({ raw: suggestion.raw, next });
                setSuggestion(null);
                report('已采用近似拟合，请检查形状偏差；可恢复原始笔迹');
              } catch (e) {
                report((e as Error).message);
              }
            }}
          >
            {suggestion.options.allowApproximateCircle ? '尝试拟合为圆' : '采用拟合候选'}
          </button>
          <button type="button" onClick={() => setSuggestion(null)}>
            保留笔迹
          </button>
        </div>
      )}
      {interrupted && (
        <button
          type="button"
          onClick={() => {
            try {
              if (!same(interrupted.base)) throw new Error('文档已变化，不能覆盖后续编辑');
              const samples = interrupted.samples.map((p) => ({
                ...sheetToLocal(doc, interrupted.viewId, p),
                pressure: p.pressure,
              }));
              commit(
                rawStrokeDocument(doc, interrupted.viewId, samples, role, undefined, {
                  style: interrupted.penStyle,
                  cssPixelsPerMm: interrupted.scale,
                }),
              );
              setInterrupted(null);
            } catch (e) {
              report((e as Error).message);
            }
          }}
        >
          恢复中断笔迹
        </button>
      )}
    </div>
  );
}
