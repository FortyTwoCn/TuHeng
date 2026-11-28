import type { GeometryDocument, Vec2 } from '@tuheng/contracts';
import {
  previewTransform,
  solveDraftingSnap,
  localToSheet,
  sheetToLocal,
  pointDraftingOrigins,
  referenceGeometry,
  referenceKey,
  clipReference,
  selectionBounds,
  marqueeSelection,
  sub,
  distance,
  type SnapCandidate,
  type CadGrip,
  type TrackingBase,
} from '@tuheng/geometry-core';
import type { Hit, SessionInteraction as InteractionState } from './interaction-controller';
import { movingIds } from './interaction-controller';
import type { CadPick } from './cad-pointer';
import type { Appearance } from './CadPreferences';
import type { EditorControls, Tool } from './types';
import { draftingSnapControls } from './drafting-snap-controls';
export interface Gesture {
  cadId?: string;
  cadFirst?: CadPick;
  grip?: CadGrip;
  subtract: boolean;
  penOwnsInput: boolean;
  appearance: Appearance;
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
  snapView?: string;
  pausedSnap?: boolean;
  raw?: GeometryDocument;
  next?: GeometryDocument;
  candidate?: SnapCandidate;
}

function appendSelection(selection: string[], ids: string[]) {
  return [...new Set([...selection, ...ids])];
}

export function selectionFromMarquee(gesture: Gesture, ids: string[]) {
  if (gesture.subtract) return gesture.selection.filter((id) => !ids.includes(id));
  return gesture.additive ? appendSelection(gesture.selection, ids) : ids;
}

export function selectionFromClick(gesture: Gesture, hit?: Hit) {
  const { selection, toggle, additive, subtract } = gesture;
  if (!hit) return subtract || additive ? selection : [];
  if (subtract || (toggle && selection.includes(hit.id))) {
    return selection.filter((id) => id !== hit.id);
  }
  if (toggle || additive) return appendSelection(selection, [hit.id]);
  return [hit.id];
}

export function dragSelection(
  g: Gesture,
  p: Vec2,
  props: Parameters<typeof draftingSnapControls>[0] &
    Pick<EditorControls, 'role' | 'ortho' | 'tracking'>,
  previous: SnapCandidate | null,
  tracked: readonly TrackingBase[] = [],
) {
  const role = props.role;
  const raw = previewTransform(g.base, g.ids, sub(p, g.start), role);
  let next = raw;
  g.candidate = undefined;
  g.snapSource = undefined;
  g.snapView = undefined;
  const source = g.ids.length === 1 ? raw.entities.find((e) => e.id === g.ids[0]) : undefined;
  const options = {
    ...draftingSnapControls(props, g.snapPixels, g.pausedSnap),
    ortho: props.ortho,
    trackingBases: props.tracking ? tracked : undefined,
    exclude: movingIds(g.base, g.ids),
    previous: previous ?? undefined,
  };
  function locate(viewId: string, at: Vec2, origins: Vec2[], id?: string) {
    const result = solveDraftingSnap(g.base, viewId, at, g.scale, { ...options, origins });
    return { ...result, viewId, at, id };
  }
  const start = sheetToLocal(g.base, g.viewId, g.start);
  let chosen;
  if (source?.kind === 'point') {
    const origins = pointDraftingOrigins(g.base, source.id, props.hiddenLayers);
    chosen = locate(
      source.viewId,
      source.position,
      !origins.length && props.ortho ? [start] : origins,
      source.id,
    );
  } else {
    const endpoints =
      options.enabled && source?.kind === 'segment' ? [source.startPoint, source.endPoint] : [];
    const choices = endpoints.flatMap((id) => {
      const point = raw.entities.find((e) => e.id === id);
      const original = g.base.entities.find((e) => e.id === id);
      if (point?.kind !== 'point' || original?.kind !== 'point') return [];
      const choice = locate(point.viewId, point.position, [original.position], id);
      return choice.candidate?.kind === 'COINCIDENT' || choice.candidate?.composite ? [choice] : [];
    });
    const pivot = locate(g.viewId, sheetToLocal(g.base, g.viewId, p), [start]);
    chosen = choices.sort((a, b) => a.candidate!.distance - b.candidate!.distance)[0] ?? pivot;
  }
  const { viewId, at, position, candidate, id } = chosen;
  if (distance(at, position) > 1e-8) {
    const a = localToSheet(raw, viewId, at),
      b = localToSheet(raw, viewId, position);
    next = previewTransform(raw, g.ids, sub(b, a), role);
  }
  const movedPoint = id ? next.entities.find((entity) => entity.id === id) : undefined;
  if (movedPoint?.kind !== 'point' || distance(movedPoint.position, position) < 1e-7) {
    g.candidate = candidate;
    g.snapSource = id;
    g.snapView = viewId;
  }
  g.raw = raw;
  g.next = next;
  return next;
}
export function marqueeTargets(g: Gesture, p: Vec2, props: EditorControls, steps: Vec2[]) {
  const first = g.tool === 'box' && steps.length ? steps[0] : g.start;
  const box = selectionBounds(first, p),
    mode: 'window' | 'crossing' = p.x >= first.x ? 'window' : 'crossing';
  const ids = marqueeSelection(g.base, box, mode, props.hiddenLayers).filter(
    (id) =>
      !props.typeFilter || g.base.entities.find((e) => e.id === id)?.kind === props.typeFilter,
  );
  if (props.referenceFilter && props.axes && !props.typeFilter)
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
  return { box, mode, ids };
}
