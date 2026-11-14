'use client';
import { finishDrawing, rulerSamples } from './drawing-session';
import { useRef, useState, useEffect, useCallback } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { Vec2, GeometryDocument } from '@tuheng/contracts';
import {
  sub,
  appendStrokeSample,
  distance,
  linkProjection,
  moveEntities,
  snapCandidates,
  confirmSnap,
  sheetBounds,
  sheetToLocal,
  localToSheet,
  localBounds,
  intersectsBox,
  selectionBounds,
  addProjectionAxis,
  axisDirection,
  orthographic,
  type Bounds,
  type SnapCandidate,
  type AxisConstruction,
} from '@tuheng/geometry-core';
import { ViewportDrawing } from './ViewportDrawing';
import {
  OperationRecovery,
  type ReversibleStep,
  type PenSuggestion,
  type InterruptedStroke,
} from './OperationRecovery';
import { AxisTools } from './AxisTools';
import {
  hitTarget,
  dragDocument,
  movingIds,
  type Hit,
  type InteractionState,
} from './interaction-controller';
import type { EditorControls, Tool } from './types';
interface Gesture {
  id: number;
  start: Vec2;
  last: Vec2;
  screen: Vec2;
  inverse: DOMMatrix;
  scale: number;
  snapPixels: number;
  base: GeometryDocument;
  tool: Tool;
  hit?: Hit;
  ids: string[];
  state: InteractionState;
  samples: (Vec2 & { pressure: number })[];
  viewId: string;
  additive: boolean;
  raw?: GeometryDocument;
  next?: GeometryDocument;
  candidate?: SnapCandidate;
}
export function Viewport(
  props: EditorControls & {
    viewId: string;
    active: boolean;
    activate: () => void;
    focusKey: number;
    replace: (doc: GeometryDocument) => void;
  },
) {
  const { document: doc, viewId, tool, role, readOnly, report } = props;
  const svg = useRef<SVGSVGElement>(null),
    gesture = useRef<Gesture | null>(null),
    pointers = useRef(new Map<number, Vec2>()),
    space = useRef(false);
  const [size, setSize] = useState({ width: 800, height: 600 }),
    [pan, setPan] = useState({ x: 0, y: 0 }),
    [localZoom, setLocalZoom] = useState(1),
    [fitted, setFitted] = useState<Bounds>(sheetBounds(doc));
  const [preview, setPreview] = useState<Vec2[]>([]),
    [previewDoc, setPreviewDoc] = useState<GeometryDocument | null>(null),
    [candidate, setCandidate] = useState<SnapCandidate | null>(null),
    [candidateView, setCandidateView] = useState(viewId);
  const [steps, setSteps] = useState<Vec2[]>([]),
    [reference, setReference] = useState<string>(),
    [state, setState] = useState<InteractionState>('idle');
  const [lastSnap, setLastSnap] = useState<ReversibleStep | null>(null),
    [lastPen, setLastPen] = useState<ReversibleStep | null>(null),
    [suggestion, setSuggestion] = useState<PenSuggestion | null>(null),
    [interrupted, setInterrupted] = useState<InterruptedStroke | null>(null);
  const [axisDraft, setAxisDraft] = useState<{
    spec: AxisConstruction;
    phase: 'reference' | 'anchor' | 'direction' | 'side' | 'confirm';
  } | null>(null);
  const zoom = props.zoom * localZoom,
    ratio = size.width / size.height;
  const height = Math.max(fitted.height, fitted.width / ratio) / zoom,
    width = height * ratio;
  const box = {
    x: fitted.x + fitted.width / 2 - width / 2 + pan.x,
    y: fitted.y + fitted.height / 2 - height / 2 + pan.y,
    width,
    height,
  };
  const cssScale = () => {
    const m = svg.current?.getScreenCTM();
    return m ? Math.hypot(m.a, m.b) : size.width / width;
  };
  const cancel = useCallback(() => {
    const g = gesture.current;
    if (g?.state === 'drawingStroke' && g.samples.length >= 2) {
      setInterrupted(g);
      report('笔迹输入中断，可恢复已采集轨迹');
    }
    gesture.current = null;
    pointers.current.clear();
    setPreview([]);
    setPreviewDoc(null);
    setCandidate(null);
    setState('idle');
  }, [report]);
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) =>
      setSize({ width: entries[0].contentRect.width, height: entries[0].contentRect.height }),
    );
    observer.observe(el);
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (!gesture.current)
        setLocalZoom((z) => Math.max(0.25, Math.min(8, z * Math.exp(-e.deltaY * 0.001))));
    };
    const key = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) return;
      if (e.code === 'Space') {
        space.current = e.type === 'keydown';
        e.preventDefault();
      }
      if (e.key === 'Escape') {
        cancel();
        setAxisDraft(null);
        setSteps([]);
      }
    };
    const blur = () => {
      space.current = false;
      cancel();
    };
    el.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('keydown', key);
    window.addEventListener('keyup', key);
    window.addEventListener('blur', blur);
    return () => {
      observer.disconnect();
      el.removeEventListener('wheel', wheel);
      window.removeEventListener('keydown', key);
      window.removeEventListener('keyup', key);
      window.removeEventListener('blur', blur);
    };
  }, [cancel]);
  const [previous, setPrevious] = useState({ tool, fit: props.fitKey, focus: props.focusKey });
  if (
    previous.tool !== tool ||
    previous.fit !== props.fitKey ||
    previous.focus !== props.focusKey
  ) {
    setPrevious({ tool, fit: props.fitKey, focus: props.focusKey });
    if (previous.tool !== tool) {
      setSteps([]);
      setReference(undefined);
      setAxisDraft(null);
    }
    if (previous.fit !== props.fitKey) {
      setFitted(sheetBounds(doc));
      setPan({ x: 0, y: 0 });
      setLocalZoom(1);
    }
    if (previous.focus !== props.focusKey) {
      const v = doc.views.findIndex((v) => v.id === viewId);
      const center = localToSheet(doc, viewId, { x: 30, y: v === 1 ? -25 : 30 });
      setPan({
        x: center.x - (fitted.x + fitted.width / 2),
        y: center.y - (fitted.y + fitted.height / 2),
      });
    }
  }
  function local(
    e: { clientX: number; clientY: number },
    inverse = svg.current?.getScreenCTM()?.inverse(),
  ): Vec2 {
    if (!inverse) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(inverse);
    return { x: p.x, y: -p.y };
  }
  const fail = (e: unknown) => props.report(e instanceof Error ? e.message : '几何操作失败');
  function accept(next: GeometryDocument, raw?: GeometryDocument) {
    props.commit(next);
    props.consumeSnap();
    setSteps([]);
    setPreview([]);
    setPreviewDoc(null);
    setCandidate(null);
    setLastSnap(raw && JSON.stringify(raw) !== JSON.stringify(next) ? { raw, next } : null);
    const created = next.entities.filter((e) => !doc.entities.some((p) => p.id === e.id));
    if (created.length) props.select([created.at(-1)!.id]);
  }
  function snap(
    docBefore: GeometryDocument,
    raw: GeometryDocument,
    sourceId: string,
    p: Vec2,
    scale: number,
    exclude: string[] = [],
    previous?: SnapCandidate,
    origin?: Vec2,
    threshold = 10,
  ) {
    if (!props.snapping || props.skipSnap) return { raw, next: raw };
    const source = raw.entities.find((e) => e.id === sourceId);
    if (source?.kind !== 'point') return { raw, next: raw };
    const candidate = snapCandidates(docBefore, source.viewId, p, scale, origin, {
      exclude,
      threshold,
      hiddenLayers: props.hiddenLayers,
      grid: props.gridSnap,
      projection: props.projectionSnap,
      previous,
    })[0];
    if (!candidate) return { raw, next: raw };
    try {
      const adjusted = moveEntities(
        raw,
        [sourceId],
        sub(candidate.position, source.position),
        role,
      );
      return { raw, next: confirmSnap(docBefore, adjusted, candidate, sourceId, role), candidate };
    } catch {
      return { raw, next: raw };
    } // An illegal zero-length connection is never committed.
  }
  function drag(g: Gesture, p: Vec2) {
    const raw = dragDocument(g.base, g.ids, sub(p, g.start), role);
    const source = g.ids.length === 1 ? raw.entities.find((e) => e.id === g.ids[0]) : undefined;
    let result =
      source?.kind === 'point'
        ? snap(
            g.base,
            raw,
            source.id,
            source.position,
            g.scale,
            movingIds(g.base, g.ids),
            g.candidate,
            undefined,
            g.snapPixels,
          )
        : { raw, next: raw };
    if (source?.kind === 'segment' && props.snapping && !props.skipSnap) {
      const exclude = movingIds(g.base, g.ids);
      const candidates = [source.startPoint, source.endPoint]
        .flatMap((id) => {
          const p = raw.entities.find((e) => e.id === id);
          if (p?.kind !== 'point') return [];
          return snapCandidates(g.base, p.viewId, p.position, g.scale, undefined, {
            exclude,
            hiddenLayers: props.hiddenLayers,
            threshold: g.snapPixels,
          })
            .filter((c) => c.kind === 'COINCIDENT')
            .map((candidate) => ({ point: p, candidate }));
        })
        .sort((a, b) => a.candidate.distance - b.candidate.distance);
      const chosen = candidates[0];
      if (chosen)
        try {
          const a = localToSheet(raw, chosen.point.viewId, chosen.point.position),
            b = localToSheet(raw, chosen.point.viewId, chosen.candidate.position);
          const adjusted = dragDocument(raw, g.ids, sub(b, a), role);
          result = {
            raw,
            next: confirmSnap(g.base, adjusted, chosen.candidate, chosen.point.id, role),
            candidate: chosen.candidate,
          };
        } catch {
          /* Keep the raw translation if topology would be invalid. */
        }
    }
    g.raw = raw;
    g.next = result.next;
    g.candidate = 'candidate' in result ? result.candidate : undefined;
    setPreviewDoc(result.next);
    setCandidate(g.candidate ?? null);
    setCandidateView(g.hit?.viewId ?? viewId);
    props.report(
      `移动 ΔU ${(p.x - g.start.x).toFixed(2)} · ΔT ${(p.y - g.start.y).toFixed(2)} mm${g.candidate ? ' · 松手连接目标' : ''}`,
    );
  }
  function axisClick(p: Vec2, target?: Hit) {
    if (!axisDraft) return;
    const { spec, phase } = axisDraft;
    if (phase === 'reference') {
      const e = doc.entities.find((e) => e.id === target?.id);
      if (!e || !['line', 'segment'].includes(e.kind) || e.viewId !== spec.retainedViewId)
        throw new Error('请点击保留面中的参考线线身');
      setAxisDraft({ spec: { ...spec, referenceEntityId: e.id }, phase: 'anchor' });
      props.report('点击新轴通过的位置');
    }
    if (phase === 'anchor') {
      setAxisDraft({
        spec: { ...spec, anchor: p },
        phase: spec.method === 'FREE' ? 'direction' : 'side',
      });
      props.report(spec.method === 'FREE' ? '点击轴上第二点' : '点击新轴一侧，选择展开方向');
    }
    if (phase === 'direction') {
      if (distance(p, spec.anchor) < 1e-6) throw new Error('轴的两点不能重合');
      setAxisDraft({ spec: { ...spec, through: p }, phase: 'side' });
      props.report('点击新轴一侧，选择展开方向');
    }
    if (phase === 'side' || phase === 'confirm') {
      const t = axisDirection(doc, spec),
        d = sub(p, spec.anchor),
        cross = t.x * d.y - t.y * d.x;
      if (Math.abs(cross) < 1e-5) throw new Error('请点击轴的一侧');
      setAxisDraft({ spec: { ...spec, side: cross > 0 ? 1 : -1 }, phase: 'confirm' });
      props.report('检查半透明展开侧，确认创建新轴');
    }
  }
  function finish(g: Gesture, p: Vec2) {
    if (g.state === 'panning' || g.state === 'movingRuler') return;
    const target = hitTarget(g.base, p, g.scale, box, props.hiddenLayers, props.selected);
    if (axisDraft) {
      axisClick(p, target);
      return;
    }
    if (g.tool === 'select') {
      if (g.hit && distance(g.start, p) * g.scale > 2 && !readOnly) {
        drag(g, p);
        if (g.next) accept(g.next, g.raw);
      } else
        props.select(
          target ? (g.additive ? [...new Set([...props.selected, target.id])] : [target.id]) : [],
        );
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
    if (g.tool === 'box') {
      const bounds = selectionBounds(g.start, p);
      props.select(
        doc.entities
          .filter(
            (e) =>
              !props.hiddenLayers.includes(e.layerId) &&
              intersectsBox(doc, e, localBounds(doc, e.viewId, bounds)),
          )
          .map((e) => e.id),
      );
      return;
    }
    if (readOnly) return;
    const at = (p: Vec2) => sheetToLocal(g.base, g.viewId, p);
    const samples = rulerSamples(g.samples, props.ruler, g.scale).map((p) => ({
      ...at(p),
      pressure: p.pressure,
    }));
    if (g.tool === 'pen' && samples.length < 2) return;
    const result = finishDrawing(g.base, {
      tool: g.tool,
      viewId: g.viewId,
      role,
      start: at(g.start),
      end: at(p),
      targetId: target?.id,
      steps,
      reference,
      samples,
      scale: g.scale,
    });
    if (result.kind === 'steps') {
      setSteps(result.steps);
      setReference(result.reference);
      props.report(result.message);
      return;
    }
    const raw = result.document;
    let next = raw;
    const created = raw.entities.filter(
      (e) => e.kind === 'point' && !g.base.entities.some((p) => p.id === e.id),
    );
    for (const point of created)
      if (point.kind === 'point')
        next = snap(
          g.base,
          next,
          point.id,
          point.position,
          g.scale,
          [],
          undefined,
          raw.entities.at(-1)?.kind === 'segment' ? at(g.start) : undefined,
          g.snapPixels,
        ).next;
    const line = raw.entities.at(-1);
    if (line?.kind === 'line' && props.snapping && !props.skipSnap) {
      const candidate = snapCandidates(g.base, g.viewId, line.anchor, g.scale, undefined, {
        hiddenLayers: props.hiddenLayers,
        grid: props.gridSnap,
        threshold: g.snapPixels,
      })[0];
      if (candidate)
        next = moveEntities(raw, [line.id], sub(candidate.position, line.anchor), role);
    }
    accept(next, raw);
    setReference(undefined);
    if (result.rawStroke) setLastPen({ raw: result.rawStroke, next });
    if (result.suggestion && result.rawStroke)
      setSuggestion({
        base: g.base,
        raw: result.rawStroke,
        samples,
        viewId: g.viewId,
        scale: g.scale,
        options: result.suggestion,
      });
    if (result.message) props.report(result.message);
  }

  function down(e: ReactPointerEvent<SVGSVGElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    svg.current?.focus({ preventScroll: true });
    // A pen stroke owns its transform until up/cancel. Palm/touch cannot change its camera.
    if (gesture.current?.state === 'drawingStroke' && e.pointerType === 'touch') return;
    if (e.isTrusted) svg.current?.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size >= 2) {
      gesture.current = null;
      setPreviewDoc(null);
      setPreview([]);
      setState('pinching');
      return;
    }
    setLastSnap(null);
    setLastPen(null);
    setSuggestion(null);
    setInterrupted(null);
    const p = local(e),
      hit = hitTarget(doc, p, cssScale(), box, props.hiddenLayers, props.selected),
      pan =
        tool === 'pan' ||
        space.current ||
        (tool === 'pen' && e.pointerType === 'touch' && !props.fingerDraw);
    const ids = hit ? (props.selected.includes(hit.id) ? props.selected : [hit.id]) : [];
    gesture.current = {
      id: e.pointerId,
      start: p,
      last: p,
      screen: { x: e.clientX, y: e.clientY },
      inverse: svg.current!.getScreenCTM()!.inverse(),
      scale: cssScale(),
      snapPixels: e.pointerType === 'touch' ? 16 : 10,
      base: doc,
      tool,
      hit,
      ids,
      viewId,
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
      additive: e.shiftKey,
    };
    setState(gesture.current.state);
    if (tool === 'select' && hit && !props.selected.includes(hit.id))
      props.select(e.shiftKey ? [...props.selected, hit.id] : [hit.id]);
  }
  function move(e: ReactPointerEvent<SVGSVGElement>) {
    if (!pointers.current.has(e.pointerId)) return;
    const old = [...pointers.current.values()];
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const current = [...pointers.current.values()],
        before = distance(old[0], old[1]),
        after = distance(current[0], current[1]);
      if (before > 1) setLocalZoom((z) => Math.max(0.25, Math.min(8, (z * after) / before)));
      setPan((v) => ({
        x: v.x - (current[0].x + current[1].x - old[0].x - old[1].x) / 2 / cssScale(),
        y: v.y + (current[0].y + current[1].y - old[0].y - old[1].y) / 2 / cssScale(),
      }));
      return;
    }
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    if (JSON.stringify(g.base) !== JSON.stringify(doc)) {
      cancel();
      props.report('文档已更新，已取消未提交拖动');
      return;
    }
    const p = local(e, g.inverse);
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
      if (g.tool === 'select' && g.hit && !readOnly && !axisDraft) {
        g.state =
          g.hit.kind === 'point'
            ? 'draggingPoint'
            : g.hit.kind === 'endpoint'
              ? 'draggingEndpoint'
              : 'draggingSelection';
        setState(g.state);
        drag(g, p);
      } else if (g.tool === 'pen') {
        const events = e.nativeEvent.getCoalescedEvents?.();
        for (const sample of events?.length ? events : [e.nativeEvent])
          appendSample(g, local(sample, g.inverse), sample.pressure);
        setPreview([...g.samples]);
      } else if (!['projection', 'select'].includes(g.tool)) {
        setPreview([g.start, p]);
        if (props.snapping && !props.skipSnap) {
          const candidate = snapCandidates(
            g.base,
            g.viewId,
            sheetToLocal(g.base, g.viewId, p),
            g.scale,
            undefined,
            { hiddenLayers: props.hiddenLayers, grid: props.gridSnap, previous: g.candidate },
          )[0];
          g.candidate = candidate;
          setCandidate(candidate ?? null);
          setCandidateView(g.viewId);
        }
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
  function up(e: ReactPointerEvent<SVGSVGElement>) {
    const g = gesture.current;
    const wasPinching = pointers.current.size >= 2 || state === 'pinching';
    pointers.current.delete(e.pointerId);
    if (g && g.id !== e.pointerId) return;
    gesture.current = null;
    setPreview([]);
    setPreviewDoc(null);
    setCandidate(null);
    setState('idle');
    // Clear the transaction before releasing capture: the normal lostcapture event is not cancellation.
    if (svg.current?.hasPointerCapture(e.pointerId)) svg.current.releasePointerCapture(e.pointerId);
    if (wasPinching) return;
    if (g)
      try {
        if (JSON.stringify(g.base) !== JSON.stringify(doc))
          throw new Error('文档已更新，已取消未提交操作');
        const p = local(e, g.inverse);
        if (g.tool === 'pen') appendSample(g, p, e.pressure);
        finish(g, p);
      } catch (error) {
        fail(error);
      }
  }
  const scale = size.width / box.width;
  return (
    <section className="geo-view geo-active">
      <div className="geo-view-title">
        统一图纸 · 当前作图框架 {doc.views.find((v) => v.id === viewId)?.name}
      </div>
      <svg
        ref={svg}
        tabIndex={0}
        aria-label="统一展开图绘图区"
        data-interaction={state}
        viewBox={`${box.x} ${-box.y - box.height} ${box.width} ${box.height}`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={cancel}
        onLostPointerCapture={(e) => {
          if (gesture.current?.id === e.pointerId) cancel();
        }}
      >
        <ViewportDrawing
          controls={{ ...props, document: previewDoc ?? doc }}
          viewId={viewId}
          box={box}
          scale={scale}
          preview={preview}
          steps={steps.map((p) => localToSheet(doc, viewId, p))}
          candidate={candidate ? localToSheet(doc, candidateView, candidate.position) : null}
          axisDraft={
            axisDraft && ['side', 'confirm'].includes(axisDraft.phase) ? axisDraft.spec : null
          }
        />
      </svg>
      {!readOnly && (
        <OperationRecovery
          doc={doc}
          role={role}
          lastSnap={lastSnap}
          lastPen={lastPen}
          suggestion={suggestion}
          interrupted={interrupted}
          replace={props.replace}
          commit={accept}
          report={props.report}
          setLastSnap={setLastSnap}
          setLastPen={setLastPen}
          setSuggestion={setSuggestion}
          setInterrupted={setInterrupted}
        />
      )}
      {axisDraft && (
        <div className="geo-snap" role="status">
          新轴 {axisDraft.spec.name} ·{' '}
          {axisDraft.phase === 'confirm' ? '检查展开侧后确认' : '在图纸上定位'}
          <button
            type="button"
            disabled={axisDraft.phase !== 'confirm'}
            onClick={() => {
              try {
                accept(addProjectionAxis(doc, axisDraft.spec, role));
                setAxisDraft(null);
                props.report('新轴已创建；学生投影点由学生自行作图');
              } catch (e) {
                fail(e);
              }
            }}
          >
            确认新轴
          </button>
          <button type="button" onClick={() => setAxisDraft(null)}>
            取消新轴
          </button>
        </div>
      )}
      {!readOnly && orthographic(doc) && (
        <AxisTools
          doc={doc}
          role={role}
          commit={props.commit}
          report={props.report}
          start={(spec) => {
            cancel();
            setAxisDraft({ spec, phase: spec.method === 'FREE' ? 'anchor' : 'reference' });
            props.report(
              spec.method === 'FREE' ? '点击新轴的第一点' : '点击保留投影中的参考线线身',
            );
          }}
        />
      )}
    </section>
  );
}
