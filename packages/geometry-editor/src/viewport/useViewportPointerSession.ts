import { useCallback, useRef, type PointerEvent, type RefObject } from 'react';
import type { Vec2 } from '@tuheng/contracts';
import { appendStrokeSample, distance, sub } from '@tuheng/geometry-core';
import type { Gesture } from '../selection-gesture';
import type { Tool } from '../types';
import { usePointerFrames } from '../usePointerFrames';
import { pinchMidpoint, pointerOnSheet } from './viewport-coordinates';

export function appendPenSample(g: Gesture, p: Vec2, pressure: number) {
  appendStrokeSample(g.samples, { ...p, pressure }, 0.1 / g.scale);
}

// 管理指针捕获、双指导航和逐帧采样。具体绘图操作由外部手势处理器决定。
export function useViewportPointerSession({
  svg,
  gesture,
  zoomAt,
  tool,
  cadActive,
  move,
}: {
  svg: RefObject<SVGSVGElement | null>;
  gesture: RefObject<Gesture | null>;
  zoomAt: (factor: number, at: Vec2, translation?: Vec2) => void;
  tool: Tool;
  cadActive: boolean;
  move: (event: PointerEvent<Element>) => void;
}) {
  const pointers = useRef(new Map<number, Vec2>());
  const pinchPair = useRef<Vec2[] | null>(null);
  const { queueMotion, flushMotion, discardMotion, recheckHover, discardHover } =
    usePointerFrames();
  const clear = useCallback(() => {
    pointers.current.clear();
    pinchPair.current = null;
    discardMotion();
    discardHover();
  }, [discardMotion, discardHover]);
  function capture(event: PointerEvent<SVGSVGElement>) {
    if (event.isTrusted) svg.current?.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size < 2) return false;
    pinchPair.current = [...pointers.current.values()];
    discardMotion();
    return true;
  }
  function release(id: number) {
    if (pinchPair.current) {
      discardMotion();
      flushPinch();
      pinchPair.current = null;
    } else flushMotion();
    const pinching = pointers.current.size >= 2;
    pointers.current.delete(id);
    return pinching;
  }
  function flushPinch() {
    const before = pinchPair.current;
    if (!before || pointers.current.size !== 2) return;
    const after = [...pointers.current.values()];
    const initial = distance(before[0], before[1]);
    if (initial > 1) {
      const oldMid = pinchMidpoint(before[0], before[1]);
      const mid = pinchMidpoint(after[0], after[1]);
      const ratio = distance(after[0], after[1]) / initial;
      if (ratio !== 1 || mid.x !== oldMid.x || mid.y !== oldMid.y)
        zoomAt(ratio, oldMid, sub(mid, oldMid));
    }
    pinchPair.current = after;
  }
  function queueMove(e: PointerEvent<Element>) {
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
        appendPenSample(g, pointerOnSheet(sample, g.inverse), sample.pressure);
    }
    queueMotion(() => {
      if (pointers.current.has(e.pointerId))
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      move(e);
    });
  }
  function resumeCoveredHover(e: PointerEvent<HTMLElement>) {
    if (
      !cadActive ||
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
  return {
    clear,
    capture,
    release,
    queueMove,
    resumeCoveredHover,
    pointerCount: () => pointers.current.size,
    hasPointer: (id: number) => pointers.current.has(id),
  };
}
