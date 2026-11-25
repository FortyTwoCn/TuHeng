import { useState, useEffect, type RefObject, type Dispatch, type SetStateAction } from 'react';
import type { GeometryDocument, Vec2 } from '@tuheng/contracts';
import { sheetBounds, localToSheet, type Bounds } from '@tuheng/geometry-core';
function zoomCamera(
  canvas: SVGSVGElement,
  localZoom: number,
  factor: number,
  at: Vec2,
  translation: Vec2,
  setPan: Dispatch<SetStateAction<Vec2>>,
  setLocalZoom: Dispatch<SetStateAction<number>>,
) {
  const rect = canvas.getBoundingClientRect(),
    b = canvas.viewBox.baseVal,
    next = Math.max(0.25, Math.min(8, localZoom * factor)),
    ratio = localZoom / next;
  const nx = (at.x - rect.left) / rect.width - 0.5,
    ny = 0.5 - (at.y - rect.top) / rect.height,
    newScale = rect.width / (b.width * ratio);
  setPan((p) => ({
    x: p.x + nx * b.width * (1 - ratio) - translation.x / newScale,
    y: p.y + ny * b.height * (1 - ratio) + translation.y / newScale,
  }));
  setLocalZoom(next);
}
export function useViewportCamera(
  svg: RefObject<SVGSVGElement | null>,
  doc: GeometryDocument,
  zoom: number,
  fitKey: number,
  focusKey: number,
  viewId: string,
  busy: () => boolean,
) {
  const [size, setSize] = useState({ width: 800, height: 600 }),
    [fitSize, setFitSize] = useState<{ width: number; height: number } | null>(null),
    [pan, setPan] = useState({ x: 0, y: 0 }),
    [localZoom, setLocalZoom] = useState(1),
    [fitted, setFitted] = useState<Bounds>(() => sheetBounds(doc));
  const [previous, setPrevious] = useState({ fitKey, focusKey });
  if (previous.fitKey !== fitKey || previous.focusKey !== focusKey) {
    setPrevious({ fitKey, focusKey });
    if (previous.fitKey !== fitKey) {
      setFitted(sheetBounds(doc));
      setFitSize(size);
      setPan({ x: 0, y: 0 });
      setLocalZoom(1);
    } else {
      const v = doc.views.findIndex((v) => v.id === viewId),
        p = localToSheet(doc, viewId, { x: 30, y: v === 1 ? -25 : 30 });
      setPan({ x: p.x - (fitted.x + fitted.width / 2), y: p.y - (fitted.y + fitted.height / 2) });
    }
  }
  // 工具抽屉改变可见面积，图纸每毫米对应的像素数保持稳定。
  const baseline = fitSize ?? size;
  const mmPerPixel =
    Math.max(fitted.height / baseline.height, fitted.width / baseline.width) / (zoom * localZoom);
  const height = size.height * mmPerPixel,
    width = size.width * mmPerPixel;
  const box = {
    x: fitted.x + fitted.width / 2 - width / 2 + pan.x,
    y: fitted.y + fitted.height / 2 - height / 2 + pan.y,
    width,
    height,
  };
  const zoomAt = (factor: number, at: Vec2, translation: Vec2 = { x: 0, y: 0 }) => {
    if (svg.current)
      zoomCamera(svg.current, localZoom, factor, at, translation, setPan, setLocalZoom);
  };
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width && height) {
        setSize({ width, height });
        setFitSize((current) => current ?? { width, height });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [svg]);
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (!busy())
        zoomCamera(
          el,
          localZoom,
          Math.exp(-e.deltaY * 0.001),
          { x: e.clientX, y: e.clientY },
          { x: 0, y: 0 },
          setPan,
          setLocalZoom,
        );
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [svg, localZoom, busy]);
  return { size, box, setPan, zoomAt };
}
