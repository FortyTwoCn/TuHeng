import { useMemo, useState } from 'react';
import type { GeometryDocument, Vec2 } from '@tuheng/contracts';
import {
  previewCadGrip,
  gripDraftingTarget,
  sheetToLocal,
  solveDraftingSnap,
  type CadGrip,
  type SnapCandidate,
  type TrackingBase,
} from '@tuheng/geometry-core';
import { styleNewGeometry } from '../CadPreferences';
import { draftingSnapControls } from '../drafting-snap-controls';
import type { LineFields } from '../DynamicLineInput';
import type { SessionInteraction } from '../interaction-controller';
import { movingIds } from '../interaction-controller';
import { exactDrag, type DragMeasurement } from '../measured-drag';
import type { InterruptedStroke, ReversibleStep } from '../OperationRecovery';
import { dragSelection, type Gesture } from '../selection-gesture';
import type { ViewportProps } from './viewport-types';

// 夹点和选集的拖动先产生预览，由同一个入口提交或恢复正式文档。
export function useViewportEdits(
  props: ViewportProps,
  {
    candidate,
    setCandidate,
    setCandidateView,
    setPreviewDoc,
    setState,
    resetPreview,
    tracked,
  }: {
    candidate: SnapCandidate | null;
    setCandidate: (value: SnapCandidate | null) => void;
    setCandidateView: (value: string) => void;
    setPreviewDoc: (value: GeometryDocument | null) => void;
    setState: (value: SessionInteraction) => void;
    resetPreview: () => void;
    tracked: readonly TrackingBase[];
  },
) {
  const { document: doc, role, tool, viewId } = props;
  const cad = props.cad.session;
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
  const [lastSnap, setLastSnap] = useState<ReversibleStep | null>(null),
    [lastPen, setLastPen] = useState<ReversibleStep | null>(null),
    [interrupted, setInterrupted] = useState<InterruptedStroke | null>(null);
  function commitDrag(cancel: () => void, focus: () => void) {
    if (!dragMeasure || dragMeasure.base !== doc) {
      cancel();
      return;
    }
    try {
      const result = exactDrag(dragMeasure, dragFields ?? {}, role);
      cancel();
      accept(result.document);
      setDragError('');
      focus();
    } catch (error) {
      setDragError(error instanceof Error ? error.message : '输入无效');
    }
  }
  function previewGrip(
    base: GeometryDocument,
    grip: CadGrip,
    p: Vec2,
    scale: number,
    threshold: number,
    paused?: boolean,
  ) {
    const target = gripDraftingTarget(base, grip, props.hiddenLayers);
    if (!target) return;
    const { entity, origins, pointId } = target;
    const raw = sheetToLocal(base, entity.viewId, p);
    const result = solveDraftingSnap(base, entity.viewId, raw, scale, {
      ...draftingSnapControls(props, threshold, paused),
      exclude: pointId ? movingIds(base, [entity.id, pointId]) : [entity.id],
      origins,
      ortho: props.ortho,
      trackingBases: props.tracking ? tracked : undefined,
      previous: candidate ?? undefined,
    });
    const next = previewCadGrip(base, grip, result.position, role);
    setPreviewDoc(next);
    setCandidate(result.candidate ?? null);
    setCandidateView(entity.viewId);
    return { next, candidate: result.candidate, pointId };
  }
  function updateGrip(g: Gesture, p: Vec2) {
    if (!g.grip) return;
    const result = previewGrip(g.base, g.grip, p, g.scale, g.snapPixels, g.pausedSnap);
    g.next = result?.next;
    g.candidate = result?.candidate;
    g.snapSource = result?.pointId;
    setState('draggingEndpoint');
  }
  function accept(next: GeometryDocument, raw?: GeometryDocument, appearance = props.appearance) {
    const alternative = raw && JSON.stringify(raw) !== JSON.stringify(next) ? raw : undefined;
    const applied = props.commit(styleNewGeometry(doc, next, appearance));
    if (!applied) return;
    props.consumeSnap();
    resetPreview();
    setLastSnap(
      alternative ? { raw: styleNewGeometry(doc, alternative, appearance), next: applied } : null,
    );
    const created = applied.entities.filter((e) => !doc.entities.some((p) => p.id === e.id));
    if (created.length && tool !== 'pen') props.select([created.at(-1)!.id]);
    return applied;
  }
  function drag(g: Gesture, p: Vec2) {
    setPreviewDoc(dragSelection(g, p, props, candidate, tracked));
    setCandidate(g.candidate ?? null);
    setCandidateView(g.snapView ?? viewId);
  }
  return {
    dragError,
    setDragError,
    pickedGrip,
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
    commitDrag,
    updateGrip,
    previewGrip,
    accept,
    drag,
  };
}
