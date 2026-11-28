import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';

type WindowBox = { x: number; y: number; width: number; height: number };
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function contain(box: WindowBox, size: { width: number; height: number }) {
  const margin = 6;
  const width = Math.min(box.width, size.width - margin * 2);
  const height = Math.min(box.height, size.height - margin * 2);
  return {
    x: clamp(box.x, margin, size.width - width - margin),
    y: clamp(box.y, margin, size.height - height - margin),
    width,
    height,
  };
}

// 参考窗在工作区内定位。指针捕获涵盖鼠标、触屏和拖出标题栏的情况。
export function useWorkspaceFloatingWindow(
  container: RefObject<HTMLDivElement | null>,
  floating: boolean,
) {
  const windowRef = useRef<HTMLElement>(null);
  const [size, setSize] = useState<{ width: number; height: number }>();
  const [position, setPosition] = useState<WindowBox>();
  useEffect(() => {
    const element = container.current;
    if (!element || !floating) return;
    const observer = new ResizeObserver(([{ contentRect }]) => {
      if (contentRect.width > 12 && contentRect.height > 12)
        setSize({ width: contentRect.width, height: contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [container, floating]);

  function drag(event: PointerEvent<HTMLElement>, mode: 'move' | 'resize') {
    if (
      !floating ||
      event.button !== 0 ||
      (event.target instanceof Element && event.target.closest('button'))
    )
      return;
    const area = container.current?.getBoundingClientRect();
    const windowBox = windowRef.current?.getBoundingClientRect();
    if (!area || !windowBox) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    const origin = {
      x: windowBox.left - area.left,
      y: windowBox.top - area.top,
      width: windowBox.width,
      height: windowBox.height,
    };
    const { clientX, clientY } = event;
    const update = (next: globalThis.PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      const dx = next.clientX - clientX;
      const dy = next.clientY - clientY;
      const maxWidth = area.width - origin.x - 6;
      const maxHeight = area.height - origin.y - 6;
      const box =
        mode === 'move'
          ? { ...origin, x: origin.x + dx, y: origin.y + dy }
          : {
              ...origin,
              width: clamp(origin.width + dx, Math.min(240, maxWidth), maxWidth),
              height: clamp(origin.height + dy, Math.min(220, maxHeight), maxHeight),
            };
      setPosition(contain(box, area));
    };
    const stop = (end: globalThis.PointerEvent) => {
      if (end.pointerId !== pointerId) return;
      handle.removeEventListener('pointermove', update);
      handle.removeEventListener('lostpointercapture', stop);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);
    };
    handle.setPointerCapture(pointerId);
    handle.addEventListener('pointermove', update);
    handle.addEventListener('lostpointercapture', stop);
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  }
  const rect = size && position && contain(position, size);
  return {
    windowRef,
    style:
      floating && rect
        ? { left: rect.x, top: rect.y, width: rect.width, height: rect.height }
        : undefined,
    move: (event: PointerEvent<HTMLElement>) => drag(event, 'move'),
    resize: (event: PointerEvent<HTMLElement>) => drag(event, 'resize'),
  };
}
