import { createId, type GeometryDocument, type GeometryEntity, type Vec2 } from '@tuheng/contracts';
import { cadDefinition, type CadSession } from './cad-registry';
import { cadLength, cadNumber, cadPolygonSides, cadText, parseCadCoordinate } from './cad-input';
import { cadPrimitiveEntities } from './cad-primitives';
import { hatchFaceAt } from './cad-faces';
import { hatchStrokes } from './hatch';
import { engineeringPlacement } from './engineering-parameters';
import { boundaryShape, nearestOnShape } from './parametric-geometry';
import { clearEditable, deleteEntities, deletionSet, editable, transact } from './document';
import { add, angle, arcPoint, cross, distance, sub } from './math';
import { localToSheet, sheetToLocal, viewTransform } from './sheet';
import { transformSelection } from './cad-transforms';
import { trimAt, trimInBox, extendAt, cornerAt } from './cad-cut';
import { confirmSnap, type SnapCandidate } from './snapping';
import type { DraftingSnapOptions } from './composite-snapping';

export type CadEvent =
  | {
      type: 'point';
      position: Vec2;
      rawPosition?: Vec2;
      entityId?: string;
      viewId?: string;
      hiddenLayers?: readonly string[];
      snap?: SnapCandidate;
    }
  | { type: 'input'; value: string }
  | { type: 'stamp'; position: Vec2 }
  | { type: 'parameters'; values: Record<string, string> }
  | { type: 'confirm' | 'back' }
  | { type: 'cancel'; exit?: boolean };
export interface CadStepResult {
  session: CadSession | null;
  document?: GeometryDocument;
  unsnapped?: GeometryDocument;
  message: string;
}
const isChain = (id: string) => id === 'segment';
const needsSetup = (id: string) => id === 'text' || id === 'polygon';

export function cadDraftingOptions(session: CadSession, lockOrtho: boolean): DraftingSnapOptions {
  if (session.phase !== 'points') return {};
  const { commandId, points } = session;
  const origin = commandId === 'arc' || commandId === 'ellipse' ? points[0] : points.at(-1);
  const straight = commandId === 'segment' || commandId === 'line';
  const needsSpan = straight ||
    ['circle', 'arc', 'arc3', 'ellipse', 'polygon', 'spline', 'direction', 'compass'].includes(commandId) ||
    (points.length === 1 && ['linearDimension', 'alignedDimension'].includes(commandId));
  return {
    origins: origin ? [origin] : [],
    ortho: !!origin && (
      (commandId === 'ellipse' && points.length === 1) ||
      (lockOrtho && !['rectangle', 'trim', 'extend', 'fillet', 'chamfer'].includes(commandId))
    ),
    acceptsPoint: origin && commandId === 'rectangle'
      ? (p) => Math.abs(p.x - origin.x) >= 1e-8 && Math.abs(p.y - origin.y) >= 1e-8
      : origin && needsSpan ? (p) => distance(p, origin) >= 1e-8 : undefined,
    equalLength: commandId === 'segment',
    commonTangent: straight && !origin,
    pairedTangent: straight && origin ? session.pointSnaps?.[0]?.pairedTangent : undefined,
  };
}
function supportedSelection(
  e: GeometryEntity,
  mode: ReturnType<typeof cadDefinition>['selection'],
) {
  switch (mode) {
    case 'objects':
      return e.kind !== 'plane';
    case 'region':
      return e.kind === 'circle' || e.kind === 'ellipse' || e.kind === 'segment';
    case 'radial':
      return e.kind === 'circle' || e.kind === 'arc';
    case 'corner':
      return e.kind === 'segment';
    case 'boundaries':
      return ['segment', 'line', 'circle', 'arc', 'ellipse', 'curve'].includes(e.kind);
    default:
      return false;
  }
}
export function startCadSession(
  command: string,
  doc: GeometryDocument,
  viewId: string,
  role: CadSession['role'],
  selectedIds: string[] = [],
): CadSession {
  if (!doc.views.some((v) => v.id === viewId)) throw Error('投影视图不存在');
  const def = cadDefinition(command);
  const selection = doc.entities.filter(
    (e) => selectedIds.includes(e.id) && supportedSelection(e, def.selection),
  );
  const ids = selection.map((e) => e.id);
  if (def.selection === 'objects' && ids.length !== new Set(selectedIds).size)
    throw Error('选集包含不可变换的投影轴或参考对象，请调整选择');
  if (def.selection === 'radial' && ids.length > 1) ids.splice(0);
  if (def.selection === 'objects' && selection.some((e) => !editable(doc, e, role)))
    throw Error('选集包含只读对象');
  const phase =
    def.selection === 'region' ||
    (['objects', 'boundaries', 'radial'].includes(def.selection) && !ids.length)
      ? 'selection'
      : 'points';
  const id = createId();
  return {
    id,
    commandId: def.id,
    baseDocument: doc,
    viewId: selection[0]?.viewId ?? viewId,
    role,
    prefix: id,
    points: [],
    pointIds: [],
    ids,
    parameters: Object.fromEntries(def.fields.map((f) => [f.key, f.defaultValue])),
    phase: needsSetup(def.id) ? 'setup' : def.id === 'erase' && ids.length ? 'confirm' : phase,
  };
}

