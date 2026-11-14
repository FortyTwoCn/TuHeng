import type { GeometryDocument } from '@tuheng/contracts';
import { disconnectEndpoint, pointReferences, editable, transact } from '@tuheng/geometry-core';
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
              {line.id.slice(0, 8)} → {id.slice(0, 8)}{' '}
              <button
                type="button"
                onClick={() => attempt(() => disconnectEndpoint(doc, line.id, id, role))}
              >
                解除此对象连接
              </button>
            </p>
          )),
      )}
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
