import type { Vec2 } from '@tuheng/contracts';
import {
  cadDraftingOptions,
  cadDefinition,
  distance,
  isPointFeature,
  segmentSatisfiesGuide,
  sheetToLocal,
  snapCandidateSet,
  solveDraftingSnap,
  type CadSession,
  type SnapCandidate,
  type TrackingBase,
} from '@tuheng/geometry-core';
import type { EditorControls } from './types';
import type { Hit } from './interaction-controller';
import { draftingSnapControls } from './drafting-snap-controls';

export type CadPick = {
  type: 'point';
  position: Vec2;
  rawPosition: Vec2;
  directionPosition?: Vec2;
  entityId?: string;
  hiddenLayers?: string[];
  viewId: string;
  snap?: SnapCandidate;
};

export type CadTrackingHover = { viewId: string; snap: SnapCandidate };

/** 显式长度可以沿同一方向移动终点。保留相切预览时，有限线段必须仍覆盖切点。 */
export function lineSnapAt(pick: CadPick, anchor: Vec2, end: Vec2): SnapCandidate | undefined {
  const snap = pick.snap;
  if (!snap || distance(anchor, end) < 1e-8) return;
  if (distance(end, snap.position) < 1e-8) return snap;
  const guide = snap.guide;
  if (!guide || !segmentSatisfiesGuide(anchor, end, guide)) return;
  // 终点离开吸附位置后，只保留仍满足的方向关系，清除原来的点引用。
  const kind = {
    parallel: 'PARALLEL',
    perpendicular: 'PERPENDICULAR',
    tangent: 'TANGENT',
  } as const;
  const label = { parallel: '平行方向', perpendicular: '垂直方向', tangent: '相切' };
  return {
    kind: kind[guide.kind],
    label: label[guide.kind],
    position: end,
    anchor,
    entityIds: [guide.sourceId],
    guide,
    positionOnly: true,
    distance: 0,
  };
}
export function locateCadPoint(
  session: CadSession,
  controls: Pick<
    EditorControls,
    | 'document'
    | 'ortho'
    | 'snapping'
    | 'skipSnap'
    | 'direction'
    | 'tracking'
    | 'objectSnap'
    | 'objectTypes'
    | 'gridSpacing'
    | 'axes'
    | 'axesSnap'
    | 'gridSnap'
    | 'projectionSnap'
    | 'hiddenLayers'
  >,
  sheet: Vec2,
  frameId: string,
  hits: Hit[],
  scale: number,
  threshold: number,
  paused: boolean,
  previous?: SnapCandidate,
  tracked: readonly TrackingBase[] = [],
  acquire = false,
) {
  const doc = controls.document;
  const frame = session.points.length || session.ids.length ? session.viewId : frameId;
  const raw = sheetToLocal(doc, frame, sheet);
  const options = { ...draftingSnapControls(controls, threshold, paused), previous };
  const drafting = cadDraftingOptions(session, controls.ortho);
  const sameFrame = frameId === frame;
  const origin = sameFrame ? drafting.origins?.[0] : undefined;
  const acceptsHoverPoint =
    acquire && options.enabled && controls.objectSnap
      ? (p: Vec2) => !origin || distance(p, origin) >= 1e-7
      : undefined;
  const localHover = controls.tracking && sameFrame ? acceptsHoverPoint : undefined;
  const selection =
    session.phase !== 'points' && options.enabled
      ? snapCandidateSet(doc, frame, raw, scale, undefined, options, undefined, localHover)
      : undefined;
  const { candidate, position, hoverFeature } =
    session.phase === 'points'
      ? solveDraftingSnap(doc, frame, raw, scale, {
          ...options,
          ...drafting,
          trackingBases: controls.tracking ? tracked : undefined,
          acceptsHoverPoint: localHover,
        })
      : { position: raw, candidate: selection?.ordinary[0], hoverFeature: selection?.hoverFeature };
  let feature = hoverFeature;
  if (acceptsHoverPoint && controls.tracking && !sameFrame) {
    feature = snapCandidateSet(
      doc,
      frameId,
      sheetToLocal(doc, frameId, sheet),
      scale,
      undefined,
      { ...options, previous: undefined },
      undefined,
      acceptsHoverPoint,
    ).hoverFeature;
  } else if (
    acceptsHoverPoint &&
    !controls.tracking &&
    sameFrame &&
    candidate &&
    isPointFeature(candidate) &&
    distance(raw, candidate.position) <= threshold / scale &&
    acceptsHoverPoint(candidate.position)
  ) {
    // Keep the point already picked at the cursor ready for F11 to show its guides.
    feature = candidate;
  }
  const hover: CadTrackingHover | undefined = feature && { viewId: frameId, snap: feature };
  const angularBody =
    session.commandId === 'angularDimension' &&
    !session.points.length &&
    session.ids.length < 2 &&
    (session.parameters.angularMethod !== '三点' || session.ids.length > 0);
  const radial = cadDefinition(session.commandId).selection === 'radial';
  const needsBody =
    angularBody ||
    radial ||
    ['trim', 'extend', 'fillet', 'chamfer', 'hatch'].includes(session.commandId);
  const hit = needsBody
    ? hits.find((h) => {
        if (h.kind !== 'body') return false;
        if (!angularBody && !radial) return true;
        const kind = doc.entities.find((e) => e.id === h.id)?.kind;
        return angularBody
          ? kind === 'segment' || kind === 'line'
          : kind === 'circle' || kind === 'arc';
      })
    : hits[0];
  const nodeId = candidate?.kind === 'COINCIDENT' ? candidate.entityIds[0] : undefined;
  const pick: CadPick = {
    type: 'point',
    viewId: frame,
    position: candidate?.position ?? position,
    rawPosition: raw,
    directionPosition:
      candidate?.guide ||
      candidate?.composite ||
      candidate?.kind === 'AXIS_DIRECTION' ||
      candidate?.kind === 'TRACKING'
        ? candidate.position
        : drafting.ortho
          ? position
          : raw,
    snap: candidate,
    ...(['hatch', 'trim'].includes(session.commandId)
      ? { hiddenLayers: controls.hiddenLayers }
      : {}),
    entityId: needsBody ? hit?.id : (nodeId ?? (hit?.viewId === frame ? hit.id : undefined)),
  };
  return { candidate, pick, hover };
}