export function cadPrompt(s: CadSession) {
  const def = cadDefinition(s.commandId);
  if (s.phase === 'setup')
    return s.commandId === 'text' ? '输入文字后在图纸上定位' : '输入边数后在图纸上构造';
  if (s.phase === 'confirm') return '检查预览，确认或退一步';
  if (s.phase === 'selection') {
    if (def.selection === 'radial') return '选择被标注的圆或圆弧';
    return (
      (def.selection === 'region'
        ? '选择闭合外边界与孔的边界'
        : def.selection === 'boundaries'
          ? '选择修剪或延伸的边界'
          : '选择待编辑对象') +
      '，再点确认（已选 ' +
      s.ids.length +
      ' 个）'
    );
  }
  const i =
    s.commandId === 'compass' && s.parameters.opening ? 2 + s.points.length : s.points.length;
  if (s.commandId === 'angularDimension' && !s.points.length) {
    if (s.ids.length === 2) return '点击要标的角区，可标相邻补角';
    if (s.ids.length) return '点击第二条直线';
  }
  if (engineeringPlacement(s.commandId) && s.points.length && s.pointIds[0]) return '定位引线和标注文字';
  if (s.commandId === 'trim' && s.points.length === 1 && !s.pointIds[0]) return '选择框切的另一角';
  return def.steps[Math.min(i, def.steps.length - 1)];
}

function effectiveSession(s: CadSession): CadSession {
  const p = s.parameters,
    [a, b] = s.points;
  if (!a) return s;
  let points = s.points;
  if (isChain(s.commandId) && p.length?.trim())
    points = [a, arcPoint(a, cadLength(p.length, '长度'), cadNumber(p.angle, '角度', '°'))];
  if (s.commandId === 'rectangle' && (p.width?.trim() || p.height?.trim())) {
    const w = cadNumber(p.width, '矩形宽度', 'mm'),
      h = cadNumber(p.height, '矩形高度', 'mm');
    if (!w || !h) throw Error('宽、高必须非零');
    points = [a, add(a, { x: w, y: h })];
  }
  if (s.commandId === 'circle' && p.radius?.trim())
    points = [a, arcPoint(a, cadLength(p.radius, '半径'), 0)];
  if (s.commandId === 'polygon' && p.radius?.trim())
    points = [a, arcPoint(a, cadLength(p.radius, '半径'), cadNumber(p.angle, '方向', '°'))];
  if (s.commandId === 'ellipse' && p.majorRadius?.trim() && p.minorRadius?.trim()) {
    const theta = cadNumber(p.angle, '方向', '°');
    points = [
      a,
      arcPoint(a, cadLength(p.majorRadius, '长半轴'), theta),
      arcPoint(a, cadLength(p.minorRadius, '短半轴'), theta + 90),
    ];
  }
  if (s.commandId === 'rotate' && p.angle?.trim() && !b) cadNumber(p.angle, '角度', '°');
  return points === s.points ? s : { ...s, points };
}
function requiredPoints(s: CadSession) {
  if (engineeringPlacement(s.commandId)) return s.pointIds[0] && s.parameters.leader!=='直接放置' ? 2 : 1;
  switch (s.commandId) {
    case 'erase':
    case 'clear':
    case 'hatch':
      return 0;
    case 'spline':
      return 2;
    case 'angularDimension':
      return s.ids.length === 2 ? 1 : 4;
    case 'direction':
      return s.parameters.angle?.trim() ? 1 : 2;
    case 'compass':
      return s.parameters.opening?.trim() ? 3 : 5;
    case 'rotate':
      return s.parameters.angle?.trim() ? 1 : 2;
    case 'trim':
      return s.points.length > 0 && !s.pointIds[0] ? 2 : 1;
    default:
      return cadDefinition(s.commandId).steps.length;
  }
}

