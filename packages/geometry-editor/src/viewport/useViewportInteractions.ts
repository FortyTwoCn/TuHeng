import { marqueeTargets, type Gesture } from '../selection-gesture';
import type { DynamicInputHandle } from '../DynamicLineInput';

import { useRef, useState, useEffect, useCallback } from 'react';
import type {
  PointerEvent as ReactPointerEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from 'react';
import type { Vec2, GeometryDocument } from '@tuheng/contracts';
import {
  editable,
  sub,
  snapCandidates,
  sheetToLocal,
  drawingViewAt,
  localToSheet,
} from '@tuheng/geometry-core';
import type { Marquee } from '../ViewportScene';
import { constructionGuide, type AxisDraft } from '../projection-command';
import { useViewportCamera } from '../useViewportCamera';
import { interactionThresholds } from '@tuheng/geometry-core';
import {
  hitTargets,
  type Hit,
  type SessionInteraction as InteractionState,
} from '../interaction-controller';
import type { ViewportProps } from './viewport-types';
import { useViewportCommandPointer } from './useViewportCommandPointer';
import { useViewportEdits } from './useViewportEdits';
import {
  finishDraftingGesture,
  moveDraftingGesture,
  type DraftingGestureContext,
} from './drafting-gesture';
import { useViewportInputLifecycle } from './useViewportInputLifecycle';
import { beginViewportGesture } from './viewport-gesture-start';
import { appendPenSample, useViewportPointerSession } from './useViewportPointerSession';
import { coordinateReadout, pointerOnSheet } from './viewport-coordinates';
import { draftingSnapControls } from '../drafting-snap-controls';

export function useViewportInteractions(props: ViewportProps) {
  const { document: doc, viewId, tool, role, readOnly, report } = props;
  const altHeld = useRef(false);
  const dynamicInput = useRef<DynamicInputHandle>(null);
  const crosshair = useRef<SVGGElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  const [overlaps, setOverlaps] = useState<Hit[]>([]);
  const [constructionPreview, setConstructionPreview] = useState<{
    revision: object;
    next: GeometryDocument;
  } | null>(null);
  const [preview, setPreview] = useState<Vec2[]>([]);
  const [previewDoc, setPreviewDoc] = useState<GeometryDocument | null>(null);
  const [operationView, setOperationView] = useState<string>(),
    [hoverView, setHoverView] = useState<string>();
  const [steps, setSteps] = useState<Vec2[]>([]),
    [state, setState] = useState<InteractionState>('idle');
  const [axisDraft, setAxisDraft] = useState<AxisDraft | null>(null);
  const busy = useCallback(() => !!gesture.current, []);
  const { size, box, setPan, zoomAt } = useViewportCamera(
    svg,
    doc,
    props.zoom,
    props.fit,
    props.focusKey,
    viewId,
    busy,
    props.fitTeachingViewport,
  );
  const command = useViewportCommandPointer(props, {
    svg,
    box,
    setPreviewDoc,
    setPreview,
    setState,
  });
  const {
    cad,
    tracking,
    activeCursor,
    precision,
    candidate,
    candidateView,
    setCandidate,
    setCandidateView,
    skippedPick,
    setSkippedPick,
    setCadCursor,
    locate,
    updateCadCursor,
    resetPointer,
    refreshHover,
  } = command;
  const clearTracking = tracking.clear;
  const edits = useViewportEdits(props, {
    candidate,
    setCandidate,
    setCandidateView,
    setPreviewDoc,
    setState,
    tracked: tracking.active,
    resetPreview() {
      setSteps([]);
      setOperationView(undefined);
      setPreview([]);
      setPreviewDoc(null);
      setCandidate(null);
    },
  });
  const {
    dragError,
    setDragError,
    setPickedGrip,
    placingGrip,
    dragMeasure,
    setDragMeasure,
    dragFields,
    setDragFields,
    exactPreview,
    lastSnap,
    setLastSnap,
    lastPen,
    setLastPen,
    interrupted,
    setInterrupted,
    updateGrip,
    accept,
    drag,
  } = edits;
  const commitDrag = () =>
    edits.commitDrag(cancel, () => svg.current?.focus({ preventScroll: true }));

  const { onCameraChange } = props;
  useEffect(() => onCameraChange(box), [box, onCameraChange]);
  const [inspectId, setInspectId] = useState<string>();
  const inspected =
    readOnly && !props.playback ? doc.entities.find((e) => e.id === inspectId) : undefined;
  const cssScale = () => {
    const m = svg.current?.getScreenCTM();
    return m ? Math.hypot(m.a, m.b) : size.width / box.width;
  };
  const pointer = useViewportPointerSession({ svg, gesture, zoomAt, tool, cadActive: !!cad, move });
  const clearPointerSession = pointer.clear;
  const { queueMove, resumeCoveredHover } = pointer;
  const cancel = useCallback(() => {
    const g = gesture.current;
    if (g?.state === 'drawingStroke' && g.samples.length >= 2) {
      setInterrupted(g);
      report('笔迹输入中断，可恢复已采集轨迹');
    }
    gesture.current = null;
    clearPointerSession();
    setPreview([]);
    setPreviewDoc(null);
    resetPointer();
    altHeld.current = false;
    setDragMeasure(undefined);
    setDragFields(undefined);
    clearTracking();
    setPickedGrip(undefined);
    setMarquee(null);
    setSteps([]);
    setOperationView(undefined);
    setState('idle');
  }, [
    report,
    resetPointer,
    setInterrupted,
    setDragMeasure,
    setDragFields,
    clearTracking,
    setPickedGrip,
    clearPointerSession,
  ]);
  useViewportInputLifecycle({
    props,
    svg,
    gesture,
    altHeld,
    skippedPick,
    cad,
    operationPending: !!(axisDraft || placingGrip || steps.length),
    cancel,
    cancelProjection: useCallback(() => {
      setAxisDraft(null);
      setSteps([]);
    }, []),
    altRefresh(pressed) {
      altHeld.current = pressed;
      if (pressed && gesture.current) gesture.current.pausedSnap = true;
      refreshSnap(pressed);
    },
    refreshCurrentSnap: () => refreshSnap(altHeld.current),
  });
  const [previousRevision, setPreviousRevision] = useState(props.revision);
  if (previousRevision !== props.revision) {
    setPreviousRevision(props.revision);
    setHoverView(undefined);
    setConstructionPreview(null);
    setAxisDraft(null);
    setSteps([]);
    setOperationView(undefined);
    setPreview([]);
    setPreviewDoc(null);
    setCandidate(null);
    setDragMeasure(undefined);
    setDragFields(undefined);
  }
  const [previousTool, setPreviousTool] = useState(tool);
  if (previousTool !== tool) {
    setPreviousTool(tool);
    setState('idle');
    setSteps([]);
    setOperationView(undefined);
    setAxisDraft(null);
    setPreview([]);
    setPreviewDoc(null);
    setDragMeasure(undefined);
    setDragFields(undefined);
  }
  const [oldCommandPrefix, setOldCommandPrefix] = useState(cad?.prefix);
  if (oldCommandPrefix !== cad?.prefix) {
    setOldCommandPrefix(cad?.prefix);
    setCadCursor(null);
    setPreview([]);
    setPreviewDoc(null);
    setCandidate(null);
    setDragMeasure(undefined);
    setDragFields(undefined);
  }
  function local(
    e: { clientX: number; clientY: number },
    inverse = svg.current?.getScreenCTM()?.inverse(),
  ): Vec2 {
    return pointerOnSheet(e, inverse);
  }
  function inputPoint(e: ReactPointerEvent<Element>, inverse?: DOMMatrix) {
    return cad && e.pointerType === 'touch' && props.touchOffset && pointer.pointerCount() < 2
      ? local({ clientX: e.clientX, clientY: e.clientY - 32 }, inverse)
      : local(e, inverse);
  }
  function showCursor(sheet: Vec2, frameId: string) {
    const scale = size.width / box.width;
    if (crosshair.current) {
      crosshair.current.setAttribute(
        'transform',
        `translate(${sheet.x} ${-sheet.y}) scale(${1 / scale})`,
      );
      crosshair.current.style.visibility = 'visible';
    }
    props.cursorStatusRef?.current?.replaceChildren(coordinateReadout(doc, frameId, sheet));
  }
  const fail = (e: unknown) => props.report(e instanceof Error ? e.message : '几何操作失败');
  function refreshSnap(pressed: boolean) {
    const g = gesture.current;
    if (g) {
      if (g.state === 'panning' || g.state === 'movingRuler' || g.revision !== props.revision)
        return;
      if (g.grip && g.next) updateGrip(g, g.last);
      else if (cad && g.cadId === cad.commandId)
        updateCadCursor(cad, g.last, g, !!g.pausedSnap || pressed);
      else if (g.raw && g.hit) drag(g, g.last);
      else if (g.state === 'drawingStroke' && pressed) setCandidate(null);
      return;
    }
    refreshHover(pressed);
  }
  function filtered(hits: Hit[]) {
    return props.typeFilter && !cad && !props.session.construction && !axisDraft
      ? hits.filter((h) => doc.entities.find((e) => e.id === h.id)?.kind === props.typeFilter)
      : hits;
  }
  function updateMarquee(g: Gesture, p: Vec2) {
    const next = marqueeTargets(g, p, props, steps);
    setMarquee(next);
    return next.ids;
  }
  function drawingFrame(p: Vec2, target?: Hit) {
    if (cad && (cad.points.length || cad.ids.length)) return cad.viewId;
    if (operationView) return operationView;
    const ref = props.session.construction?.reference;
    const entity =
      ref?.kind === 'entity' ? doc.entities.find((e) => e.id === ref.entityId) : undefined;
    if (entity && entity.scope !== 'SHEET') return entity.viewId;
    // 新笔迹按落点所在图纸区域确定投影。显式引用或编辑既有对象时沿用对象的视图。
    const usesExisting =
      (cad ? cad.phase === 'selection' : tool === 'select') ||
      (props.session.construction?.phase === 'position' &&
        (target?.kind === 'point' || target?.kind === 'endpoint'));
    return drawingViewAt(
      doc,
      p,
      hoverView ?? viewId,
      usesExisting && target?.kind !== 'reference' ? target?.id : undefined,
    );
  }
  const draftGesture: DraftingGestureContext = {
    props,
    box,
    command,
    edits,
    fail,
    projection: { axisDraft, setAxisDraft, setConstructionPreview },
    selection: { filtered, updateMarquee, setMarquee, setOverlaps },
    preview: { steps, setSteps, setPreview, setPreviewDoc, setState },
  };
  function down(e: ReactPointerEvent<SVGSVGElement>) {
    if (e.button !== 0 && !(e.pointerType === 'mouse' && e.button === 1)) return;
    e.preventDefault();
    svg.current?.focus({ preventScroll: true });
    // 笔尖落下后固定本次笔迹的坐标变换。掌触不能切换到双指导航。
    if (gesture.current?.penOwnsInput && e.pointerType === 'touch') return;
    if (pointer.pointerCount() >= 2) return;
    if (dragMeasure && !gesture.current) {
      setDragMeasure(undefined);
      setDragFields(undefined);
      setPreviewDoc(null);
      setDragError('');
    }
    if (pointer.capture(e)) {
      gesture.current = null;
      setPreviewDoc(null);
      setDragMeasure(undefined);
      setDragFields(undefined);
      setPreview([]);
      setCadCursor(null);
      setCandidate(null);
      setMarquee(null);
      setState('pinching');
      return;
    }
    if (!['select', 'pan', 'box'].includes(tool) || props.session.construction || axisDraft) {
      setLastSnap(null);
      setLastPen(null);
      setInterrupted(null);
    }
    const p = inputPoint(e);
    const { draft, pan } = beginViewportGesture(e, p, {
      props,
      box,
      inverse: svg.current!.getScreenCTM()!.inverse(),
      scale: cssScale(),
      placingGrip,
      skippedPick,
      filtered,
      drawingFrame,
    });
    const frameId = draft.viewId;
    showCursor(p, frameId);
    gesture.current = draft;
    if (cad && !pan && !cad.points.length && ['segment', 'line'].includes(cad.commandId))
      gesture.current.cadFirst = locate(
        cad,
        p,
        frameId,
        gesture.current.scale,
        gesture.current.snapPixels,
        e.altKey,
      );
    if (
      cad?.points.length &&
      gesture.current.state === 'pressed' &&
      (cad.commandId === 'segment' || cad.commandId === 'line') &&
      (e.pointerType === 'touch' || e.pointerType === 'pen')
    ) {
      // 手指和无悬停的笔在按下时就显示落点，松开才接受，第二指仍可接管导航。
      updateCadCursor(cad, p, gesture.current, !!gesture.current.pausedSnap);
    }
    setState(gesture.current.state);
    if (!pan && !axisDraft) {
      setHoverView(gesture.current.viewId);
      props.dispatch({ type: 'patch', patch: { active: gesture.current.viewId } });
    }
  }
  function move(e: ReactPointerEvent<Element>) {
    if (gesture.current?.penOwnsInput && e.pointerType === 'touch') return;
    if (!pointer.hasPointer(e.pointerId)) {
      const frameId = drawingFrame(local(e));
      showCursor(inputPoint(e), frameId);
      setHoverView(frameId);
      const threshold = interactionThresholds[e.pointerType === 'pen' ? 'pen' : 'mouse'].snap;
      if (placingGrip && !readOnly) {
        try {
          edits.previewGrip(doc, placingGrip, local(e), cssScale(), threshold, e.altKey);
        } catch {
          setPreviewDoc(null);
          setCandidate(null);
        }
        return;
      }
      if (readOnly)
        setInspectId(
          hitTargets(doc, local(e), cssScale(), box, props.hiddenLayers, [], false, 9)[0]?.id,
        );
      if (cad) {
        const pick = locate(
          cad,
          inputPoint(e),
          frameId,
          cssScale(),
          threshold,
          e.altKey,
          true,
        );
        setCadCursor({ op: cad, pick });
        return;
      }
      if (!readOnly && tool === 'select' && props.tracking) {
        const options = draftingSnapControls(props, threshold, e.altKey);
        const snap = options.enabled
          ? snapCandidates(doc, frameId, sheetToLocal(doc, frameId, local(e)), cssScale(), undefined, options)[0]
          : undefined;
        tracking.visit(frameId, snap, props.hiddenLayers);
      }
      if (props.session.construction) {
        try {
          const path = constructionGuide(doc, props.session.construction, frameId, local(e));
          if (path) setPreview(path);
        } catch (error) {
          setPreview([]);
          fail(error);
        }
      }
      return;
    }
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    if (g.revision !== props.revision || g.tool !== tool || g.cadId !== cad?.commandId) {
      cancel();
      props.report('文档已更新，已取消未提交拖动');
      return;
    }
    const p = inputPoint(e, g.inverse);
    showCursor(p, g.viewId);
    if (g.state === 'movingRuler') {
      props.onRulerChange({
        ...props.ruler,
        origin: {
          x: props.ruler.origin.x + p.x - g.last.x,
          y: props.ruler.origin.y + p.y - g.last.y,
        },
      });
      g.last = p;
      return;
    }
    if (g.state === 'panning') {
      const delta = sub({ x: e.clientX, y: e.clientY }, g.screen);
      setPan((v) => ({ x: v.x - delta.x / g.scale, y: v.y + delta.y / g.scale }));
      g.screen = { x: e.clientX, y: e.clientY };
      return;
    }
    moveDraftingGesture(g, p, e.altKey, draftGesture);
  }
  function up(e: ReactPointerEvent<SVGSVGElement>) {
    const releasedPinch = pointer.release(e.pointerId);
    const g = gesture.current;
    const wasPinching = releasedPinch || state === 'pinching';
    if (g && g.id !== e.pointerId) return;
    gesture.current = null;
    setPreview([]);
    if (!dragFields) setPreviewDoc(null);
    setCandidate(null);
    setState('idle');
    // 先清空手势再释放捕获。正常松手触发的 lostpointercapture 不算意外中断。
    if (svg.current?.hasPointerCapture(e.pointerId)) svg.current.releasePointerCapture(e.pointerId);
    if (wasPinching) return;
    // 已填写的精确尺寸由用户确认。松手仅保留预览，避免再次提交。
    if (g && dragMeasure && dragFields) return;
    setDragMeasure(undefined);
    setDragFields(undefined);
    if (g)
      try {
        if (g.revision !== props.revision || g.tool !== tool || g.cadId !== cad?.commandId)
          throw new Error('文档已更新，已取消未提交操作');
        const p = inputPoint(e, g.inverse);
        if (g.tool === 'pen') appendPenSample(g, p, e.pressure);
        finishDraftingGesture(g, p, draftGesture);
      } catch (error) {
        fail(error);
      }
  }
  function finishFromCanvas() {
    if (gesture.current || readOnly) return false;
    if (!cad)
      return (
        tool === 'select' &&
        !props.session.construction &&
        !axisDraft &&
        !props.session.panel &&
        props.cad.repeat()
      );
    if (cad.phase === 'setup') return false;
    if (
      cad.commandId === 'compass' &&
      cad.parameters.opening &&
      cad.points.length === 1 &&
      activeCursor
    ) {
      props.cad.send({ type: 'stamp', position: activeCursor.position });
    } else props.cad.send({ type: 'confirm' });
    return true;
  }
  const scale = size.width / box.width;
  const shownCandidate = precision.drawingLine ? precision.linePreview?.snap : candidate;
  const shownDrag = exactPreview?.document ?? previewDoc;
  const activeConstruction =
    constructionPreview?.revision === props.revision ? constructionPreview.next : undefined;
  const sceneDocument =
    (props.session.construction?.phase === 'confirm' ? activeConstruction : undefined) ??
    shownDrag ??
    precision.commandPreview ??
    doc;
  const points = cad
    ? cad.points.map((p) => localToSheet(doc, cad.viewId, p))
    : tool === 'box'
      ? steps
      : steps.map((p) => localToSheet(doc, operationView ?? viewId, p));
  const gripTip = exactPreview?.tip ?? dragMeasure?.tip;
  const gripSheet = dragMeasure && gripTip && localToSheet(doc, dragMeasure.viewId, gripTip);
  function doubleClick(event: ReactMouseEvent<SVGSVGElement>) {
    if (readOnly || cad || tool !== 'select' || placingGrip || props.session.construction) return;
    const id = filtered(
      hitTargets(doc, local(event), cssScale(), box, props.hiddenLayers, props.selected, false),
    )[0]?.id;
    const entity = doc.entities.find((e) => e.id === id);
    if (
      !entity ||
      !['text', 'dimension', 'engineeringAnnotation', 'symbol'].includes(entity.kind) ||
      !editable(doc, entity, role)
    )
      return;
    props.select([entity.id]);
    props.dispatch({ type: 'patch', patch: { panel: 'properties' } });
  }
  function keyDown(e: ReactKeyboardEvent<SVGSVGElement>) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.nativeEvent.isComposing) return;
    if (e.code === 'Space' && !e.repeat && finishFromCanvas()) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (!precision.input && !dragMeasure) return;
    if (e.key === 'Tab' || /^[\d+.-]$/.test(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      dynamicInput.current?.start(e.key === 'Tab' ? undefined : e.key);
    }
  }
  return {
    svg,
    box,
    size,
    scale,
    crosshair,
    state,
    marquee,
    cad,
    axisDraft,
    overlap: overlaps,
    activeCursor,
    shownCandidate,
    candidateView,
    sceneDocument,
    shownDrag,
    tracking,
    points,
    previewDoc,
    preview,
    precision,
    inspected,
    dragMeasure,
    dragFields,
    setDragFields,
    gripSheet,
    gripTip,
    dragError,
    setDragError,
    commitDrag,
    dynamicInput,
    cancel,
    skippedPick,
    placingGrip,
    lastSnap,
    setLastSnap,
    lastPen,
    setLastPen,
    interrupted,
    setInterrupted,
    accept,
    activeConstruction,
    setAxisDraft,
    setConstructionPreview,
    setPreview,
    down,
    up,
    queueMove,
    resumeCoveredHover,
    finishFromCanvas,
    doubleClick,
    keyDown,
    toggleSnapPreview() {
      if (gesture.current) {
        gesture.current.pausedSnap = true;
        refreshSnap(true);
      } else if (cad) setSkippedPick(skippedPick === cad.prefix ? null : cad.prefix);
      svg.current?.focus({ preventScroll: true });
    },
    enterPointer(event: ReactPointerEvent<SVGSVGElement>) {
      if (cad && !gesture.current && event.pointerType !== 'touch') queueMove(event);
    },
    lostPointer(id: number) {
      if (gesture.current?.id === id) cancel();
    },
    clearHover() {
      props.hoverEntity?.();
      tracking.leave();
      if (readOnly) setInspectId(undefined);
      if (!gesture.current && crosshair.current) crosshair.current.style.visibility = 'hidden';
    },
    cancelPointer(id: number) {
      if (gesture.current?.id === id || pointer.hasPointer(id)) cancel();
    },
  };
}

export type ViewportInteractions = ReturnType<typeof useViewportInteractions>;
