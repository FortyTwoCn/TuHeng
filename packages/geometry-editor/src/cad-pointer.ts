import type { Vec2 } from '@tuheng/contracts';
import {
  sheetToLocal,
  snapCandidates,
  commonTangentCandidates,
  nearestDraftingCandidate,
  trackingCandidate,
  type TrackingBase,
  cross,
  dot,
  distance,
  sub,
  unit,
  type CadSession,
  type SnapCandidate,
} from '@tuheng/geometry-core';
import type { EditorControls } from './types';
import type { Hit } from './interaction-controller';

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

/** An explicit length may move the endpoint along the same direction. A tangent
 * still requires the finite segment to reach the actual point of contact. */
export function lineSnapAt(pick: CadPick, anchor: Vec2, end: Vec2): SnapCandidate | undefined {
  const snap = pick.snap;
  if (!snap || distance(anchor, end) < 1e-8) return;
  if (distance(end, snap.position) < 1e-8) return snap;
  const guide = snap.guide;
  if (!guide) return;
  const along = unit(sub(end, anchor));
  const error =
    guide.kind === 'perpendicular' ? dot(along, guide.direction) : cross(along, guide.direction);
  if (Math.abs(error) > 1e-8) return;
  if (guide.kind === 'tangent') {
    const contact = sub(guide.contact, anchor);
    if (
      Math.abs(cross(contact, along)) > 1e-7 ||
      dot(contact, along) < -1e-7 ||
      dot(contact, along) > distance(end, anchor) + 1e-7
    )
      return;
  }
  // The adjusted end has left the original point feature. Keep only the
  // verified direction, never the node/foot identity of that original pick.
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
    entityIds: [guide.sourceId],
    guide,
    positionOnly: true,
    distance: 0,
  };
}
export function locateCadPoint(
  session: CadSession,
  controls: EditorControls,
  sheet: Vec2,
  frameId: string,
  hits: Hit[],
  scale: number,
  threshold: number,
  paused: boolean,
  previous?: SnapCandidate,
  tracked: readonly TrackingBase[] = [],
) {
  const doc = controls.document;
  const frame = session.points.length || session.ids.length ? session.viewId : frameId;
  const raw = sheetToLocal(doc, frame, sheet);
  const last = session.points.at(-1);
  const straightCommand = session.commandId === 'segment' || session.commandId === 'line';
  const lineRelations = !!last && straightCommand;
  let position = raw;
  const ortho = last && session.phase === 'points' && (
    (session.commandId === 'ellipse' && session.points.length === 1) ||
    (controls.ortho && [
      'segment', 'line', 'move', 'copy', 'circle', 'arc', 'arc3',
      'spline', 'polygon', 'linearDimension', 'alignedDimension', 'direction',
    ].includes(session.commandId))
  );
  const axisOrigin = session.commandId === 'arc' ? session.points[0] : last;
  const horizontal =
    !!axisOrigin && Math.abs(raw.x - axisOrigin.x) >= Math.abs(raw.y - axisOrigin.y);
  if (ortho && axisOrigin)
    position = horizontal ? { x: raw.x, y: axisOrigin.y } : { x: axisOrigin.x, y: raw.y };
  const onAxis = (q: Vec2) =>
    !ortho || !axisOrigin || Math.abs(horizontal ? q.y - axisOrigin.y : q.x - axisOrigin.x) < 1e-8;
  let candidate: SnapCandidate | undefined;
  if (controls.snapping && !controls.skipSnap && !paused) {
    const options = {
      lineRelations,
      direction: controls.direction && (!ortho || lineRelations),
      objects: controls.objectSnap,
      objectTypes: controls.objectTypes,
      gridSpacing: controls.gridSpacing,
      axes: controls.axes && controls.axesSnap,
      grid: controls.gridSnap,
      projection: controls.projectionSnap,
      hiddenLayers: controls.hiddenLayers,
      threshold,
      previous,
    };
    candidate = snapCandidates(doc, frame, position, scale, last, options).find(c => onAxis(c.position));
    const weak = !candidate || ['AXIS_DIRECTION', 'GRID'].includes(candidate.kind);
    const radius = threshold / scale;
    if (straightCommand && !last && (!candidate || weak || candidate.kind === 'FOOT')) {
      const tangent = commonTangentCandidates(doc, frame, position, radius, options)[0];
      if (tangent) candidate = tangent;
    }
    const paired = lineRelations ? session.pointSnaps?.[0]?.pairedTangent : undefined;
    if (
      paired && last && controls.objectSnap && controls.objectTypes.includes('tangent') &&
      distance(raw, paired.contact) <= radius && onAxis(paired.contact) &&
      doc.entities.some(({ id, layerId }) =>
        id === paired.sourceId && !controls.hiddenLayers.includes(layerId),
      )
    ) {
      candidate = {
        kind: 'TANGENT',
        label: '公切点',
        position: paired.contact,
        entityIds: [paired.sourceId],
        distance: distance(raw, paired.contact),
        positionOnly: true,
        guide: {
          kind: 'tangent',
          sourceId: paired.sourceId,
          origin: last,
          contact: paired.contact,
          direction: unit(sub(paired.contact, last)),
        },
      };
    }
    if ((!candidate || (weak && candidate.kind !== 'TANGENT')) && session.phase === 'points') {
      candidate = (controls.tracking ? trackingCandidate(doc, frame, position, tracked, radius, options, onAxis) : undefined)
        ?? nearestDraftingCandidate(doc, frame, position, radius, options, onAxis)
        ?? candidate;
    }
  }
  const angularBody = session.commandId === 'angularDimension' && !session.points.length &&
    session.ids.length < 2 && (session.parameters.angularMethod !== '三点' || session.ids.length > 0);
  const needsBody = angularBody || [
    'trim',
    'extend',
    'fillet',
    'chamfer',
    'radiusDimension',
    'diameterDimension',
    'hatch',
  ].includes(session.commandId);
  const hit = needsBody ? hits.find(h => h.kind === 'body' &&
    (!angularBody || doc.entities.some(e=>e.id===h.id && (e.kind==='segment' || e.kind==='line')))) : hits[0];
  const nodeId = candidate?.kind === 'COINCIDENT' ? candidate.entityIds[0] : undefined;
  const pick: CadPick = {
    type: 'point',
    viewId: frame,
    position: candidate?.position ?? position,
    rawPosition: raw,
    directionPosition:
      candidate?.guide || candidate?.kind === 'AXIS_DIRECTION' || candidate?.kind === 'TRACKING' ? candidate.position : position,
    snap: candidate,
    ...(['hatch','trim'].includes(session.commandId) ? { hiddenLayers: controls.hiddenLayers } : {}),
    entityId: needsBody ? hit?.id : (nodeId ?? (hit?.viewId === frame ? hit.id : undefined)),
  };
  return { candidate, pick };
}
