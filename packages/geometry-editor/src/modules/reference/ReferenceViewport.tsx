import { useCallback, useRef, useState, type PointerEvent } from 'react';
import type { GeometryDocument, Vec2 } from '@tuheng/contracts';
import { distance, drawingViewAt, interactionThresholds, sub } from '@tuheng/geometry-core';
import { hitTarget } from '../../interaction-controller';
import type { CameraFit } from '../../types';
import { useViewportCamera } from '../../useViewportCamera';
import { ViewportDrawing } from '../../ViewportDrawing';
import {
  coordinateReadout,
  pinchMidpoint,
  pointerOnSheet,
} from '../../viewport/viewport-coordinates';

const noIds: string[] = [];
type Drag = { id: number; start: Vec2; last: Vec2; moved: boolean; panOnly: boolean };

// 参考图只处理选择和浏览。镜头、指针及坐标读数各自独立。
export function ReferenceViewport({
  document,
  selected,
  select,
}: {
  document: GeometryDocument;
  selected: string[];
  select: (ids: string[]) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const output = useRef<HTMLOutputElement>(null);
  const drag = useRef<Drag>(null);
  const pointers = useRef(new Map<number, Vec2>());
  const [fit, setFit] = useState<CameraFit>({});
  const [grid, setGrid] = useState(true);
  const [axes, setAxes] = useState(true);
  const [multi, setMulti] = useState(false);
  const busy = useCallback(() => pointers.current.size > 0, []);
  const frame = document.views[0];
  const camera = useViewportCamera(svg, document, 1, fit, 0, frame.id, busy, true);
  const { box, size, setPan, zoomAt } = camera;
  const scale = size.width / box.width;
  const at = (event: PointerEvent<SVGSVGElement>) =>
    pointerOnSheet(event, svg.current?.getScreenCTM()?.inverse());
  const screen = (event: PointerEvent<SVGSVGElement>) => ({ x: event.clientX, y: event.clientY });
  const thresholds = (event: PointerEvent<SVGSVGElement>) =>
    interactionThresholds[event.pointerType as keyof typeof interactionThresholds] ??
    interactionThresholds.mouse;

  function start(event: PointerEvent<SVGSVGElement>) {
    if (![0, 1].includes(event.button) || pointers.current.size >= 2) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    if (event.isTrusted) event.currentTarget.setPointerCapture(event.pointerId);
    const p = screen(event);
    pointers.current.set(event.pointerId, p);
    drag.current =
      pointers.current.size === 1
        ? { id: event.pointerId, start: p, last: p, moved: false, panOnly: event.button === 1 }
        : null;
  }

  function move(event: PointerEvent<SVGSVGElement>) {
    const sheet = at(event);
    output.current?.replaceChildren(
      coordinateReadout(document, drawingViewAt(document, sheet, frame.id), sheet),
    );
    if (!pointers.current.has(event.pointerId)) return;
    const p = screen(event);
    const before = [...pointers.current.values()];
    pointers.current.set(event.pointerId, p);
    if (before.length === 2) {
      const after = [...pointers.current.values()];
      const initial = distance(before[0], before[1]);
      if (initial > 1) {
        const center = pinchMidpoint(before[0], before[1]);
        zoomAt(
          distance(after[0], after[1]) / initial,
          center,
          sub(pinchMidpoint(after[0], after[1]), center),
        );
      }
      return;
    }
    const current = drag.current;
    if (!current) return;
    current.moved ||= distance(p, current.start) >= thresholds(event).drag;
    if (current.moved) {
      const delta = sub(p, current.last);
      setPan((old) => ({ x: old.x - delta.x / scale, y: old.y + delta.y / scale }));
      current.last = p;
    }
  }

  function release(event: PointerEvent<SVGSVGElement>, pick: boolean) {
    pointers.current.delete(event.pointerId);
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    drag.current = null;
    if (
      !pick ||
      current.panOnly ||
      current.moved ||
      distance(screen(event), current.start) >= thresholds(event).drag
    )
      return;
    const hit = hitTarget(
      document,
      at(event),
      scale,
      box,
      noIds,
      selected,
      false,
      thresholds(event).hit,
    );
    if (multi || event.shiftKey || event.ctrlKey || event.metaKey) {
      if (hit)
        select(
          selected.includes(hit.id)
            ? selected.filter((id) => id !== hit.id)
            : [...selected, hit.id],
        );
    } else select(hit ? [hit.id] : []);
  }

  return (
    <div className="geo-reference-viewport">
      <div className="geo-reference-view-tools" role="group" aria-label="参考图纸视图">
        <button type="button" onClick={() => setFit({})}>
          适配视图
        </button>
        <button type="button" aria-pressed={grid} onClick={() => setGrid(!grid)}>
          网格
        </button>
        <button type="button" aria-pressed={axes} onClick={() => setAxes(!axes)}>
          坐标轴
        </button>
        <button type="button" aria-pressed={multi} onClick={() => setMulti(!multi)}>
          多选
        </button>
      </div>
      <svg
        ref={svg}
        tabIndex={0}
        aria-label="参考图纸绘图区"
        viewBox={`${box.x} ${-box.y - box.height} ${box.width} ${box.height}`}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={(event) => release(event, true)}
        onPointerCancel={(event) => release(event, false)}
        onLostPointerCapture={(event) => release(event, false)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') select([]);
          if (!['+', '=', '-'].includes(event.key)) return;
          const rect = event.currentTarget.getBoundingClientRect();
          event.preventDefault();
          zoomAt(event.key === '-' ? 0.8 : 1.25, {
            x: rect.x + rect.width / 2,
            y: rect.y + rect.height / 2,
          });
        }}
      >
        <ViewportDrawing
          controls={{
            document,
            selected,
            grid,
            axes,
            gridSpacing: document.settings.grid,
            labels: document.settings.labels,
            highlighted: noIds,
            hiddenLayers: noIds,
            inspectOnly: true,
          }}
          box={box}
          scale={scale}
        />
      </svg>
      <output ref={output} aria-label="参考图纸坐标" className="geo-reference-coordinates">
        u — · v — mm
      </output>
    </div>
  );
}
