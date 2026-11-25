import type { GeometryDocument, Vec2 } from '@tuheng/contracts';
import {
  previewTransform,
  snapCandidates,
  localToSheet,
  referenceGeometry,
  referenceKey,
  clipReference,
  selectionBounds,
  marqueeSelection,
  sub,
  type SnapCandidate,
  type CadGrip,
} from '@tuheng/geometry-core';
import type { Hit, SessionInteraction as InteractionState } from './interaction-controller';
import { movingIds } from './interaction-controller';
import type { CadPick } from './cad-pointer';
import type { Appearance } from './CadPreferences';
import type { EditorControls, Tool } from './types';
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
  props: EditorControls,
  previous: SnapCandidate | null,
) {
  const role = props.role;
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
        objects: props.objectSnap,
        objectTypes: props.objectTypes,
        direction: props.direction,
        gridSpacing: props.gridSpacing,
        exclude: excluded,
        threshold: g.snapPixels,
        hiddenLayers: props.hiddenLayers,
        grid: props.gridSnap,
        projection: props.projectionSnap,
        axes: props.axes && props.axesSnap,
        previous: previous ?? undefined,
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
