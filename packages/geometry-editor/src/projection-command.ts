import type { GeometryDocument, Vec2 } from '@tuheng/contracts';
import {
  resolveReference,
  constructLine,
  adjustDirection,
  sheetToLocal,
  localToSheet,
  referenceDirection,
  axisDirection,
  targetFromKey,
  sub,
  add,
  scale,
  distance,
  type AxisConstruction,
} from '@tuheng/geometry-core';
import type { EditorControls } from './types';
import type { Hit } from './interaction-controller';
import type { ConstructionSession } from './session';

/** 悬停和按住移动使用同一个构造预览，真正创建由确认步骤处理。 */
export function constructionGuide(
  doc: GeometryDocument,
  draft: ConstructionSession,
  viewId: string,
  sheetPosition: Vec2,
) {
  if (draft.phase !== 'position' || !draft.reference) return;
  const from = sheetToLocal(doc, viewId, sheetPosition);
  const direction = referenceDirection(doc, viewId, draft.reference, draft.spec.directionMode);
  const length = draft.spec.geometryExtent === 'segment' ? draft.spec.length : 100;
  return [sheetPosition, localToSheet(doc, viewId, add(from, scale(direction, length)))];
}

export function constructionClick(
  props: EditorControls,
  p: Vec2,
  target: Hit | undefined,
  frameId: string,
  setConstructionPreview: (preview: { revision: object; next: GeometryDocument }) => void,
) {
  const { document: doc, role } = props;
  const c = props.session.construction;
  if (!c) return false;
  if (c.phase === 'reference') {
    const reference = target ? targetFromKey(target.id) : undefined;
    if (!reference || !resolveReference(doc, reference).direction) throw Error('请选择参考线或轴');
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
    return true;
  }
  return true;
}
export type AxisDraft = {
  spec: AxisConstruction;
  phase: 'reference' | 'anchor' | 'direction' | 'side' | 'confirm';
};
export function axisClick(
  props: EditorControls,
  axisDraft: AxisDraft,
  setAxisDraft: (a: AxisDraft) => void,
  p: Vec2,
  target?: Hit,
) {
  const doc = props.document;
  if (!axisDraft) return;
  const { spec, phase } = axisDraft;
  if (phase === 'reference') {
    if (!target) throw Error('请选择参考线或投影轴');
    const ref = targetFromKey(target.id);
    if (ref.kind === 'baseAxis' || ref.kind === 'projectionAxis') {
      let referenceAxis: AxisConstruction['referenceAxis'];
      if (ref.kind === 'projectionAxis') referenceAxis = ref;
      else {
        const { axisId } = ref;
        if (axisId === 'x' || axisId === 'y' || axisId === 'z')
          throw Error('请在展开图上选择基准投影轴');
        referenceAxis = { kind: 'baseAxis', axisId };
      }
      setAxisDraft({ spec: { ...spec, referenceAxis, referenceEntityId: null }, phase: 'anchor' });
    } else {
      const e = doc.entities.find((e) => e.id === target.id);
      if (!e || !['line', 'segment'].includes(e.kind) || e.viewId !== spec.retainedViewId)
        throw new Error('请点击保留面中的参考线或投影轴');
      setAxisDraft({
        spec: { ...spec, referenceAxis: undefined, referenceEntityId: e.id },
        phase: 'anchor',
      });
    }
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
