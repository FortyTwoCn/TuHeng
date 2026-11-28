import type { GeometryDocument, Vec2 } from '@tuheng/contracts';
import {
  confirmSnap,
  distance,
  intersectionCandidates,
  linkProjection,
  resolveReference,
  sheetToLocal,
  targetFromKey,
  type Bounds,
} from '@tuheng/geometry-core';
import { styleNewGeometry } from '../CadPreferences';
import { penStrokeStyle, settlePen } from '../drawing-session';
import { hitTargets, type Hit, type SessionInteraction } from '../interaction-controller';
import { dragMeasurement } from '../measured-drag';
import {
  axisClick,
  constructionClick,
  constructionGuide,
  type AxisDraft,
} from '../projection-command';
import { selectionFromClick, selectionFromMarquee, type Gesture } from '../selection-gesture';
import type { Marquee } from '../ViewportScene';
import type { useViewportCommandPointer } from './useViewportCommandPointer';
import type { useViewportEdits } from './useViewportEdits';
import type { ViewportProps } from './viewport-types';

export type DraftingGestureContext = {
  props: ViewportProps;
  box: Bounds;
  command: ReturnType<typeof useViewportCommandPointer>;
  edits: ReturnType<typeof useViewportEdits>;
  projection: {
    axisDraft: AxisDraft | null;
    setAxisDraft: (value: AxisDraft | null) => void;
    setConstructionPreview: (value: { revision: object; next: GeometryDocument } | null) => void;
  };
  selection: {
    filtered: (hits: Hit[]) => Hit[];
    updateMarquee: (g: Gesture, p: Vec2) => string[];
    setMarquee: (value: Marquee | null) => void;
    setOverlaps: (hits: Hit[]) => void;
  };
  preview: {
    steps: Vec2[];
    setSteps: (value: Vec2[]) => void;
    setPreview: (value: Vec2[]) => void;
    setPreviewDoc: (value: GeometryDocument | null) => void;
    setState: (value: SessionInteraction) => void;
  };
  fail: (error: unknown) => void;
};

// 提交发生在手势结束后，所有修改仍经过原有 CAD 命令和文档历史。
export function finishDraftingGesture(
  g: Gesture,
  p: Vec2,
  { props, box, command, edits, projection, selection, preview }: DraftingGestureContext,
) {
  const { document: doc, role, readOnly, report } = props;
  const { cad, finishCad } = command;
  const { placingGrip, updateGrip, setPickedGrip, accept, setLastSnap, drag, setLastPen } = edits;
  const { axisDraft, setAxisDraft, setConstructionPreview } = projection;
  const { filtered, updateMarquee, setMarquee, setOverlaps } = selection;
  const { setState, steps, setSteps } = preview;
  if (g.state === 'panning' || g.state === 'movingRuler') return;
  if (g.grip && !readOnly) {
    if (placingGrip || distance(g.start, p) * g.scale >= g.dragPixels) {
      updateGrip(g, p);
      if (g.next) {
        setPickedGrip(undefined);
        setState('idle');
        const next = g.candidate?.composite && g.snapSource
          ? confirmSnap(g.base, g.next, g.candidate, g.snapSource, role)
          : g.next;
        accept(next);
      }
    } else {
      setPickedGrip({ base: doc, grip: g.grip });
      props.report('指定夹点的新位置，按 Esc 取消');
    }
    return;
  }
  if (cad) {
    const fitted = finishCad(cad, g, p);
    if (fitted) setLastSnap(fitted.raw ? { raw: fitted.raw, next: fitted.next } : null);
    return;
  }
  const hits = filtered(
    hitTargets(
      g.base,
      p,
      g.scale,
      box,
      props.hiddenLayers,
      props.selected,
      props.axes,
      g.snapPixels,
    ),
  );
  const target =
    props.session.construction?.phase === 'reference' || axisDraft?.phase === 'reference'
      ? hits.find((h) => {
          try {
            return !!resolveReference(doc, targetFromKey(h.id)).direction;
          } catch {
            return false;
          }
        })
      : hits[0];
  if (constructionClick(props, p, target, g.viewId, setConstructionPreview)) return;
  if (axisDraft) {
    axisClick(props, axisDraft, setAxisDraft, p, target);
    return;
  }
  if (g.tool === 'select' || g.tool === 'box') {
    const moved = distance(g.start, p) * g.scale >= g.dragPixels;
    if ((!g.hit && moved) || g.tool === 'box') {
      if (g.tool === 'box' && !moved && !steps.length) {
        setSteps([p]);
        props.report('点击第二个对角点；从左向右为包含，从右向左为相交');
        return;
      }
      const ids = updateMarquee(g, p);
      props.select(selectionFromMarquee(g, ids));
      setMarquee(null);
      setSteps([]);
      return;
    }
    if (g.hit && moved && !readOnly) {
      if (g.hit.kind === 'reference') {
        props.report('参考轴不能拖移；可在属性中查看或重命名');
        return;
      }
      drag(g, p);
      if (g.next) {
        let next = g.next;
        if (g.candidate && g.snapSource)
          try {
            next = confirmSnap(g.base, next, g.candidate, g.snapSource, role);
          } catch {
            next = g.raw!;
            props.report('本次连接存在拓扑冲突，保留原始拖动');
          }
        accept(next, g.raw);
      }
    } else {
      setOverlaps(hits);
      props.select(selectionFromClick(g, target));
    }
    return;
  }
  if (g.tool === 'projection') {
    if (target) {
      const ids = [...new Set([...props.selected, target.id])];
      props.select(ids);
      if (ids.length >= 2) {
        accept(linkProjection(doc, ids));
        props.select([]);
        props.report('投影关联已记录，实际坐标保留');
      }
    }
    return;
  }
  if (readOnly) return;
  if (g.tool === 'pen' && g.samples.length >= 2) {
    const result = settlePen(
      props,
      g.samples,
      g.viewId,
      g.scale,
      g.snapPixels,
      !!g.pausedSnap,
      penStrokeStyle(g.appearance),
    );
    const applied = accept(result.next, result.raw, g.appearance);
    if (result.rawStroke && applied)
      setLastPen({
        raw: styleNewGeometry(doc, result.rawStroke, g.appearance),
        next: applied,
      });
    report(result.message);
  }
}

