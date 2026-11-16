import type { GeometryDocument, Vec2 } from '@tuheng/contracts';
import {
  addCurve,
  distance,
  intersectionCandidates,
  snapCandidates,
  confirmSnap,
  transact,
  type SnapCandidate,
} from '@tuheng/geometry-core';
export interface CurveMark {
  raw: Vec2;
  position: Vec2;
  pointId?: string;
  candidate?: SnapCandidate;
}
export interface CurveDraft {
  viewId: string;
  marks: CurveMark[];
  finishAt?: 0 | 1;
}
export function curveCandidate(
  doc: GeometryDocument,
  viewId: string,
  p: Vec2,
  scale: number,
  options: Parameters<typeof snapCandidates>[5],
) {
  return (
    intersectionCandidates(doc, viewId, p, scale, options)[0] ??
    snapCandidates(doc, viewId, p, scale, undefined, options)[0]
  );
}
export function curveClick(
  doc: GeometryDocument,
  draft: CurveDraft | null,
  viewId: string,
  p: Vec2,
  targetId: string | undefined,
  scale: number,
  snapping: boolean,
  options: Parameters<typeof snapCandidates>[5],
): CurveDraft {
  const current = draft ?? { viewId, marks: [] };
  if (current.marks.length >= 2) {
    const end = current.marks
      .slice(0, 2)
      .findIndex((m) => distance(m.position, p) * scale <= (options?.threshold ?? 10));
    if (end >= 0) {
      if (current.marks.length < 3) throw Error('请先标记至少一个曲线经过点');
      return { ...current, finishAt: end === 0 ? 0 : 1 };
    }
  }
  if (current.marks.length >= 128) throw Error('一条曲线最多 128 个经过点，请分段绘制');
  const target = doc.entities.find((e) => e.id === targetId);
  if (current.marks.length < 2 && target?.kind === 'point' && target.viewId !== current.viewId)
    throw Error('两个端点必须属于同一投影面');
  const endpoint = current.marks.length < 2 && target?.kind === 'point' ? target : undefined;
  const candidate =
    !endpoint && snapping ? curveCandidate(doc, current.viewId, p, scale, options) : undefined;
  const mark: CurveMark = {
    raw: endpoint?.position ?? p,
    position: endpoint?.position ?? candidate?.position ?? p,
    pointId: endpoint?.id,
    candidate,
  };
  if (current.marks.some((m) => distance(m.position, mark.position) < 1e-7))
    throw Error('这个点已经标记，请选择另一个经过点');
  return { ...current, marks: [...current.marks, mark], finishAt: undefined };
}
export function orderedCurveMarks(draft: CurveDraft) {
  const marks =
    draft.marks.length < 2
      ? draft.marks
      : [draft.marks[0], ...draft.marks.slice(2), draft.marks[1]];
  return draft.finishAt === 0 ? [...marks].reverse() : marks;
}
export function commitCurve(doc: GeometryDocument, draft: CurveDraft, role: 'teacher' | 'student') {
  if (draft.finishAt === undefined || draft.marks.length < 3)
    throw Error('先点击任意端点，再确认曲线');
  const marks = orderedCurveMarks(draft);
  const raw = addCurve(
    doc,
    draft.viewId,
    marks.map((m) => m.raw),
    role,
    marks.map((m) => m.pointId ?? ''),
  );
  const curve = raw.entities.at(-1)!;
  if (curve.kind !== 'curve') throw Error('曲线创建失败');
  let next = transact(
    raw,
    (d) => {
      for (const [i, id] of curve.pointIds.entries()) {
        const p = d.entities.find((e) => e.id === id);
        if (p?.kind === 'point' && !doc.entities.some((e) => e.id === id))
          p.position = marks[i].position;
      }
    },
    role,
  );
  for (const [i, id] of curve.pointIds.entries())
    if (marks[i].candidate && !marks[i].pointId)
      next = confirmSnap(doc, next, marks[i].candidate!, id, role);
  return { raw, next };
}
