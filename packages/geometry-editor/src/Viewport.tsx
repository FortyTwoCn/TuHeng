'use client';
import { useRef, useState, useEffect } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { Vec2, GeometryDocument } from '@tuheng/contracts';
import {
  add,
  addDrawing,
  addPenStroke,
  distance,
  hitDistance,
  linkProjection,
  moveEntities,
  snapCandidates,
  confirmSnap,
  contentBounds,
  intersectsBox,
  selectionBounds,
  sub,
  foot,
  type Bounds,
} from '@tuheng/geometry-core';
import { ViewportDrawing } from './ViewportDrawing';
import type { EditorControls } from './types';
interface Gesture {
  start: Vec2;
  last: Vec2;
  samples: (Vec2 & { pressure: number })[];
  id: number;
  hit?: string;
  pan: boolean;
  ruler: boolean;
  additive: boolean;
}
export function Viewport(
  props: EditorControls & { viewId: string; active: boolean; activate: () => void },
) {
  const { document: doc, viewId, tool, readOnly, role } = props;
  const svg = useRef<SVGSVGElement>(null),
    gesture = useRef<Gesture | null>(null),
    pointers = useRef(new Map<number, Vec2>()),
    pinch = useRef<number | null>(null);
  const [width, setWidth] = useState(400),
    [pan, setPan] = useState({ x: 0, y: 0 }),
    [localZoom, setLocalZoom] = useState(1),
    [preview, setPreview] = useState<Vec2[]>([]),
    [steps, setSteps] = useState<Vec2[]>([]),
    [reference, setReference] = useState<string>(),
    [pending, setPending] = useState<{
      base: GeometryDocument;
      raw: GeometryDocument;
      snapped: GeometryDocument;
      label: string;
    } | null>(null);
  const zoom = props.zoom * localZoom;
  const [fitted, setFitted] = useState<Bounds>({ x: -20, y: -30, width: 120, height: 90 });
  const scale = (width / fitted.width) * zoom;
  const box: Bounds = {
    x: fitted.x + pan.x,
    y: fitted.y + pan.y,
    width: fitted.width / zoom,
    height: fitted.height / zoom,
  };
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width));
    observer.observe(element);
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      setLocalZoom((z) => Math.max(0.25, Math.min(8, z * Math.exp(-event.deltaY * 0.001))));
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => {
      observer.disconnect();
      element.removeEventListener('wheel', wheel);
    };
  }, []);
  const [previousTool, setPreviousTool] = useState(tool);
  if (previousTool !== tool) {
    setPreviousTool(tool);
    setSteps([]);
    setReference(undefined);
    setPreview([]);
    setPending(null);
  }
  const [previousFit, setPreviousFit] = useState(props.fitKey);
  if (previousFit !== props.fitKey) {
    setPreviousFit(props.fitKey);
    setPan({ x: 0, y: 0 });
    setLocalZoom(1);
    setFitted(contentBounds(doc, viewId));
  }
  const local = (e: { clientX: number; clientY: number }): Vec2 => {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse());
    return { x: p.x, y: -p.y };
  };
  const hit = (p: Vec2) =>
    doc.entities
      .filter((e) => e.viewId === viewId && !props.hiddenLayers.includes(e.layerId))
      .map((e) => ({ e, d: hitDistance(doc, e, p, box) }))
      .filter((v) => v.d < 22 / scale)
      .sort((a, b) => a.d - b.d)[0]?.e;
  const accept = (next: GeometryDocument) => {
    props.commit(next);
    const existing = new Set(doc.entities.map((e) => e.id));
    const created = next.entities.filter((e) => !existing.has(e.id));
    if (created.length) props.select([created[created.length - 1].id]);
    props.consumeSnap();
    setSteps([]);
    setPreview([]);
  };
  const cancel = () => {
    gesture.current = null;
    setPreview([]);
    pinch.current = null;
    pointers.current.clear();
  };
  function finish(g: Gesture, p: Vec2) {
    if (g.pan || g.ruler) return;
    const target = hit(p);
    if (tool === 'projection') {
      if (!target) return;
      const ids = [...new Set([...props.selected, target.id])];
      props.select(ids);
      if (ids.length >= 2) {
        accept(linkProjection(doc, ids));
        props.report('投影关联已记录');
        props.select([]);
      }
      return;
    }
    if (tool === 'select') {
      if (g.hit && distance(g.start, p) > 1 / scale)
        accept(
          moveEntities(
            doc,
            props.selected.includes(g.hit) ? props.selected : [g.hit],
            sub(p, g.start),
            role,
          ),
        );
      else
        props.select(
          target ? (g.additive ? [...new Set([...props.selected, target.id])] : [target.id]) : [],
        );
      return;
    }
    if (tool === 'box') {
      const bounds = selectionBounds(g.start, p);
      props.select(
        doc.entities
          .filter(
            (e) =>
              e.viewId === viewId &&
              !props.hiddenLayers.includes(e.layerId) &&
              intersectsBox(doc, e, bounds),
          )
          .map((e) => e.id),
      );
      return;
    }
    if (readOnly) return;
    if (tool === 'pen') {
      if (g.samples.length >= 2) {
        const raw = addPenStroke(doc, viewId, g.samples, role);
        const segment = raw.entities.at(-1);
        if (segment?.kind === 'segment' && props.snapping && !props.skipSnap) {
          const start = raw.entities.find((e) => e.id === segment.startPoint),
            end = raw.entities.find((e) => e.id === segment.endPoint);
          if (start?.kind === 'point' && end?.kind === 'point') {
            const candidate = snapCandidates(doc, viewId, end.position, scale, start.position)[0];
            if (candidate) {
              const snapped = confirmSnap(
                doc,
                moveEntities(raw, [end.id], sub(candidate.position, end.position), role),
                candidate,
              );
              setPending({ base: doc, raw, snapped, label: candidate.kind });
              return;
            }
          }
        }
        accept(raw);
      }
      return;
    }
    if (tool === 'pan') return;
    if (
      ['parallel', 'perpendicular', 'parallel-hidden', 'perpendicular-hidden'].includes(tool) &&
      !reference
    ) {
      if (target?.kind === 'line' || target?.kind === 'segment') {
        setReference(target.id);
        props.report('参考线已选，点击新线通过的位置');
      }
      return;
    }
    if (tool === 'connect') {
      if (target?.kind !== 'point') throw new Error('连接工具需要依次选择两个已有点');
      if (!reference) {
        setReference(target.id);
        setSteps([target.position]);
        props.report('选择另一个点');
        return;
      }
      accept(
        addDrawing(doc, 'connect', viewId, [steps[0], target.position], role, undefined, [
          reference,
          target.id,
        ]),
      );
      setReference(undefined);
      return;
    }
    if (tool === 'circle' || tool === 'arc') {
      const count = tool === 'circle' ? 2 : 3;
      if (steps.length < count - 1) {
        if (steps.length === 0 && target?.kind === 'point') setReference(target.id);
        setSteps([...steps, steps.length === 0 && target?.kind === 'point' ? target.position : p]);
        props.report(tool === 'circle' ? '选择圆周点' : '依次选择圆弧起点、终点');
        return;
      }
      accept(
        addDrawing(
          doc,
          tool,
          viewId,
          [...steps, p],
          role,
          undefined,
          reference ? [reference] : undefined,
        ),
      );
      setReference(undefined);
      return;
    }
    const positions =
      tool === 'point' ? [p] : distance(g.start, p) > 3 / scale ? [g.start, p] : [p];
    const raw = addDrawing(doc, tool, viewId, positions, role, reference);
    const candidates =
      props.snapping && !props.skipSnap
        ? snapCandidates(
            doc,
            viewId,
            positions[positions.length - 1],
            scale,
            positions.length > 1 ? positions[0] : undefined,
          )
        : [];
    if (candidates.length) {
      const candidate = candidates[0],
        adjusted = [...positions];
      adjusted[adjusted.length - 1] = candidate.position;
      const snapped = addDrawing(doc, tool, viewId, adjusted, role, reference);
      setPending({
        base: doc,
        raw,
        snapped: confirmSnap(doc, snapped, candidate),
        label: `${candidate.kind} · ${candidate.entityIds.join('、') || '网格或轴向'}`,
      });
      props.report('确认吸附或保留原位置');
    } else accept(raw);
    setReference(undefined);
  }
  function down(e: ReactPointerEvent<SVGSVGElement>) {
    if (e.button !== 0) return;
    if (pending) {
      props.report('请先确认吸附或保留原位置');
      return;
    }
    e.preventDefault();
    props.activate();
    if (e.isTrusted) svg.current?.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      gesture.current = null;
      setPreview([]);
      pinch.current = distance(...([...pointers.current.values()] as [Vec2, Vec2]));
      return;
    }
    const p = local(e),
      target = hit(p);
    const ruler =
      props.ruler.visible &&
      (e.altKey ||
        ((e.target as Element).getAttribute('data-ruler') === 'true' &&
          e.pointerType !== 'pen' &&
          !(tool === 'pen' && props.fingerDraw)));
    gesture.current = {
      start: p,
      last: p,
      samples: [{ ...(tool === 'pen' && !ruler ? rulerPoint(p) : p), pressure: e.pressure }],
      id: e.pointerId,
      hit: target?.id,
      pan: tool === 'pan' || (tool === 'pen' && e.pointerType === 'touch' && !props.fingerDraw),
      ruler,
      additive: e.shiftKey,
    };
    if (tool === 'select' && target && !props.selected.includes(target.id))
      props.select(e.shiftKey ? [...props.selected, target.id] : [target.id]);
  }
  function rulerPoint(p: Vec2): Vec2 {
    if (!props.ruler.visible) return p;
    const angle = (props.ruler.angle * Math.PI) / 180;
    return foot(p, {
      a: props.ruler.origin,
      d: { x: Math.cos(angle) * props.ruler.length, y: Math.sin(angle) * props.ruler.length },
      finite: true,
    });
  }
  function move(e: ReactPointerEvent<SVGSVGElement>) {
    if (!pointers.current.has(e.pointerId)) return;
    const oldTouches = [...pointers.current.values()];
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const newTouches = [...pointers.current.values()];
      const dx = (newTouches[0].x + newTouches[1].x - oldTouches[0].x - oldTouches[1].x) / 2;
      const dy = (newTouches[0].y + newTouches[1].y - oldTouches[0].y - oldTouches[1].y) / 2;
      setPan((v) => ({ x: v.x - dx / scale, y: v.y + dy / scale }));
      const size = distance(...([...pointers.current.values()] as [Vec2, Vec2]));
      if (pinch.current)
        setLocalZoom((z) => Math.min(8, Math.max(0.25, (z * size) / pinch.current!)));
      pinch.current = size;
      return;
    }
    const g = gesture.current;
    if (!g) return;
    let p = local(e);
    if (g.pan) {
      setPan((v) => sub(v, sub(p, g.last)));
      return;
    }
    if (g.ruler) {
      props.onRulerChange({ ...props.ruler, origin: add(props.ruler.origin, sub(p, g.last)) });
      g.last = p;
      return;
    }
    if (tool === 'pen') {
      const coalesced = e.nativeEvent.getCoalescedEvents?.();
      const events = coalesced?.length ? coalesced : [e.nativeEvent];
      for (const sample of events) {
        p = rulerPoint(local(sample));
        if (g.samples.length < 4096) g.samples.push({ ...p, pressure: sample.pressure });
      }
      setPreview([...g.samples]);
    } else setPreview([g.start, p]);
    g.last = p;
  }
  function up(e: ReactPointerEvent<SVGSVGElement>) {
    const g = gesture.current;
    pointers.current.delete(e.pointerId);
    if (svg.current?.hasPointerCapture(e.pointerId)) svg.current.releasePointerCapture(e.pointerId);
    if (pinch.current !== null) {
      if (!pointers.current.size) pinch.current = null;
      return;
    }
    gesture.current = null;
    setPreview([]);
    if (g)
      try {
        finish(g, local(e));
      } catch (error) {
        props.report(error instanceof Error ? error.message : '几何操作失败');
      }
  }
  return (
    <section className={`geo-view ${props.active ? 'geo-active' : ''}`}>
      <button type="button" className="geo-view-title" onClick={props.activate}>
        {doc.views.find((v) => v.id === viewId)?.name}
      </button>
      <svg
        ref={svg}
        aria-label={`${doc.views.find((v) => v.id === viewId)?.name}绘图区`}
        viewBox={`${box.x} ${-box.y - box.height} ${box.width} ${box.height}`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={cancel}
        onLostPointerCapture={() => {
          if (gesture.current) cancel();
        }}
      >
        <ViewportDrawing
          controls={props}
          viewId={viewId}
          box={box}
          scale={scale}
          preview={preview}
          steps={steps}
        />
      </svg>
      {pending && (
        <div className="geo-snap" role="status">
          <span>候选 {pending.label}</span>
          <button
            type="button"
            onClick={() => {
              if (doc === pending.base) accept(pending.snapped);
              else props.report('文档已更改，请重新执行此次作图');
              setPending(null);
            }}
          >
            确认吸附
          </button>
          <button
            type="button"
            onClick={() => {
              if (doc === pending.base) accept(pending.raw);
              else props.report('文档已更改，请重新执行此次作图');
              setPending(null);
            }}
          >
            保留原位置
          </button>
        </div>
      )}
    </section>
  );
}
