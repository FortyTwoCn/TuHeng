import type { GeometryDocument } from '@tuheng/contracts';
import {
  disconnectEndpoint,
  pointReferences,
  editable,
  transact,
  referenceRelationName,
} from '@tuheng/geometry-core';
export function ConnectionTools({
  doc,
  selected,
  role,
  commit,
  report,
}: {
  doc: GeometryDocument;
  selected: string[];
  role: 'teacher' | 'student';
  commit: (d: GeometryDocument) => void;
  report: (s: string) => void;
}) {
  const e = doc.entities.find((e) => e.id === selected[0]);
  if (!e) return null;
  const ids = e.kind === 'point' ? [e.id] : pointReferences(e);
  const connections = doc.entities.filter(
    (e) => editable(doc, e, role) && pointReferences(e).some((id) => ids.includes(id)),
  );
  const attempt = (op: () => GeometryDocument) => {
    try {
      commit(op());
    } catch (e) {
      report((e as Error).message);
    }
  };
  return (
    <details>
      <summary>节点连接与绑定</summary>
      {connections.flatMap((line) =>
        pointReferences(line)
          .filter((id) => ids.includes(id))
          .map((id) => (
            <p key={`${line.id}-${id}`}>
              对象 {connections.indexOf(line) + 1} ·{' '}
              {line.kind === 'segment'
                ? line.startPoint === id
                  ? '起点'
                  : '终点'
                : line.kind === 'curve'
                  ? '经过点'
                  : '圆心'}{' '}
              →{' '}
              {doc.entities.find((e) => e.id === id)?.kind === 'point'
                ? (doc.entities.find((e) => e.id === id) as { name: string }).name || '连接点'
                : '连接点'}{' '}
              <button
                type="button"
                onClick={() => attempt(() => disconnectEndpoint(doc, line.id, id, role))}
              >
                解除此对象连接
              </button>
            </p>
          )),
      )}
      {(doc.referenceRelations ?? [])
        .filter((r) => r.targetId === e.id)
        .map((r) => (
          <p key={r.id}>
            {
              {
                POINT_ON_REFERENCE: '点落在参考上',
                THROUGH_POINT: '通过参考点',
                PARALLEL: '平行',
                PERPENDICULAR: '垂直',
              }[r.kind]
            }{' '}
            · {referenceRelationName(doc, r.reference)} ·{' '}
            {r.mode === 'BINDING' ? '持续绑定' : '本次定位'} ·{' '}
            {r.status === 'SATISFIED' ? '已满足' : r.status === 'INVALID' ? '未满足' : '待校验'}
            <button
              type="button"
              disabled={!editable(doc, e, role)}
              onClick={() =>
                attempt(() =>
                  transact(
                    doc,
                    (d) => {
                      d.referenceRelations = d.referenceRelations?.filter((v) => v.id !== r.id);
                    },
                    role,
                  ),
                )
              }
            >
              移除此关系记录
            </button>
          </p>
        ))}
      {doc.constraints
        .filter((c) => c.kind === 'INTERSECTION' && c.entityIds[0] === e.id)
        .map((c) => (
          <button
            type="button"
            key={c.id}
            disabled={!editable(doc, e, role)}
            onClick={() =>
              attempt(() =>
                transact(
                  doc,
                  (d) => {
                    d.constraints.find((r) => r.id === c.id)!.mode = 'BINDING';
                  },
                  role,
                ),
              )
            }
          >
            持续绑定此交点
          </button>
        ))}
    </details>
  );
}
