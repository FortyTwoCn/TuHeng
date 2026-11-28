import type { Vec2 } from '@tuheng/contracts';
import {
  sheetToLocal,
  snapCandidates,
  combinedLineCandidate,
  commonTangentCandidates,
  nearestDraftingCandidate,
  segmentSatisfiesGuide,
  trackingCandidate,
  type TrackingBase,
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

const pointFeatures: SnapCandidate['kind'][] = [
  'COINCIDENT',
  'ENDPOINT',
  'ORIGIN',
  'INTERSECTION',
  'CENTER',
  'MIDPOINT',
  'QUADRANT',
];
const isWeakSnap = (candidate?: SnapCandidate) =>
  !candidate || ['AXIS', 'AXIS_DIRECTION', 'GRID'].includes(candidate.kind);

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
) {
  const doc = controls.document;
  const frame = session.points.length || session.ids.length ? session.viewId : frameId;
  const raw = sheetToLocal(doc, frame, sheet);
  const last = session.points.at(-1);
  const straightCommand = session.commandId === 'segment' || session.commandId === 'line';
  const lineRelations = !!last && straightCommand;
  let position = raw;
  const ortho =
    last &&
    session.phase === 'points' &&
    ((session.commandId === 'ellipse' && session.points.length === 1) ||
      (controls.ortho &&
        [
          'segment',
          'line',
          'move',
          'copy',
          'circle',
          'arc',
          'arc3',
          'spline',
          'polygon',
          'linearDimension',
          'alignedDimension',
          'direction',
        ].includes(session.commandId)));
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
    const ordinary = snapCandidates(doc, frame, position, scale, last, options).filter((c) =>
      onAxis(c.position),
    );
    candidate = ordinary[0];
    const radius = threshold / scale;
    if (straightCommand && !last && (isWeakSnap(candidate) || candidate?.kind === 'FOOT')) {
      const tangent = commonTangentCandidates(doc, frame, position, radius, options)[0];
      if (tangent) candidate = tangent;
    }
    let combined: SnapCandidate | undefined;
    const paired = lineRelations ? session.pointSnaps?.[0]?.pairedTangent : undefined;
    if (
      paired &&
      last &&
      controls.objectSnap &&
      controls.objectTypes.includes('tangent') &&
      distance(raw, paired.contact) <= radius &&
      onAxis(paired.contact) &&
      doc.entities.some(
        ({ id, layerId }) => id === paired.sourceId && !controls.hiddenLayers.includes(layerId),
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
    } else if (session.commandId === 'segment' && last && options.direction && options.objects) {
      combined = combinedLineCandidate(
        doc,
        frame,
        last,
        position,
        ordinary,
        controls.tracking ? tracked : [],
        radius,
        options,
        onAxis,
      );
    }
    if (session.phase === 'points') {
      const bases =
        last && straightCommand && (controls.direction || ortho)
          ? [...tracked, { position: last }]
          : tracked;
      const tracking = controls.tracking
        ? trackingCandidate(doc, frame, position, bases, radius, options, onAxis)
        : undefined;
      const guided = tracking?.intersection ? tracking : combined;
      if (guided) {
        const featureRadius = Math.min(4 / scale, radius * 0.4);
        const precise = ordinary.find(
          (snap) => snap.distance <= featureRadius && pointFeatures.includes(snap.kind),
        );
        if (precise && distance(precise.position, guided.position) >= 1e-7) {
          candidate = precise;
        } else {
          const aligned = [combined, candidate].find(
            (snap) =>
              snap &&
              distance(snap.position, guided.position) < 1e-7 &&
              (snap.guide || snap.equalLength),
          );
          candidate = {
            ...(precise ?? guided),
            guide: aligned?.guide ?? precise?.guide ?? guided.guide,
            tracks: guided.tracks,
            equalLength: aligned?.equalLength ?? guided.equalLength,
          };
        }
      } else if (isWeakSnap(candidate)) {
        candidate =
          tracking ??
          nearestDraftingCandidate(doc, frame, position, radius, options, onAxis) ??
          candidate;
      } else if (tracking && candidate && distance(tracking.position, candidate.position) < 1e-7) {
        candidate = { ...candidate, tracks: tracking.tracks };
      }
    }
  }
  const angularBody =
    session.commandId === 'angularDimension' &&
    !session.points.length &&
    session.ids.length < 2 &&
    (session.parameters.angularMethod !== '三点' || session.ids.length > 0);
  const needsBody =
    angularBody ||
    [
      'trim',
      'extend',
      'fillet',
      'chamfer',
      'radiusDimension',
      'diameterDimension',
      'hatch',
    ].includes(session.commandId);
  const hit = needsBody
    ? hits.find(
        (h) =>
          h.kind === 'body' &&
          (!angularBody ||
            doc.entities.some((e) => e.id === h.id && (e.kind === 'segment' || e.kind === 'line'))),
      )
    : hits[0];
  const nodeId = candidate?.kind === 'COINCIDENT' ? candidate.entityIds[0] : undefined;
  const pick: CadPick = {
    type: 'point',
    viewId: frame,
    position: candidate?.position ?? position,
    rawPosition: raw,
    directionPosition:
      candidate?.guide || candidate?.kind === 'AXIS_DIRECTION' || candidate?.kind === 'TRACKING'
        ? candidate.position
        : position,
    snap: candidate,
    ...(['hatch', 'trim'].includes(session.commandId)
      ? { hiddenLayers: controls.hiddenLayers }
      : {}),
    entityId: needsBody ? hit?.id : (nodeId ?? (hit?.viewId === frame ? hit.id : undefined)),
  };
  return { candidate, pick };
}