function build(s: CadSession, doc: GeometryDocument, preview: boolean, pickedNodes?: Map<number, string>) {
  const cmd = s.commandId,
    p = s.parameters,
    ids = s.ids,
    [a, b] = s.points;
  const sheet = (q: Vec2) => localToSheet(doc, s.viewId, q);
  switch (cmd) {
    case 'erase': {
      if (!ids.length) throw Error('请选择要删除的对象');
      if (!preview) return deleteEntities(doc, ids, s.role);
      const removed = deletionSet(doc, ids, s.role);
      return { ...doc, entities: doc.entities.filter((e) => !removed.has(e.id)) };
    }
    case 'move':
    case 'copy':
      return transformSelection(
        doc,
        ids,
        { kind: cmd, from: sheet(a), to: sheet(b) },
        s.role,
        preview,
      );
    case 'mirror':
      return transformSelection(
        doc,
        ids,
        { kind: 'mirror', a: sheet(a), b: sheet(b), keepSource: p.source === '保留' },
        s.role,
        preview,
      );
    case 'rotate': {
      const center = sheet(a);
      const frame = viewTransform(doc, s.viewId);
      const degrees = (p.angle.trim() ? cadNumber(p.angle,'角度','°') : angle(sub(b,a))) *
        Math.sign(cross(frame.xAxis,frame.yAxis));
      if (!p.angle.trim() && distance(a,b)<1e-8) throw Error('请选择不同于旋转中心的方向点');
      return transformSelection(doc, ids, { kind: 'rotate', center, degrees }, s.role, preview);
    }
    case 'trim':
    case 'extend': {
      const target = s.pointIds[0];
      if (!target && cmd === 'trim') return trimInBox(doc,ids,s.viewId,a,b,s.role,s.hiddenLayers,preview);
      if (!target) throw Error('请点击目标图形');
      return (cmd === 'trim' ? trimAt : extendAt)(doc, ids, target, a, s.role, preview);
    }
    case 'fillet':
    case 'chamfer': {
      const [first, second] = s.pointIds;
      if (!first || !second || first === second) throw Error('选择两条不同线段及各自保留的一侧');
      const spec =
        cmd === 'fillet'
          ? { kind: 'fillet' as const, radius: p.radius.trim() ? cadNumber(p.radius,'圆角半径','mm') : undefined }
          : {
              kind: 'chamfer' as const,
              distanceA: p.distanceA.trim() ? cadNumber(p.distanceA,'第一边距离','mm') : undefined,
              distanceB: p.distanceB.trim() ? cadNumber(p.distanceB,'第二边距离','mm') : undefined,
            };
      return cornerAt(doc, first, second, a, b, spec, s.role, p.trim === '修剪', preview);
    }
    case 'clear':
      return preview ? doc : clearEditable(doc, s.role);
    default: {
      const entities = cadPrimitiveEntities(doc, s, pickedNodes);
      if (!entities.length) return doc;
      if (entities[0].kind === 'hatch' && !preview) hatchStrokes(doc,entities[0]);
      return preview
        ? {
            ...doc,
            schemaVersion: 'tuheng.geometry/3.0.0' as const,
            entities: [...doc.entities, ...entities],
          }
        : transact(
            doc,
            (d) => {
              d.schemaVersion = 'tuheng.geometry/3.0.0';
              d.entities.push(...entities);
            },
            s.role,
          );
    }
  }
}
function pick(
  s: CadSession,
  doc: GeometryDocument,
  position: Vec2,
  entityId?: string,
  viewId = s.viewId,
  hiddenLayers: readonly string[] = [],
): CadSession {
  const def = cadDefinition(s.commandId);
  const first = !s.points.length && !s.ids.length;
  const frame = first ? viewId : s.viewId;
  const local =
    frame === viewId ? position : sheetToLocal(doc, frame, localToSheet(doc, viewId, position));
  const entity = entityId ? doc.entities.find((e) => e.id === entityId) : undefined;
  if (s.commandId === 'angularDimension' && !s.points.length && s.ids.length < 2 &&
    (s.parameters.angularMethod!=='三点' || s.ids.length>0)) {
    if ((entity?.kind==='segment' || entity?.kind==='line') && entity.viewId===frame) {
      if (s.ids.includes(entity.id)) throw Error('请选择另一条直线');
      if (s.role==='teacher' && editable(doc,entity,'student')) throw Error('题干标注不能引用答案层');
      return {...s, viewId:frame, ids:[...s.ids,entity.id]};
    }
    if (s.ids.length || s.parameters.angularMethod==='两条线') throw Error('请点击同框架的直线');
  }
  if (s.phase === 'selection') {
    if (def.selection === 'region' && !entity) {
      const hatchSpans = hatchFaceAt(doc,frame,local,hiddenLayers);
      return {...s, viewId:frame, ids:[...new Set(hatchSpans.flat().map(span=>span.entityId))], hatchSpans, phase:'confirm'};
    }
    if (!entity || !supportedSelection(entity, def.selection))
      throw Error('请点选当前命令支持的对象');
    if (def.selection === 'objects' && !editable(doc, entity, s.role)) throw Error('对象只读');
    if (def.selection !== 'objects' && s.ids.length && entity.viewId !== s.viewId)
      throw Error('参考对象须属同一投影框架');
    return {
      ...s,
      viewId: first ? entity.viewId : s.viewId,
      ids: s.ids.includes(entity.id)
        ? s.ids.filter((id) => id !== entity.id)
        : [...s.ids, entity.id],
      phase: def.selection === 'radial' ? 'points' : 'selection',
    };
  }
  if (engineeringPlacement(s.commandId) && !s.points.length && entity && s.parameters.leader!=='直接放置') {
    const shape=entity.viewId===frame ? boundaryShape(doc,entity) : undefined;
    if (shape || entity.kind==='dimension' && entity.viewId===frame)
      return {...s,viewId:frame, points:[shape ? nearestOnShape(shape,local).position : local],pointIds:[entity.id]};
  }
  if (
    (def.selection === 'corner' || def.selection === 'boundaries') &&
    !(s.commandId === 'trim' && (!entity || (s.points.length && !s.pointIds[0]))) &&
    (!entity ||
      entity.viewId !== frame ||
      !supportedSelection(entity, def.selection) ||
      !editable(doc, entity, s.role))
  )
    throw Error('请选择同框架的可编辑目标线或曲线');
  if (def.selection === 'corner' && s.ids.length && !s.ids.includes(entity!.id))
    throw Error('请点击预选线段的一侧');
  if (s.commandId === 'connect' && (entity?.kind !== 'point' || entity.viewId !== frame))
    throw Error('请选择同一投影面中的已有节点');
  return {
    ...s,
    viewId: frame,
    ...(s.commandId === 'trim' ? {hiddenLayers} : {}),
    points: [...s.points, s.commandId === 'connect' && entity?.kind === 'point' ? entity.position : local],
    pointIds: [...s.pointIds, entity?.viewId === frame && !engineeringPlacement(s.commandId) ? entity.id : undefined],
  };
}

