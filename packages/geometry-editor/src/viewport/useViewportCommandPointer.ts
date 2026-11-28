import { useCallback, useRef, useState, type RefObject } from 'react';
import type { GeometryDocument, Vec2 } from '@tuheng/contracts';
import {
  cadStep,
  cadPreview,
  distance,
  localToSheet,
  type Bounds,
  type CadSession,
  type SnapCandidate,
} from '@tuheng/geometry-core';
import { locateCadPoint, type CadPick } from '../cad-pointer';
import { hitTargets, type SessionInteraction } from '../interaction-controller';
import type { Gesture } from '../selection-gesture';
import { useCadPrecision } from '../useCadPrecision';
import { useDraftingTracking } from '../useDraftingTracking';
import type { ViewportProps } from './viewport-types';

// CAD 指针输入共用吸附、追踪以及精确尺寸预览。
export function useViewportCommandPointer(
  props: ViewportProps,
  {
    svg,
    box,
    setPreviewDoc,
    setPreview,
    setState,
  }: {
    svg: RefObject<SVGSVGElement | null>;
    box: Bounds;
    setPreviewDoc: (value: GeometryDocument | null) => void;
    setPreview: (value: Vec2[]) => void;
    setState: (value: SessionInteraction) => void;
  },
) {
  const { document: doc, viewId } = props;
  const cad = props.cad.session;
  // 连续落点和画线只新增几何，已有追踪基点可跨提交使用。
  const trackingScope =
    cad?.commandId === 'point' || cad?.commandId === 'segment' ? cad.id : cad?.prefix;
  const tracking = useDraftingTracking(doc, trackingScope, props.snapping && props.objectSnap);
  const [cadCursor, setCadCursor] = useState<{ op: CadSession; pick: CadPick } | null>(null);
  const lastCadPointer = useRef<{
    prefix: string;
    sheet: Vec2;
    frameId: string;
    scale: number;
    threshold: number;
  } | null>(null);
  const [skippedPick, setSkippedPick] = useState<string | null>(null);
  const activeCursor = cadCursor?.op === cad ? cadCursor.pick : undefined;
  const [candidate, setCandidate] = useState<SnapCandidate | null>(null);
  const [candidateView, setCandidateView] = useState(viewId);
  const resetPointer = useCallback(() => {
    lastCadPointer.current = null;
    setCadCursor(null);
    setSkippedPick(null);
    setCandidate(null);
  }, []);
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
      tracking.active,
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
  function finishCad(cad: CadSession, g: Gesture, p: Vec2) {
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
    }
    setCadCursor(null);
    setCandidate(null);
    setSkippedPick(null);
    lastCadPointer.current = null;
    return fitted;
  }
  function refreshHover(paused: boolean) {
    const cursor = lastCadPointer.current;
    if (!cad || cursor?.prefix !== cad.prefix) return;
    const pick = locate(cad, cursor.sheet, cursor.frameId, cursor.scale, cursor.threshold, paused);
    setCadCursor({ op: cad, pick });
  }
  return {
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
    finishCad,
    resetPointer,
    refreshHover,
  };
}
