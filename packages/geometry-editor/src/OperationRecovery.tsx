import type { GeometryDocument } from '@tuheng/contracts';
import { useMemo } from 'react';
import { sheetToLocal } from '@tuheng/geometry-core';
import { styleNewGeometry, type Appearance } from './CadPreferences';
import { penStrokeStyle, rawStrokeDocument, type StrokeSample } from './drawing-session';
export interface ReversibleStep {
  raw: GeometryDocument;
  next: GeometryDocument;
}

export interface InterruptedStroke {
  appearance: Appearance;
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
  interrupted,
  replace,
  commit,
  report,
  setLastSnap,
  setLastPen,
  setInterrupted,
}: {
  doc: GeometryDocument;
  role: 'teacher' | 'student';
  lastSnap: ReversibleStep | null;
  lastPen: ReversibleStep | null;
  interrupted: InterruptedStroke | null;
  replace: (d: GeometryDocument) => GeometryDocument | undefined;
  commit: (d: GeometryDocument) => void;
  report: (s: string) => void;
  setLastSnap: (s: ReversibleStep | null) => void;
  setLastPen: (s: ReversibleStep | null) => void;
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
                const applied = replace(lastSnap.raw);
                if (!applied) return;
                if (lastPen) setLastPen({ ...lastPen, next: applied });
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
                if (!replace(lastPen.raw)) return;
                setLastSnap(null);
                setLastPen(null);
                report('已恢复原始笔迹');
              }
            }}
          >
            恢复原始笔迹
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
              const raw = rawStrokeDocument(doc, interrupted.viewId, samples, role, undefined, {
                style: penStrokeStyle(interrupted.appearance),
                cssPixelsPerMm: interrupted.scale,
              });
              commit(styleNewGeometry(doc, raw, interrupted.appearance));
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
