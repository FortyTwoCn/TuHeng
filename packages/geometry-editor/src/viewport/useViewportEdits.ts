import { useMemo, useState } from 'react';
import type { GeometryDocument, Vec2 } from '@tuheng/contracts';
import {
  previewCadGrip,
  sheetToLocal,
  snapCandidates,
  type CadGrip,
  type SnapCandidate,
} from '@tuheng/geometry-core';
import { styleNewGeometry } from '../CadPreferences';
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
  }: {
    candidate: SnapCandidate | null;
    setCandidate: (value: SnapCandidate | null) => void;
    setCandidateView: (value: string) => void;
    setPreviewDoc: (value: GeometryDocument | null) => void;
    setState: (value: SessionInteraction) => void;
    resetPreview: () => void;
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
  const snapOptions = {
    objects: props.objectSnap,
    objectTypes: props.objectTypes,
    direction: props.direction,
    gridSpacing: props.gridSpacing,
  };
  function drag(g: Gesture, p: Vec2) {
    setPreviewDoc(dragSelection(g, p, props, candidate));
    setCandidate(g.candidate ?? null);
    setCandidateView(g.hit?.viewId ?? viewId);
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
    accept,
    drag,
  };
}
