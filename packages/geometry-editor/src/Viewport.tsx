'use client';
import { primitivePreview, acceptPrimitive } from './primitive-preview';
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
  sheetToLocal,
  drawingViewAt,
  localToSheet,
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
  type InterruptedStroke,
} from './OperationRecovery';
import { AxisTools } from './AxisTools';
import { ConstructionPanel } from './ConstructionPanel';
import { FloatingInspector } from './FloatingInspector';
import { MeasurementOverlay } from './MeasurementOverlay';
import { textEntry, commandRegistry } from './commands';
import { useViewportCamera } from './useViewportCamera';
import {
  previewTransform,
  marqueeSelection,
  interactionThresholds,
  referenceGeometry,
  referenceKey,
  clipReference,
  targetFromKey,
  resolveReference,
  constructLine,
  adjustDirection,
  referenceDirection,
  add,
  scale as multiply,
} from '@tuheng/geometry-core';
import {
  hitTarget,
  hitTargets,
  movingIds,
  type Hit,
  type SessionInteraction as InteractionState,
} from './interaction-controller';
import type { EditorControls, Tool } from './types';
interface Gesture {
  penStyle: EditorControls['session']['penStyle'];
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
  toggle: boolean;
  revision: object;
  selection: string[];
  dragPixels: number;
  snapSource?: string;
  pausedSnap?: boolean;
  raw?: GeometryDocument;
  next?: GeometryDocument;
  candidate?: SnapCandidate;
}
export function Viewport(
  props: EditorControls & {
    viewId: string;
    focusKey: number;
    replace: (doc: GeometryDocument) => void;
  },
) {
  const { document: doc, viewId, tool, role, readOnly, report } = props;
  const svg = useRef<SVGSVGElement>(null),
    gesture = useRef<Gesture | null>(null),
    pointers = useRef(new Map<number, Vec2>()),
    space = useRef(false);
  const pending = useRef<ReactPointerEvent<SVGSVGElement> | null>(null),
    frame = useRef<number | null>(null);
  const [marquee, setMarquee] = useState<{
      box: Bounds;
      mode: 'window' | 'crossing';
      ids: string[];
    } | null>(null),
    [overlaps, setOverlaps] = useState<Hit[]>([]);
  const [constructionPreview, setConstructionPreview] = useState<{
    revision: object;
    next: GeometryDocument;
  } | null>(null);
  const [preview, setPreview] = useState<Vec2[]>([]),
    [previewDoc, setPreviewDoc] = useState<GeometryDocument | null>(null),
    [candidate, setCandidate] = useState<SnapCandidate | null>(null),
    [candidateView, setCandidateView] = useState(viewId);
  const [operationView, setOperationView] = useState<string>(),
    [hoverView, setHoverView] = useState<string>();
  const [steps, setSteps] = useState<Vec2[]>([]),
    [reference, setReference] = useState<string>(),
    [state, setState] = useState<InteractionState>('idle');
  const [lastSnap, setLastSnap] = useState<ReversibleStep | null>(null),
    [lastPen, setLastPen] = useState<ReversibleStep | null>(null),
    [interrupted, setInterrupted] = useState<InterruptedStroke | null>(null);
  const [axisDraft, setAxisDraft] = useState<{
    spec: AxisConstruction;
    phase: 'reference' | 'anchor' | 'direction' | 'side' | 'confirm';
  } | null>(null);
  const busy = useCallback(() => !!gesture.current, []);
  const { size, box, setPan, zoomAt } = useViewportCamera(
    svg,
    doc,
    props.zoom,
    props.fitKey,
    props.focusKey,
    viewId,
    busy,
  );
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
    setPreview([]);
    setPreviewDoc(null);
    setCandidate(null);
    setMarquee(null);
    setSteps([]);
    setOperationView(undefined);
    setReference(undefined);
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    pending.current = null;
    setState('idle');
  }, [report]);
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const key = (e: KeyboardEvent) => {
      if (
        !el.closest('.geometry-editor')?.contains(document.activeElement) ||
        e.isComposing ||
        textEntry(e.target) ||
        (e.target instanceof Element &&
          !!e.target.closest('.geo-popover,.geo-floating-inspector,.geo-panel'))
      )
        return;
      if (e.key === 'Alt' && gesture.current) {
        gesture.current.pausedSnap = true;
        if (gesture.current.raw) {
          gesture.current.next = gesture.current.raw;
          gesture.current.candidate = undefined;
          setPreviewDoc(gesture.current.raw);
          setCandidate(null);
        }
      }
      if (e.code === 'Space') {
        space.current = e.type === 'keydown';
        e.preventDefault();
      }
      if (e.key === 'Escape') {
        if (!gesture.current && !axisDraft && steps.length === 0) return;
        e.preventDefault();
        e.stopPropagation();
        cancel();
        setAxisDraft(null);
        setSteps([]);
      }
    };
    const blur = () => {
      space.current = false;
      cancel();
    };
    const owner = el.closest('.geometry-editor')!;
    owner.addEventListener('keydown', key as EventListener, true);
    owner.addEventListener('keyup', key as EventListener);
    window.addEventListener('blur', blur);
    return () => {
      owner.removeEventListener('keydown', key as EventListener, true);
      owner.removeEventListener('keyup', key as EventListener);
      window.removeEventListener('blur', blur);
    };
  }, [cancel, axisDraft, steps]);
  const [previousRevision, setPreviousRevision] = useState(props.revision);
  if (previousRevision !== props.revision) {
    setPreviousRevision(props.revision);
    setHoverView(undefined);
    setConstructionPreview(null);
    setAxisDraft(null);
    setSteps([]);
    setOperationView(undefined);
    setReference(undefined);
    setPreview([]);
    setPreviewDoc(null);
    setCandidate(null);
  }
  const [previousTool, setPreviousTool] = useState(tool);
  if (previousTool !== tool) {
    setPreviousTool(tool);
    setState('idle');
    setSteps([]);
    setOperationView(undefined);
    setReference(undefined);
    setAxisDraft(null);
    setPreview([]);
    setPreviewDoc(null);
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
    setOperationView(undefined);
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
    paused = false,
  ) {
    if (!props.snapping || props.skipSnap || paused) return { raw, next: raw };
    const source = raw.entities.find((e) => e.id === sourceId);
    if (source?.kind !== 'point') return { raw, next: raw };
    const candidate = snapCandidates(docBefore, source.viewId, p, scale, origin, {
      exclude,
      threshold,
      hiddenLayers: props.hiddenLayers,
      axes: props.axes && props.axesSnap,
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
  function primitive(
    g: Pick<
      Gesture,
      | 'base'
      | 'tool'
      | 'viewId'
      | 'start'
      | 'scale'
      | 'dragPixels'
      | 'snapPixels'
      | 'pausedSnap'
      | 'candidate'
    >,
    p: Vec2,
  ) {
    const at = (p: Vec2) => sheetToLocal(g.base, g.viewId, p);
    const positions =
      g.tool === 'point'
        ? [at(p)]
        : g.tool === 'circle' || g.tool === 'arc'
          ? [...steps, at(p)]
          : distance(g.start, p) * g.scale > g.dragPixels
            ? [at(g.start), at(p)]
            : [at(p), add(at(p), { x: 10, y: 0 })];
    return primitivePreview(
      g.base,
      g.tool,
      g.viewId,
      positions,
      g.scale,
      props.snapping && !props.skipSnap && !g.pausedSnap,
      {
        hiddenLayers: props.hiddenLayers,
        grid: props.gridSnap,
        projection: props.projectionSnap,
        axes: props.axes && props.axesSnap,
        threshold: g.snapPixels,
        previous: g.candidate,
      },
    );
  }
  function drag(g: Gesture, p: Vec2) {
    const raw = previewTransform(g.base, g.ids, sub(p, g.start), role);
    let next = raw;
    g.candidate = undefined;
    g.snapSource = undefined;
    const source = g.ids.length === 1 ? raw.entities.find((e) => e.id === g.ids[0]) : undefined;
    const excluded = movingIds(g.base, g.ids);
    if (source && props.snapping && !props.skipSnap && !g.pausedSnap) {
      const ids =
        source.kind === 'point'
          ? [source.id]
          : source.kind === 'segment'
            ? [source.startPoint, source.endPoint]
            : [];
      const choices = ids.flatMap((id) => {
        const entity = raw.entities.find((e) => e.id === id);
        if (entity?.kind !== 'point') return [];
        const c = snapCandidates(g.base, entity.viewId, entity.position, g.scale, undefined, {
          exclude: excluded,
          threshold: g.snapPixels,
          hiddenLayers: props.hiddenLayers,
          grid: props.gridSnap,
          projection: props.projectionSnap,
          axes: props.axes && props.axesSnap,
          previous: candidate ?? undefined,
        })[0];
        return c && (source.kind === 'point' || c.kind === 'COINCIDENT') ? [{ id, entity, c }] : [];
      });
      const chosen = choices.sort((a, b) => a.c.distance - b.c.distance)[0];
      if (chosen) {
        const a = localToSheet(raw, chosen.entity.viewId, chosen.entity.position),
          b = localToSheet(raw, chosen.entity.viewId, chosen.c.position);
        next = previewTransform(raw, g.ids, sub(b, a), role);
        g.candidate = chosen.c;
        g.snapSource = chosen.id;
      }
    }
    g.raw = raw;
    g.next = next;
    setPreviewDoc(next);
    setCandidate(g.candidate ?? null);
    setCandidateView(g.hit?.viewId ?? viewId);
  }
  function updateMarquee(g: Gesture, p: Vec2) {
    const first = g.tool === 'box' && steps.length ? steps[0] : g.start;
    const box = selectionBounds(first, p),
      mode = p.x >= first.x ? 'window' : 'crossing';
    const ids = marqueeSelection(g.base, box, mode, props.hiddenLayers);
    if (props.referenceFilter && props.axes)
      for (const r of referenceGeometry(g.base)) {
        if (r.extent === 'point') {
          if (
            r.anchor.x >= box.x &&
            r.anchor.x <= box.x + box.width &&
            r.anchor.y >= box.y &&
            r.anchor.y <= box.y + box.height
          )
            ids.push(referenceKey(r.ref));
        } else if (mode === 'crossing' && !!clipReference(r, box)) ids.push(referenceKey(r.ref));
      }
    setMarquee({ box, mode, ids });
    return ids;
  }
  function drawingFrame(p: Vec2, target?: Hit) {
    if (operationView) return operationView;
    const ref = props.session.construction?.reference;
    const entity =
      ref?.kind === 'entity' ? doc.entities.find((e) => e.id === ref.entityId) : undefined;
    if (entity && entity.scope !== 'SHEET') return entity.viewId;
    // Hit tolerances may straddle an axis. A new stroke belongs to its region, not
    // to a nearby point from another projection. Explicit connections/editing retain identity.
    const usesExisting =
      tool === 'select' ||
      tool === 'connect' ||
      (props.session.construction?.phase === 'position' &&
        (target?.kind === 'point' || target?.kind === 'endpoint'));
    return drawingViewAt(
      doc,
      p,
      hoverView ?? viewId,
      usesExisting && target?.kind !== 'reference' ? target?.id : undefined,
    );
  }
  function constructionClick(p: Vec2, target: Hit | undefined, frameId: string) {
    const c = props.session.construction;
    if (!c) return false;
    if (c.phase === 'reference') {
      const reference = target ? targetFromKey(target.id) : undefined;
      if (!reference || !resolveReference(doc, reference).direction)
        throw Error('请选择参考线或轴');
      props.dispatch({
        type: 'patch',
        patch: {
          construction: { ...c, reference, phase: c.mode === 'create' ? 'position' : 'target' },
        },
      });
      props.report(c.mode === 'create' ? '选择通过点或空白位置' : '选择待修改答案线');
      return true;
    }
    if (c.phase === 'target') {
      const reference = c.reference!;
      if (!target || target.kind === 'reference') throw Error('请选择待修改的答案线');
      const next = adjustDirection(doc, target.id, reference, c.spec.directionMode, c.keep, role);
      setConstructionPreview({ revision: props.revision, next });
      props.dispatch({
        type: 'patch',
        patch: { construction: { ...c, targetId: target.id, phase: 'confirm' } },
      });
      props.report('检查方向预览，确认后提交一次；参考线保持不动');
      return true;
    }
    if (c.phase === 'position') {
      const e = doc.entities.find((e) => e.id === target?.id);
      if (e?.kind === 'point' && e.viewId !== frameId)
        throw Error('通过点与参考线不在同一投影面，请选择同面点或空白位置');
      const at = e?.kind === 'point' ? e.position : sheetToLocal(doc, frameId, p);
      setConstructionPreview({
        revision: props.revision,
        next: constructLine(
          doc,
          frameId,
          c.reference!,
          at,
          e?.kind === 'point' ? e.id : undefined,
          c.spec,
          role,
        ),
      });
      props.dispatch({ type: 'patch', patch: { construction: { ...c, phase: 'confirm' } } });
      props.report('检查构造预览，确认后创建；可重新选择通过点');
      setPreview([]);
      return true;
    }
    return true;
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
    const hits = hitTargets(
      g.base,
      p,
      g.scale,
      box,
      props.hiddenLayers,
      props.selected,
      props.axes,
      g.snapPixels,
    );
    const target =
      props.session.construction?.phase === 'reference'
        ? hits.find((h) => {
            try {
              return !!resolveReference(doc, targetFromKey(h.id)).direction;
            } catch {
              return false;
            }
          })
        : hits[0];
    if (constructionClick(p, target, g.viewId)) return;
    if (axisDraft) {
      axisClick(p, target);
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
        props.select(g.additive ? [...new Set([...g.selection, ...ids])] : ids);
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
        props.select(
          target
            ? g.toggle
              ? g.selection.includes(target.id)
                ? g.selection.filter((id) => id !== target.id)
                : [...g.selection, target.id]
              : g.additive
                ? [...new Set([...g.selection, target.id])]
                : [target.id]
            : [],
        );
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
    const at = (p: Vec2) => sheetToLocal(g.base, g.viewId, p);
    const samples = rulerSamples(g.samples, props.ruler, g.scale).map((p) => ({
      ...at(p),
      pressure: p.pressure,
    }));
    if (g.tool === 'pen' && samples.length < 2) return;
    const result = finishDrawing(g.base, {
      tool: g.tool,
      penStyle: g.penStyle,
      viewId: g.viewId,
      role,
      start: at(g.start),
      end: at(p),
      targetId: target?.id,
      steps,
      reference,
      samples,
      scale: g.scale,
      clickThreshold: g.dragPixels,
    });
    if (result.kind === 'steps') {
      setOperationView(g.viewId);
      setSteps(result.steps);
      setReference(result.reference);
      props.report(result.message);
      return;
    }
    const raw = result.document;
    let next = raw;
    const simple = ['point', 'segment', 'hidden', 'line', 'circle', 'arc'].includes(g.tool);
    if (simple) {
      try {
        next = acceptPrimitive(g.base, raw, primitive(g, p), role);
      } catch {
        props.report('本次吸附会产生非法几何，保留原始作图');
      }
    }
    const created = raw.entities.filter(
      (e) => e.kind === 'point' && !g.base.entities.some((p) => p.id === e.id),
    );
    for (const point of simple ? [] : created)
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
          g.pausedSnap,
        ).next;
    const line = raw.entities.at(-1);
    if (!simple && line?.kind === 'line' && props.snapping && !props.skipSnap && !g.pausedSnap) {
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
    if (!['select', 'pan', 'box'].includes(tool) || props.session.construction || axisDraft) {
      setLastSnap(null);
      setLastPen(null);
      setInterrupted(null);
    }
    const p = local(e),
      hit = hitTarget(
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
      tool,
      penStyle: props.session.penStyle,
      hit,
      ids,
      viewId: drawingFrame(p, hit),
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
    if (!pan && !axisDraft) {
      setHoverView(gesture.current.viewId);
      props.dispatch({ type: 'patch', patch: { active: gesture.current.viewId } });
    }
  }
  function move(e: ReactPointerEvent<SVGSVGElement>) {
    if (!pointers.current.has(e.pointerId)) {
      const frameId = drawingFrame(local(e));
      setHoverView(frameId);
      if (steps.length && ['circle', 'arc'].includes(tool)) {
        const p = local(e),
          threshold =
            interactionThresholds[
              e.pointerType === 'touch' ? 'touch' : e.pointerType === 'pen' ? 'pen' : 'mouse'
            ];
        const value = primitive(
          {
            base: doc,
            tool,
            viewId: frameId,
            start: p,
            scale: cssScale(),
            dragPixels: threshold.drag,
            snapPixels: threshold.snap,
          },
          p,
        );
        setPreview(value.points.map((p) => localToSheet(doc, frameId, p)));
        setState('drawingPrimitive');
        setCandidate(value.candidates.at(-1) ?? null);
        setCandidateView(frameId);
      }
      if (
        props.session.construction?.phase === 'position' &&
        props.session.construction.reference
      ) {
        try {
          const c = props.session.construction,
            p = local(e),
            a = sheetToLocal(doc, frameId, p),
            d = referenceDirection(doc, frameId, c.reference!, c.spec.directionMode);
          setPreview([
            p,
            localToSheet(
              doc,
              frameId,
              add(a, multiply(d, c.spec.geometryExtent === 'segment' ? c.spec.length : 100)),
            ),
          ]);
        } catch (error) {
          setPreview([]);
          fail(error);
        }
      }
      return;
    }
    const old = [...pointers.current.values()];
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const current = [...pointers.current.values()],
        before = distance(old[0], old[1]),
        after = distance(current[0], current[1]);
      if (before > 1)
        zoomAt(
          after / before,
          { x: (old[0].x + old[1].x) / 2, y: (old[0].y + old[1].y) / 2 },
          {
            x: (current[0].x + current[1].x - old[0].x - old[1].x) / 2,
            y: (current[0].y + current[1].y - old[0].y - old[1].y) / 2,
          },
        );
      return;
    }
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    if (g.revision !== props.revision || g.tool !== tool) {
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
      if (props.session.construction) {
        const c = props.session.construction;
        if (c.phase === 'position' && c.reference) {
          const start = sheetToLocal(doc, g.viewId, p),
            d = referenceDirection(doc, g.viewId, c.reference, c.spec.directionMode),
            end = add(
              start,
              multiply(d, c.spec.geometryExtent === 'segment' ? c.spec.length : 100),
            );
          setPreview([localToSheet(doc, g.viewId, start), localToSheet(doc, g.viewId, end)]);
        }
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
      } else if (g.tool === 'pen') {
        setPreview([...g.samples]);
      } else if (!['projection', 'select'].includes(g.tool)) {
        setState('drawingPrimitive');
        const value = primitive(g, p);
        g.candidate = value.candidates.at(-1);
        setCandidate(g.candidate ?? null);
        setCandidateView(g.viewId);
        setPreview(value.points.map((p) => localToSheet(g.base, g.viewId, p)));
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
  function queueMove(e: ReactPointerEvent<SVGSVGElement>) {
    if (tool === 'pen' && gesture.current?.state === 'drawingStroke') {
      const g = gesture.current;
      if (g.id !== e.pointerId) return;
      const events = e.nativeEvent.getCoalescedEvents?.();
      for (const sample of events?.length ? events : [e.nativeEvent])
        appendSample(g, local(sample, g.inverse), sample.pressure);
    }
    pending.current = e;
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const event = pending.current;
      pending.current = null;
      if (event) move(event);
    });
  }
  function up(e: ReactPointerEvent<SVGSVGElement>) {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    if (pending.current) {
      move(pending.current);
      pending.current = null;
    }
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
        if (g.revision !== props.revision || g.tool !== tool)
          throw new Error('文档已更新，已取消未提交操作');
        const p = local(e, g.inverse);
        if (g.tool === 'pen') appendSample(g, p, e.pressure);
        finish(g, p);
      } catch (error) {
        fail(error);
      }
  }
  const scale = size.width / box.width;
  const displayedView = operationView ?? (state !== 'idle' ? viewId : (hoverView ?? viewId));
  return (
    <section className="geo-view geo-active">
      {overlaps.length > 1 &&
        props.selected.length > 0 &&
        state === 'idle' &&
        tool === 'select' &&
        !props.session.construction && (
          <select
            className="geo-overlaps"
            aria-label="重叠对象"
            value={props.selected[0]}
            onChange={(e) => props.select([e.target.value])}
          >
            {overlaps.map((h, i) => (
              <option key={h.id} value={h.id}>
                {h.kind === 'reference'
                  ? resolveReference(doc, targetFromKey(h.id)).name
                  : `对象 ${i + 1} · ${doc.entities.find((e) => e.id === h.id)?.kind}`}
              </option>
            ))}
          </select>
        )}
      <div className="geo-view-title">
        统一图纸 · 自动识别投影面：{doc.views.find((v) => v.id === displayedView)?.name} ·{' '}
        {commandRegistry.find((c) => c.id === tool)?.name}
      </div>
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
        onPointerUp={up}
        onPointerCancel={(e) => {
          if (gesture.current?.id === e.pointerId || pointers.current.has(e.pointerId)) cancel();
        }}
        onLostPointerCapture={(e) => {
          if (gesture.current?.id === e.pointerId) cancel();
        }}
      >
        <ViewportDrawing
          controls={{
            ...props,
            document:
              (props.session.construction?.phase === 'confirm' &&
              constructionPreview?.revision === props.revision
                ? constructionPreview.next
                : null) ??
              previewDoc ??
              doc,
            highlighted: [...props.highlighted, ...(marquee?.ids ?? [])],
          }}
          viewId={operationView ?? viewId}
          box={box}
          scale={scale}
          preview={preview}
          steps={
            tool === 'box' ? steps : steps.map((p) => localToSheet(doc, operationView ?? viewId, p))
          }
          candidate={candidate ? localToSheet(doc, candidateView, candidate.position) : null}
          axisDraft={
            axisDraft && ['side', 'confirm'].includes(axisDraft.phase) ? axisDraft.spec : null
          }
        />
        {marquee && (
          <g data-selection-mode={marquee.mode} data-transient="marquee" pointerEvents="none">
            <rect
              x={marquee.box.x}
              y={-marquee.box.y - marquee.box.height}
              width={marquee.box.width}
              height={marquee.box.height}
              fill={marquee.mode === 'window' ? '#0284c71a' : '#16a34a1a'}
              stroke={marquee.mode === 'window' ? '#0284c7' : '#15803d'}
              strokeWidth={1 / scale}
              strokeDasharray={
                marquee.mode === 'crossing' ? `${5 / scale} ${3 / scale}` : undefined
              }
            />
            <text
              x={marquee.box.x + 5 / scale}
              y={-marquee.box.y - marquee.box.height + 16 / scale}
              fontSize={12 / scale}
            >
              {marquee.mode === 'window' ? 'Window · 完全包含' : 'Crossing · 包含或相交'}
            </text>
          </g>
        )}
        {state !== 'idle' && state !== 'drawingStroke' && !marquee && (
          <MeasurementOverlay
            doc={previewDoc ?? doc}
            ids={state.startsWith('dragging') ? props.selected : []}
            path={preview}
            tool={tool}
            box={box}
            scale={scale}
          />
        )}
      </svg>
      {candidate && (
        <div className="geo-snap-feedback" data-snap-feedback="true">
          吸附：
          {candidate.label ??
            {
              COINCIDENT: '端点',
              MIDPOINT: '中点',
              INTERSECTION: '交点',
              POINT_ON_LINE: '线上点',
              AXIS_DIRECTION: '沿轴方向',
              GRID: '网格',
              PROJECTION_ALIGNMENT: '投影对齐',
            }[candidate.kind as 'COINCIDENT'] ??
            candidate.kind}{' '}
          <button
            type="button"
            onPointerDown={(e) => {
              e.preventDefault();
              if (gesture.current) {
                gesture.current.pausedSnap = true;
                drag(gesture.current, gesture.current.last);
              }
            }}
          >
            暂停当前吸附
          </button>
          <span>按 Alt 暂停</span>
        </div>
      )}
      {state === 'idle' &&
        props.selected.length > 0 &&
        tool === 'select' &&
        !axisDraft &&
        !props.session.construction && (
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
      {props.session.construction && (
        <ConstructionPanel
          construction={props.session.construction}
          document={doc}
          dispatch={props.dispatch}
          validPreview={!!constructionPreview && constructionPreview.revision === props.revision}
          confirm={() => {
            if (constructionPreview?.revision === props.revision) accept(constructionPreview.next);
          }}
          clearPreview={() => {
            setConstructionPreview(null);
            setPreview([]);
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
      {!readOnly && orthographic(doc) && props.session.panel === 'axis' && (
        <div className="geo-panel" role="dialog" aria-label="新增投影轴">
          <button
            type="button"
            onClick={() => props.dispatch({ type: 'patch', patch: { panel: null } })}
          >
            关闭面板
          </button>
          <AxisTools
            doc={doc}
            role={role}
            commit={props.commit}
            report={props.report}
            initialSystemId={
              props.selected.map((id) => targetFromKey(id)).find((r) => r.kind === 'projectionAxis')
                ?.systemId
            }
            start={(spec) => {
              cancel();
              props.dispatch({ type: 'patch', patch: { panel: null } });
              setAxisDraft({ spec, phase: spec.method === 'FREE' ? 'anchor' : 'reference' });
              props.report(
                spec.method === 'FREE' ? '点击新轴的第一点' : '点击保留投影中的参考线线身',
              );
            }}
          />
        </div>
      )}
    </section>
  );
}