export function moveDraftingGesture(
  g: Gesture,
  p: Vec2,
  altKey: boolean,
  { props, command, edits, projection, selection, preview, fail }: DraftingGestureContext,
) {
  const { document: doc, readOnly } = props;
  const { cad, updateCadCursor, setCandidate, setCandidateView } = command;
  const { updateGrip, setDragMeasure, setLastSnap, setLastPen, setInterrupted, drag } = edits;
  const { axisDraft } = projection;
  const { updateMarquee } = selection;
  const { steps, setState, setPreview, setPreviewDoc } = preview;
  try {
    if (g.grip) {
      g.last = p;
      updateGrip(g, p);
      if (g.next) setDragMeasure(dragMeasurement(g, g.next, sheetToLocal(doc, g.viewId, p)));
      return;
    }
    if (cad) {
      g.last = p;
      updateCadCursor(cad, p, g, !!g.pausedSnap || altKey);
      return;
    }
    if (props.session.construction) {
      const path = constructionGuide(doc, props.session.construction, g.viewId, p);
      if (path) setPreview(path);
      return;
    }
    if (g.tool === 'box' || (g.tool === 'select' && !g.hit)) {
      if (distance(g.start, p) * g.scale >= g.dragPixels || steps.length) {
        g.state = 'marqueeSelecting';
        setState(g.state);
        updateMarquee(g, p);
      }
      return;
    }
    if (g.tool === 'select' && g.hit && !readOnly && !axisDraft) {
      if (g.hit.kind === 'reference' || distance(g.start, p) * g.scale < g.dragPixels) return;
      if (g.state === 'pressed') {
        setLastSnap(null);
        setLastPen(null);
        setInterrupted(null);
      }
      g.state =
        g.hit.kind === 'point'
          ? 'draggingPoint'
          : g.hit.kind === 'endpoint'
            ? 'draggingEndpoint'
            : 'draggingSelection';
      setState(g.state);
      props.select(g.ids);
      drag(g, p);
      if (g.next) setDragMeasure(dragMeasurement(g, g.next, sheetToLocal(doc, g.viewId, p)));
    } else if (g.tool === 'pen') {
      setPreview([...g.samples]);
      setCandidate(
        props.snapping && !props.skipSnap && !g.pausedSnap
          ? (intersectionCandidates(g.base, g.viewId, sheetToLocal(g.base, g.viewId, p), g.scale, {
              axes: props.axes && props.axesSnap,
              hiddenLayers: props.hiddenLayers,
              threshold: g.snapPixels,
            })[0] ?? null)
          : null,
      );
      setCandidateView(g.viewId);
    }
    g.last = p;
  } catch (error) {
    setPreviewDoc(null);
    g.next = undefined;
    fail(error);
  }
}