export function cadPreview(
  session: CadSession,
  doc: GeometryDocument,
  position?: Vec2,
  entityId?: string,
  viewId = session.viewId,
  hiddenLayers: readonly string[] = [],
): GeometryDocument | null {
  if (
    session.baseDocument !== doc ||
    session.phase === 'setup' ||
    (session.phase === 'selection' && session.commandId !== 'hatch')
  )
    return null;
  try {
    const next =
      position && session.phase === 'points'
        ? pick(session, doc, position, entityId, viewId, hiddenLayers)
        : session;
    const s = effectiveSession(next);
    if (s.commandId === 'compass' && s.parameters.opening && s.points.length === 2) return build(s,doc,true);
    if (s.points.length < requiredPoints(s) || (s.commandId === 'compass' && !s.parameters.opening))
      return null;
    return build(s, doc, true);
  } catch {
    return null;
  }
}

export function cadStep(
  session: CadSession,
  doc: GeometryDocument,
  event: CadEvent,
): CadStepResult {
  const progress = (s: CadSession): CadStepResult => ({ session: s, message: cadPrompt(s) });
  if (event.type === 'cancel') {
    if (
      !event.exit &&
      session.baseDocument === doc &&
      isChain(session.commandId) &&
      session.points.length
    )
      return {
        session: {
          ...startCadSession('segment', doc, session.viewId, session.role),
          appearance: session.appearance,
        },
        message: '已结束当前线段，请指定新起点（再按 Esc 返回选择）',
      };
    return { session: null, message: '操作已取消' };
  }
  if (session.baseDocument !== doc) return { session: null, message: '图纸已更新，请重新开始命令' };
  let current = session;
  try {
    const def = cadDefinition(session.commandId);
    if (event.type === 'parameters') {
      const allowed = new Set(def.fields.map((f) => f.key));
      for (const [key, value] of Object.entries(event.values)) {
        const f = def.fields.find((f) => f.key === key);
        if (!allowed.has(key) || (f?.options && !f.options.includes(value)))
          throw Error('参数或选项无效');
      }
      const parameters = { ...session.parameters, ...event.values };
      if (
        session.commandId === 'compass' &&
        'opening' in event.values &&
        !session.parameters.opening &&
        event.values.opening?.trim()
      ) {
        cadLength(event.values.opening, '开度');
        return progress({ ...session, parameters, points: [], pointIds: [] });
      }
      return progress({ ...session, parameters });
    }
    if (session.phase === 'setup') {
      if (event.type !== 'confirm') return progress(session);
      if (session.commandId === 'text') {
        cadText(session.parameters.content);
        cadLength(session.parameters.size, '字高');
      } else cadPolygonSides(session.parameters.sides);
      return progress({ ...session, phase: 'points' });
    }
    if (event.type === 'back') {
      if (session.points.length)
        return progress({
          ...session,
          points: session.points.slice(0, -1),
          pointIds: session.pointIds.slice(0, -1),
          rawPoints: session.rawPoints?.slice(0, -1),
          pointSnaps: session.pointSnaps?.slice(0,-1),
          phase: 'points',
        });
      if (session.ids.length)
        return progress({ ...session, ids: session.hatchSpans ? [] : session.ids.slice(0, -1), hatchSpans:undefined, phase: session.commandId==='angularDimension' ? 'points' : 'selection' });
      if (needsSetup(session.commandId)) return progress({ ...session, phase: 'setup' });
      return progress(session);
    }
    if (event.type === 'stamp') {
      if (session.commandId !== 'compass' || !session.parameters.opening || session.points.length !== 1)
        throw Error('请先确定圆规开度与落针中心');
      current = pick(session,doc,event.position);
    }
    if (event.type === 'confirm' && session.phase === 'selection') {
      if (!session.ids.length) throw Error('请先选择对象');
      if (def.selection !== 'region' && session.commandId !== 'erase') return progress({ ...session, phase: 'points' });
    } else if (event.type === 'point' || event.type === 'input') {
      if (session.phase === 'confirm') throw Error('请确认当前预览或退一步');
      let position: Vec2;
      if (event.type === 'input') {
        if (
          event.value.includes(',') ||
          event.value.includes('，') ||
          event.value.trim().startsWith('@') ||
          event.value.trim().startsWith('＠')
        )
          position = parseCadCoordinate(event.value, session.points.at(-1));
        else {
          if (!session.points.length) throw Error('请先确定一个起点，或输入 u,v 坐标');
          const anchor = session.points.at(-1)!;
          position = arcPoint(
            anchor,
            cadLength(event.value, '距离'),
            cadNumber(session.parameters.angle || '0', '角度', '°'),
          );
        }
        current = pick(session, doc, position);
      } else
        current = pick(
          session,
          doc,
          event.position,
          event.entityId,
          event.viewId,
          event.hiddenLayers,
        );
      if (session.phase === 'selection') return progress(current);
      if (current.points.length > session.points.length)
        current = {
          ...current,
          pointSnaps: [
            ...(session.pointSnaps ?? session.points.map(() => undefined)),
            event.type === 'point' ? event.snap : undefined,
          ],
        };
      if (
        event.type === 'point' &&
        event.rawPosition &&
        distance(event.position, event.rawPosition) > 1e-8
      ) {
        const frame = event.viewId ?? current.viewId;
        const raw =
          frame === current.viewId
            ? event.rawPosition
            : sheetToLocal(doc, current.viewId, localToSheet(doc, frame, event.rawPosition));
        current = { ...current, rawPoints: [...(session.rawPoints ?? session.points), raw] };
      } else if (session.rawPoints)
        current = { ...current, rawPoints: [...session.rawPoints, current.points.at(-1)!] };
      if (
        current.commandId === 'compass' &&
        !current.parameters.opening &&
        current.points.length === 2
      ) {
        const opening = distance(current.points[0], current.points[1]);
        if (opening < 1e-8) throw Error('开度须大于零');
        return progress({
          ...current,
          points: [],
          pointIds: [],
          rawPoints: undefined,
          pointSnaps: undefined,
          parameters: { ...current.parameters, opening: String(opening) },
        });
      }
      const ready = effectiveSession(current);
      if (ready.points.length < requiredPoints(ready) || current.commandId === 'spline')
        return progress(current);
      if (def.group === '修改' || current.commandId === 'compass') {
        build(ready, doc, true);
        return progress({ ...current, phase: 'confirm' });
      }
    }
    const effective = effectiveSession(current);
    if (event.type === 'confirm' && effective.commandId === 'point' && !effective.points.length)
      return { session: null, message: '点作图已完成' };
    if (event.type === 'confirm' && isChain(effective.commandId) && effective.points.length < 2)
      return { session: null, message: '连续线已完成' };
    if (event.type === 'confirm' && (effective.commandId === 'trim' || effective.commandId === 'extend') && !effective.points.length)
      return { session: null, message: cadDefinition(effective.commandId).name + '已完成' };
    const stamping = effective.commandId === 'compass' && effective.parameters.opening && effective.points.length === 2;
    if (!stamping && effective.points.length < requiredPoints(effective)) throw Error(cadPrompt(current));
    const pickedNodes = new Map<number, string>();
    let document = build(effective, doc, false, pickedNodes);
    for (const [i, id] of pickedNodes) {
      const snap = effective.pointSnaps?.[i];
      if (!snap || distance(effective.points[i], snap.position) >= 1e-7) continue;
      if (effective.commandId === 'spline' || (snap.composite && (snap.reference || snap.kind === 'PROJECTION_ALIGNMENT')))
        document = confirmSnap(doc, document, snap, id, effective.role);
    }
    let unsnapped: GeometryDocument | undefined;
    if (current.rawPoints && def.group !== '修改') {
      // A legal snap can rescue a degenerate raw stroke. Only offer recoverable alternatives.
      try {
        const raw = effectiveSession({
          ...current,
          points: current.rawPoints,
          rawPoints: undefined,
          pointIds: current.pointIds.map((id, i) =>
            distance(current.points[i], current.rawPoints![i]) > 1e-8 ? undefined : id,
          ),
        });
        unsnapped = build(raw, doc, false);
      } catch {
        unsnapped = undefined;
      }
    }
    let next: CadSession | null = null;
    if (isChain(effective.commandId)) {
      const last = document.entities.at(-1);
      if (last?.kind === 'segment')
        next = {
          ...current,
          baseDocument: document,
          prefix: createId(),
          phase: 'points',
          points: [effective.points[1]],
          pointIds: [last.endPoint],
          rawPoints: undefined,
          pointSnaps: undefined,
          parameters: { ...current.parameters, length: '' },
        };
    }
    if (['compass','point','trim','extend'].includes(effective.commandId))
      next = {
        ...current,
        baseDocument: document,
        prefix: createId(),
        phase: 'points',
        points: [],
        pointIds: [],
        rawPoints: undefined,
        pointSnaps: undefined,
      };
    return {
      document,
      unsnapped,
      session: next,
      message: next ? cadPrompt(next) : def.name + '已完成',
    };
  } catch (error) {
    // Retain the preceding valid step so a bad final pick can be replaced immediately.
    return { session, message: error instanceof Error ? error.message : '无法完成当前命令' };
  }
}
export function setCadAppearance(
  doc: GeometryDocument,
  ids: string[],
  appearance: NonNullable<GeometryEntity['appearance']>,
  role: CadSession['role'],
) {
  const selected = new Set(ids);
  if (
    !ids.length ||
    ids.some((id) => !doc.entities.some((e) => e.id === id && editable(doc, e, role)))
  )
    throw Error('选集含不可编辑对象');
  return transact(
    doc,
    (d) => {
      d.schemaVersion = 'tuheng.geometry/3.0.0';
      for (const e of d.entities) {
        if (!selected.has(e.id)) continue;
        e.appearance = { ...e.appearance, ...appearance };
        if (appearance.pattern && appearance.pattern !== 'GUIDE' && e.lineStyle !== 'CONSTRUCTION') {
          const hidden = appearance.pattern === 'DASHED';
          e.lineStyle = e.lineStyle.startsWith('PROBLEM')
            ? hidden ? 'PROBLEM_HIDDEN' : 'PROBLEM_VISIBLE'
            : hidden ? 'ANSWER_HIDDEN' : 'ANSWER_VISIBLE';
        }
      }
    },
    role,
  );
}
