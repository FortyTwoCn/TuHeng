'use client';
import {
  dragSelection,
  marqueeTargets,
  selectionFromClick,
  selectionFromMarquee,
  type Gesture,
} from './selection-gesture';
import { DynamicLineInput, type DynamicInputHandle, type LineFields } from './DynamicLineInput';
import { dragMeasurement, exactDrag, type DragMeasurement } from './measured-drag';
import { locateCadPoint, type CadPick } from './cad-pointer';
import { sheetToViewport, useCadPrecision } from './useCadPrecision';
import { useDraftingTracking } from './useDraftingTracking';
import { styleNewGeometry } from './CadPreferences';

import { penStrokeStyle, settlePen } from './drawing-session';
import { useRef, useState, useEffect, useEffectEvent, useCallback, useMemo } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import type { Vec2, GeometryDocument } from '@tuheng/contracts';
import {
  cadPreview,
  angle,
  cadStep,
  cadGrips,
  editable,
  previewCadGrip,
  type CadSession,
  type CadGrip,
  sub,
  intersectionCandidates,
  appendStrokeSample,
  distance,
  linkProjection,
  snapCandidates,
  confirmSnap,
  sheetToLocal,
  drawingViewAt,
  localToSheet,
  type Bounds,
  type SnapCandidate,
} from '@tuheng/geometry-core';
import { ViewportScene, type Marquee } from './ViewportScene';
import { ViewportProjection } from './ViewportProjection';
import { EntityStyleHint, OverlappingTargets, SnapFeedback } from './ViewportFeedback';
import {
  OperationRecovery,
  type ReversibleStep,
  type InterruptedStroke,
} from './OperationRecovery';
import {
  constructionClick,
  constructionGuide,
  axisClick,
  type AxisDraft,
} from './projection-command';
import { FloatingInspector } from './FloatingInspector';
import { textEntry } from './commands';
import { useViewportCamera } from './useViewportCamera';
import { usePointerFrames } from './usePointerFrames';
import { interactionThresholds, targetFromKey, resolveReference } from '@tuheng/geometry-core';
import {
  hitTargets,
  movingIds,
  type Hit,
  type SessionInteraction as InteractionState,
} from './interaction-controller';
import type { EditorControls } from './types';
export function Viewport(
  props: EditorControls & {
    viewId: string;
    focusKey: number;
    cameraRef: RefObject<Bounds | null>;
    replace: (doc: GeometryDocument) => GeometryDocument | undefined;
  },
) {
  const { document: doc, viewId, tool, role, readOnly, report } = props;
  const cad = props.cad.session;
  const tracking = useDraftingTracking(doc, cad?.commandId, props.snapping && props.objectSnap);
  const clearTracking = tracking.clear;
  const [cadCursor, setCadCursor] = useState<{ op: CadSession; pick: CadPick } | null>(null);
  const lastCadPointer = useRef<{
    prefix: string;
    sheet: Vec2;
    frameId: string;
    scale: number;
    threshold: number;
  } | null>(null);
  const altHeld = useRef(false);
  const [skippedPick, setSkippedPick] = useState<string | null>(null);
  const activeCursor = cadCursor?.op === cad ? cadCursor.pick : undefined;
  const [dragError, setDragError] = useState('');
  const [pickedGrip, setPickedGrip] = useState<{ base: GeometryDocument; grip: CadGrip }>();
  const placingGrip =
    pickedGrip?.base === doc && !cad && tool === 'select' ? pickedGrip.grip : undefined;
  const [dragMeasure, setDragMeasure] = useState<DragMeasurement>();
  const [dragFields, setDragFields] = useState<LineFields>();
  const exactPreview = useMemo(() => {
    if (!dragMeasure || !dragFields || dragMeasure.base !== doc) return;
    try {
      return exactDrag(dragMeasure, dragFields, role);
    } catch {
      return;
    }
  }, [dragMeasure, dragFields, doc, role]);
  const dynamicInput = useRef<DynamicInputHandle>(null);
  const crosshair = useRef<SVGGElement>(null);
  const svg = useRef<SVGSVGElement>(null),
    gesture = useRef<Gesture | null>(null),
    pinchPair = useRef<Vec2[] | null>(null),
    pointers = useRef(new Map<number, Vec2>());
  const { queueMotion, flushMotion, discardMotion, recheckHover, discardHover } =
    usePointerFrames();
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  const [overlaps, setOverlaps] = useState<Hit[]>([]);
  const [constructionPreview, setConstructionPreview] = useState<{
    revision: object;
    next: GeometryDocument;
  } | null>(null);
  const [preview, setPreview] = useState<Vec2[]>([]);
  const [previewDoc, setPreviewDoc] = useState<GeometryDocument | null>(null);
  const [candidate, setCandidate] = useState<SnapCandidate | null>(null);
  const [candidateView, setCandidateView] = useState(viewId);
  const precision = useCadPrecision({
    cad: props.cad,
    doc,
    cursor: activeCursor,
    hiddenLayers: props.hiddenLayers,
    afterLineCommit() {
      setCadCursor(null);
      setCandidate(null);
      props.consumeSnap();
    },
    focusCanvas(preventScroll) {
      svg.current?.focus({ preventScroll });
    },
  });
  const [operationView, setOperationView] = useState<string>(),
    [hoverView, setHoverView] = useState<string>();
  const [steps, setSteps] = useState<Vec2[]>([]),
    [state, setState] = useState<InteractionState>('idle');
  const [lastSnap, setLastSnap] = useState<ReversibleStep | null>(null),
    [lastPen, setLastPen] = useState<ReversibleStep | null>(null),
    [interrupted, setInterrupted] = useState<InterruptedStroke | null>(null);
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
  );
  useEffect(() => {
    props.cameraRef.current = box;
  }, [box, props.cameraRef]);
  const [inspectId, setInspectId] = useState<string>();
  const inspected = readOnly ? doc.entities.find((e) => e.id === inspectId) : undefined;
  const cssScale = () => {
    const m = svg.current?.getScreenCTM();
    return m ? Math.hypot(m.a, m.b) : size.width / box.width;
  };
  const cancel = useCallback(() => {
    const g = gesture.current;
    if (g?.state === 'drawingStroke' && g.samples.length >= 2) {
      setInterrupted(g);
      report('笔迹输入中断，可恢复已采集轨迹');
    }
    gesture.current = null;
    pointers.current.clear();
    pinchPair.current = null;
    setPreview([]);
    setPreviewDoc(null);
    setCandidate(null);
    setCadCursor(null);
    lastCadPointer.current = null;
    altHeld.current = false;
    setSkippedPick(null);
    setDragMeasure(undefined);
    setDragFields(undefined);
    clearTracking();
    setPickedGrip(undefined);
    setMarquee(null);
    setSteps([]);
    setOperationView(undefined);
    discardMotion();
    discardHover();
    setState('idle');
  }, [report, clearTracking, discardMotion, discardHover]);
  const altChanged = useEffectEvent((pressed: boolean) => {
    altHeld.current = pressed;
    if (pressed && gesture.current) gesture.current.pausedSnap = true;
    refreshSnap(pressed);
  });
  const snapSettingsChanged = useEffectEvent(() => refreshSnap(altHeld.current));
  useEffect(() => {
    snapSettingsChanged();
  }, [
    props.ortho,
    props.tracking,
    props.objectSnap,
    props.objectTypes,
    props.snapping,
    props.gridSnap,
    props.axesSnap,
    props.skipSnap,
    skippedPick,
  ]);
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const key = (e: KeyboardEvent) => {
      if (e.type === 'keyup' && e.key === 'Alt' && altHeld.current) {
        altChanged(false);
        return;
      }
      if (
        !el.closest('.geometry-editor')?.contains(document.activeElement) ||
        e.isComposing ||
        textEntry(e.target) ||
        (e.target instanceof Element &&
          !!e.target.closest('.geo-popover,.geo-floating-inspector,.geo-panel'))
      )
        return;
      if (e.key === 'Alt' && !e.ctrlKey && !e.metaKey && !e.repeat) {
        e.preventDefault();
        altChanged(e.type === 'keydown');
        return;
      }
      if (e.key === 'Escape') {
        if (!gesture.current && !axisDraft && !placingGrip && steps.length === 0) return;
        if (cad) {
          cancel();
          return;
        } // The editor's single command handler cancels the session.
        e.preventDefault();
        e.stopPropagation();
        cancel();
        setAxisDraft(null);
        setSteps([]);
      }
    };
    const blur = () => {
      cancel();
    };
    const owner = el.closest('.geometry-editor')!;
    owner.addEventListener('keydown', key as EventListener, true);
    owner.addEventListener('keyup', key as EventListener);
    window.addEventListener('blur', blur);
    const hidden = () => {
      if (document.hidden) blur();
    };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('orientationchange', blur);
    return () => {
      owner.removeEventListener('keydown', key as EventListener, true);
      owner.removeEventListener('keyup', key as EventListener);
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('orientationchange', blur);
    };
  }, [cancel, axisDraft, steps, cad, placingGrip]);
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
  const [oldCommand, setOldCommand] = useState(cad?.commandId);
  if (oldCommand !== cad?.commandId) {
    setOldCommand(cad?.commandId);
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
    if (!inverse) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(inverse);
    return { x: p.x, y: -p.y };
  }
  function inputPoint(e: ReactPointerEvent<Element>, inverse?: DOMMatrix) {
    return cad && e.pointerType === 'touch' && props.touchOffset && pointers.current.size < 2
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
    const position = sheetToLocal(doc, frameId, sheet);
    const output = props.cursorStatusRef?.current;
    if (output) {
      const view = doc.views.find((v) => v.id === frameId);
      const frame = view?.name ?? frameId;
      const baseVH = doc.editorType === 'VH_PROJECTION' && view &&
        !doc.auxiliarySystems?.some((axis) => axis.newViewId === frameId);
      const coords = baseVH
        ? `X ${(position.x * view.signs[0]).toFixed(4)} · ${view.mapping[1].toUpperCase()} ${(position.y * view.signs[1]).toFixed(4)}`
        : `u ${position.x.toFixed(4)} · v ${position.y.toFixed(4)}`;
      output.replaceChildren(
        `${frame} · ${coords} mm`,
      );
    }
  }
  function commitDrag() {
    if (!dragMeasure || dragMeasure.base !== doc) {
      cancel();
      return;
    }
    try {
      const result = exactDrag(dragMeasure, dragFields ?? {}, role);
      cancel();
      accept(result.document);
      setDragError('');
      svg.current?.focus({ preventScroll: true });
    } catch (error) {
      setDragError(error instanceof Error ? error.message : '输入无效');
    }
  }
  function updateGrip(g: Gesture, p: Vec2) {
    if (!g.grip) return;
    const entity = g.base.entities.find((e) => e.id === g.grip!.entityId);
    if (!entity) return;
    const raw = sheetToLocal(g.base, entity.viewId, p);
    const candidate =
      props.snapping && !props.skipSnap && !g.pausedSnap
        ? snapCandidates(g.base, entity.viewId, raw, g.scale, undefined, {
            ...snapOptions,
            exclude: movingIds(g.base, [entity.id]),
            hiddenLayers: props.hiddenLayers,
            threshold: g.snapPixels,
            axes: props.axes && props.axesSnap,
            grid: props.gridSnap,
          })[0]
        : undefined;
    g.next = previewCadGrip(g.base, g.grip, candidate?.position ?? raw, role);
    setPreviewDoc(g.next);
    setCandidate(candidate ?? null);
    setCandidateView(entity.viewId);
    setState('draggingEndpoint');
  }
  const fail = (e: unknown) => props.report(e instanceof Error ? e.message : '几何操作失败');
  function accept(next: GeometryDocument, raw?: GeometryDocument, appearance = props.appearance) {
    const alternative = raw && JSON.stringify(raw) !== JSON.stringify(next) ? raw : undefined;
    const applied = props.commit(styleNewGeometry(doc, next, appearance));
    if (!applied) return;
    props.consumeSnap();
    setSteps([]);
    setOperationView(undefined);
    setPreview([]);
    setPreviewDoc(null);
    setCandidate(null);
    setLastSnap(
      alternative ? { raw: styleNewGeometry(doc, alternative, appearance), next: applied } : null,
    );
    const created = applied.entities.filter((e) => !doc.entities.some((p) => p.id === e.id));
    if (created.length && tool !== 'pen') props.select([created.at(-1)!.id]);
    return applied;
  }
  const snapOptions = {
    objects: props.objectSnap,
    objectTypes: props.objectTypes,
    direction: props.direction,
    gridSpacing: props.gridSpacing,
  };
  function locate(
    session: CadSession,
    p: Vec2,
    frameId: string,
    px: number,
    threshold: number,
    paused: boolean,
    acquire = false,
  ) {
    lastCadPointer.current = { prefix: session.prefix, sheet: p, frameId, scale: px, threshold };
    const hits = hitTargets(
      doc,
      p,
      px,
      box,
      props.hiddenLayers,
      props.selected,
      props.axes,
      threshold,
    );
    const result = locateCadPoint(
      session,
      props,
      p,
      frameId,
      hits,
      px,
      threshold,
      paused || skippedPick === session.prefix,
      candidate ?? undefined,
      tracking.active.filter(
        ({ viewId }) =>
          viewId === (session.points.length || session.ids.length ? session.viewId : frameId),
      ),
    );
    if (acquire) tracking.visit(result.pick.viewId, paused ? undefined : result.candidate);
    setCandidate(result.candidate ?? null);
    setCandidateView(result.pick.viewId);
    return result.pick;
  }
  function updateCadCursor(op: CadSession, p: Vec2, g: Gesture, paused: boolean) {
    const pick = locate(op, p, g.viewId, g.scale, g.snapPixels, paused);
    setCadCursor({ op, pick });
    if (g.cadFirst && distance(g.start, p) * g.scale >= g.dragPixels) {
      const start =
        paused || props.skipSnap || skippedPick === op.prefix
          ? { ...g.cadFirst, position: g.cadFirst.rawPosition, entityId: undefined }
          : g.cadFirst;
      const first = cadStep(op, doc, start).session;
      if (first) setPreviewDoc(cadPreview(first, doc, pick.position, pick.entityId));
      setPreview([start, pick].map((v) => localToSheet(doc, v.viewId, v.position)));
      setState('drawingPrimitive');
    }
  }
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
    const cursor = lastCadPointer.current;
    if (cad && cursor?.prefix === cad.prefix) {
      const pick = locate(
        cad,
        cursor.sheet,
        cursor.frameId,
        cursor.scale,
        cursor.threshold,
        pressed,
      );
      setCadCursor({ op: cad, pick });
    }
  }
  function filtered(hits: Hit[]) {
    return props.typeFilter && !cad && !props.session.construction && !axisDraft
      ? hits.filter((h) => doc.entities.find((e) => e.id === h.id)?.kind === props.typeFilter)
      : hits;
  }
  function drag(g: Gesture, p: Vec2) {
    setPreviewDoc(dragSelection(g, p, props, candidate));
    setCandidate(g.candidate ?? null);
    setCandidateView(g.hit?.viewId ?? viewId);
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
  function finish(g: Gesture, p: Vec2) {
    if (g.state === 'panning' || g.state === 'movingRuler') return;
    if (g.grip && !readOnly) {
      if (placingGrip || distance(g.start, p) * g.scale >= g.dragPixels) {
        updateGrip(g, p);
        if (g.next) {
          setPickedGrip(undefined);
          setState('idle');
          accept(g.next);
        }
      } else {
        setPickedGrip({ base: doc, grip: g.grip });
        props.report('指定夹点的新位置，按 Esc 取消');
      }
      return;
    }
    if (cad) {
      const pick = precision.precisePick(
        locate(cad, p, g.viewId, g.scale, g.snapPixels, !!g.pausedSnap),
      );
      const start =
        g.cadFirst && (g.pausedSnap || props.skipSnap)
          ? { ...g.cadFirst, position: g.cadFirst.rawPosition, entityId: undefined }
          : g.cadFirst;
      const fitted =
        start && distance(g.start, p) * g.scale >= g.dragPixels
          ? props.cad.send(start, pick)
          : props.cad.send(pick);
      if (fitted) {
        precision.clearLineDraft();
        props.consumeSnap();
        setLastSnap(fitted.raw ? { raw: fitted.raw, next: fitted.next } : null);
      }
      setCadCursor(null);
      setCandidate(null);
      setSkippedPick(null);
      lastCadPointer.current = null;
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
  function down(e: ReactPointerEvent<SVGSVGElement>) {
    if (e.button !== 0 && !(e.pointerType === 'mouse' && e.button === 1)) return;
    e.preventDefault();
    svg.current?.focus({ preventScroll: true });
    // 笔尖落下后固定本次笔迹的坐标变换。掌触不能切换到双指导航。
    if (gesture.current?.penOwnsInput && e.pointerType === 'touch') return;
    if (pointers.current.size >= 2) return;
    if (dragMeasure && !gesture.current) {
      setDragMeasure(undefined);
      setDragFields(undefined);
      setPreviewDoc(null);
      setDragError('');
    }
    if (e.isTrusted) svg.current?.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size >= 2) {
      pinchPair.current = [...pointers.current.values()];
      discardMotion();
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
    const p = inputPoint(e),
      hit = filtered(
        hitTargets(
          doc,
          p,
          cssScale(),
          box,
          props.hiddenLayers,
          props.selected,
          props.axes,
          interactionThresholds[(e.pointerType || 'mouse') as keyof typeof interactionThresholds]
            ?.hit ?? 10,
        ),
      )[0],
      pan =
        e.button === 1 ||
        tool === 'pan' ||
        (tool === 'pen' && e.pointerType === 'touch' && !props.fingerDraw);
    const ids = hit ? (props.selected.includes(hit.id) ? props.selected : [hit.id]) : [];
    const frameId = drawingFrame(p, hit);
    showCursor(p, frameId);
    const gripAttribute = (e.target as Element)
      .closest('[data-grip-entity]')
      ?.getAttribute('data-grip-entity');
    const gripKey =
      !cad && !readOnly && tool === 'select' && (e.target as Element).getAttribute('data-cad-grip');
    const entity = props.selected.includes(gripAttribute ?? '')
      ? doc.entities.find((v) => v.id === gripAttribute)
      : undefined;
    const grip = pan
      ? undefined
      : (placingGrip ??
        (gripKey && entity
          ? cadGrips(doc, entity, role).find((v) => v.key === gripKey)
          : undefined));
    gesture.current = {
      cadId: cad?.commandId,
      grip,
      penOwnsInput: e.pointerType === 'pen',
      subtract: props.selectionMode === 'remove',
      id: e.pointerId,
      start: p,
      last: p,
      screen: { x: e.clientX, y: e.clientY },
      inverse: svg.current!.getScreenCTM()!.inverse(),
      scale: cssScale(),
      snapPixels:
        interactionThresholds[(e.pointerType || 'mouse') as keyof typeof interactionThresholds]
          ?.snap ?? 10,
      dragPixels:
        interactionThresholds[(e.pointerType || 'mouse') as keyof typeof interactionThresholds]
          ?.drag ?? 4,
      revision: props.revision,
      selection: props.selected,
      toggle: e.ctrlKey || e.metaKey,
      base: doc,
      pausedSnap: e.altKey || (!!cad && skippedPick === cad.prefix),
      tool,
      appearance: props.appearance,
      hit,
      ids,
      viewId: frameId,
      state:
        props.ruler.visible &&
        (e.altKey ||
          (tool !== 'pen' && (e.target as Element).getAttribute('data-ruler') === 'true'))
          ? 'movingRuler'
          : pan
            ? 'panning'
            : tool === 'pen'
              ? 'drawingStroke'
              : 'pressed',
      samples: [{ ...p, pressure: e.pressure }],
      additive: e.shiftKey || props.selectionMode === 'add',
    };
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
    if (!pointers.current.has(e.pointerId)) {
      const frameId = drawingFrame(local(e));
      showCursor(inputPoint(e), frameId);
      setHoverView(frameId);
      if (placingGrip && !readOnly) {
        const entity = doc.entities.find((e) => e.id === placingGrip.entityId);
        if (entity) {
          const p = sheetToLocal(doc, entity.viewId, local(e));
          try {
            setPreviewDoc(previewCadGrip(doc, placingGrip, p, role));
          } catch {
            setPreviewDoc(null);
          }
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
          interactionThresholds[e.pointerType === 'pen' ? 'pen' : 'mouse'].snap,
          e.altKey,
          true,
        );
        setCadCursor({ op: cad, pick });
        return;
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
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
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
    try {
      if (g.grip) {
        g.last = p;
        updateGrip(g, p);
        if (g.next) setDragMeasure(dragMeasurement(g, g.next, sheetToLocal(doc, g.viewId, p)));
        return;
      }
      if (cad) {
        g.last = p;
        updateCadCursor(cad, p, g, !!g.pausedSnap || e.altKey);
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
            ? (intersectionCandidates(
                g.base,
                g.viewId,
                sheetToLocal(g.base, g.viewId, p),
                g.scale,
                {
                  axes: props.axes && props.axesSnap,
                  hiddenLayers: props.hiddenLayers,
                  threshold: g.snapPixels,
                },
              )[0] ?? null)
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
  function appendSample(g: Gesture, p: Vec2, pressure: number) {
    appendStrokeSample(g.samples, { ...p, pressure }, 0.1 / g.scale);
  }
  function flushPinch() {
    const before = pinchPair.current;
    if (!before || pointers.current.size !== 2) return;
    const after = [...pointers.current.values()];
    const initial = distance(before[0], before[1]);
    if (initial > 1) {
      const oldMid = { x: (before[0].x + before[1].x) / 2, y: (before[0].y + before[1].y) / 2 };
      const mid = { x: (after[0].x + after[1].x) / 2, y: (after[0].y + after[1].y) / 2 };
      const ratio = distance(after[0], after[1]) / initial;
      if (ratio !== 1 || mid.x !== oldMid.x || mid.y !== oldMid.y)
        zoomAt(ratio, oldMid, sub(mid, oldMid));
    }
    pinchPair.current = after;
  }
  function queueMove(e: ReactPointerEvent<Element>) {
    discardHover();
    if (pinchPair.current) {
      if (!pointers.current.has(e.pointerId)) return;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      queueMotion(flushPinch);
      return;
    }
    if (tool === 'pen' && gesture.current?.state === 'drawingStroke') {
      const g = gesture.current;
      if (g.id !== e.pointerId) return;
      const events = e.nativeEvent.getCoalescedEvents?.();
      for (const sample of events?.length ? events : [e.nativeEvent])
        appendSample(g, local(sample, g.inverse), sample.pressure);
    }
    queueMotion(() => move(e));
  }
  function resumeCoveredHover(e: ReactPointerEvent<HTMLElement>) {
    if (
      !cad ||
      gesture.current ||
      e.pointerType === 'touch' ||
      !(e.target instanceof Element) ||
      !e.target.closest('.cad-dynamic-input')
    )
      return;
    recheckHover(() => {
      if (
        !gesture.current &&
        svg.current?.contains(document.elementFromPoint(e.clientX, e.clientY))
      ) {
        queueMove(e);
      }
    });
  }
  function up(e: ReactPointerEvent<SVGSVGElement>) {
    if (pinchPair.current) {
      discardMotion();
      flushPinch();
      pinchPair.current = null;
    } else flushMotion();
    const g = gesture.current;
    const wasPinching = pointers.current.size >= 2 || state === 'pinching';
    pointers.current.delete(e.pointerId);
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
        if (g.tool === 'pen') appendSample(g, p, e.pressure);
        finish(g, p);
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
  return (
    <section
      className={`geo-view geo-active${cad ? ' cad-active' : ''}`}
      onPointerMoveCapture={resumeCoveredHover}
    >
      {overlaps.length > 1 &&
        props.selected.length > 0 &&
        state === 'idle' &&
        tool === 'select' &&
        !props.session.construction &&
        !cad && (
          <OverlappingTargets
            doc={doc}
            hits={overlaps}
            selectedId={props.selected[0]}
            select={props.select}
          />
        )}
      <svg
        ref={svg}
        tabIndex={0}
        aria-label="统一展开图绘图区"
        data-interaction={
          props.session.construction
            ? props.session.construction.phase === 'reference'
              ? 'pickingReference'
              : props.session.construction.spec.directionMode === 'PARALLEL'
                ? 'placingParallel'
                : 'placingPerpendicular'
            : axisDraft
              ? 'placingAxis'
              : state
        }
        viewBox={`${box.x} ${-box.y - box.height} ${box.width} ${box.height}`}
        onPointerDown={down}
        onPointerMove={queueMove}
        onPointerEnter={(e) => {
          if (cad && !gesture.current && e.pointerType !== 'touch') queueMove(e);
        }}
        onPointerUp={up}
        onDoubleClick={(event) => {
          if (readOnly || cad || tool !== 'select' || placingGrip || props.session.construction)
            return;
          const id = filtered(
            hitTargets(
              doc,
              local(event),
              cssScale(),
              box,
              props.hiddenLayers,
              props.selected,
              false,
            ),
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
        }}
        onPointerLeave={() => {
          tracking.leave();
          if (readOnly) setInspectId(undefined);
          if (!gesture.current && crosshair.current) crosshair.current.style.visibility = 'hidden';
        }}
        onContextMenu={(e) => {
          if (finishFromCanvas()) e.preventDefault();
        }}
        onKeyDown={(e) => {
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
        }}
        onPointerCancel={(e) => {
          if (gesture.current?.id === e.pointerId || pointers.current.has(e.pointerId)) cancel();
        }}
        onLostPointerCapture={(e) => {
          if (gesture.current?.id === e.pointerId) cancel();
        }}
      >
        <ViewportScene
          controls={props}
          box={box}
          scale={scale}
          crosshair={crosshair}
          interaction={state}
          marquee={marquee}
          axis={axisDraft}
          preview={{
            document: sceneDocument,
            gripDocument: shownDrag ?? doc,
            measurementDocument: previewDoc ?? precision.commandPreview,
            path: preview,
            points,
          }}
          draft={{
            cursor: activeCursor,
            lineEnd: precision.linePreview?.position,
            candidate: shownCandidate,
            viewId: candidateView,
            bases: tracking.active,
          }}
        />
      </svg>
      {precision.input &&
        state !== 'pinching' &&
        (() => {
          const { key, anchor, from, ...input } = precision.input;
          return (
            <DynamicLineInput
              key={key}
              {...input}
              anchor={sheetToViewport(anchor, box, scale)}
              from={from && sheetToViewport(from, box, scale)}
              size={size}
              handle={dynamicInput}
            />
          );
        })()}
      {inspected && <EntityStyleHint entity={inspected} />}
      {!cad && dragMeasure && gripSheet && gripTip && (
        <DynamicLineInput
          anchor={sheetToViewport(gripSheet, box, scale)}
          size={size}
          length={distance(dragMeasure.anchor, gripTip)}
          angle={angle(sub(gripTip, dragMeasure.anchor))}
          fields={dragFields ?? {}}
          change={(v) => {
            setDragFields(v);
            setDragError('');
          }}
          measure={dragMeasure.target.kind === 'radius' ? 'radius' : 'line'}
          commit={commitDrag}
          confirmLabel="确认调整"
          cancel={() => {
            cancel();
            svg.current?.focus();
          }}
          handle={dynamicInput}
          error={dragFields ? dragError : ''}
        />
      )}
      {(shownCandidate || (cad?.phase === 'points' && activeCursor && props.snapping)) && (
        <SnapFeedback
          candidate={shownCandidate}
          paused={!!cad && skippedPick === cad.prefix}
          toggle={() => {
            if (gesture.current) {
              gesture.current.pausedSnap = true;
              refreshSnap(true);
            } else if (cad) setSkippedPick(skippedPick === cad.prefix ? null : cad.prefix);
            svg.current?.focus({ preventScroll: true });
          }}
        />
      )}
      {state === 'idle' &&
        !dragMeasure &&
        !placingGrip &&
        props.selected.length > 0 &&
        tool === 'select' &&
        !axisDraft &&
        !props.session.construction &&
        !cad && (
          <FloatingInspector
            controls={props}
            svg={svg}
            cameraKey={`${box.x},${box.y},${box.width},${box.height}`}
            beginEdit={() => {
              setLastSnap(null);
              setLastPen(null);
              setInterrupted(null);
            }}
          />
        )}
      {!readOnly && (
        <OperationRecovery
          doc={doc}
          role={role}
          lastSnap={lastSnap}
          lastPen={lastPen}
          interrupted={interrupted}
          replace={props.replace}
          commit={accept}
          report={props.report}
          setLastSnap={setLastSnap}
          setLastPen={setLastPen}
          setInterrupted={setInterrupted}
        />
      )}
      <ViewportProjection
        controls={props}
        axis={axisDraft}
        setAxis={setAxisDraft}
        preview={activeConstruction}
        accept={accept}
        cancelGesture={cancel}
        clearPreview={() => {
          setConstructionPreview(null);
          setPreview([]);
        }}
      />
    </section>
  );
}
