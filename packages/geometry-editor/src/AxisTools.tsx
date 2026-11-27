import { useState } from 'react';
import type { GeometryDocument } from '@tuheng/contracts';
import { suggestAxisNames, transact, type AxisConstruction } from '@tuheng/geometry-core';
export function AxisTools({
  doc,
  role,
  start,
  commit,
  report,
  initialSystemId = '',
}: {
  doc: GeometryDocument;
  initialSystemId?: string;
  role: 'teacher' | 'student';
  start: (spec: AxisConstruction) => void;
  commit: (doc: GeometryDocument) => void;
  report: (text: string) => void;
}) {
  const [parent, setParent] = useState(initialSystemId),
    [retained, setRetained] = useState(
      doc.auxiliarySystems?.find((a) => a.id === initialSystemId)?.newViewId ??
        doc.views[1]?.id ??
        doc.views[0].id,
    ),
    [method, setMethod] = useState<AxisConstruction['method']>('FREE'),
    [name, setName] = useState(''),
    [viewName, setViewName] = useState('');
  const auxiliaryViews = new Set(doc.auxiliarySystems?.map((a) => a.newViewId));
  const baseViews = doc.views.filter((v) => !auxiliaryViews.has(v.id));
  const system = doc.auxiliarySystems?.find((a) => a.id === parent),
    pair = system
      ? [system.retainedViewId, system.newViewId]
      : baseViews.map((v) => v.id);
  const [replaced, setReplaced] = useState(doc.views[0].id);
  const retainedId = pair.includes(retained) ? retained : (pair[1] ?? pair[0]),
    replacedId = pair.includes(replaced) ? replaced : pair[0];
  const suggested = suggestAxisNames(doc, replacedId);
  return (
    <details className="geo-axis-tools" open>
      <summary>新增投影轴 / 换面</summary>
      {role === 'teacher' && (
        <label>
          <input
            type="checkbox"
            checked={doc.sheet?.allowAuxiliaryViews ?? false}
            onChange={(e) =>
              commit(
                transact(doc, (d) => {
                  d.sheet!.allowAuxiliaryViews = e.target.checked;
                }),
              )
            }
          />
          允许学生新增换面轴
        </label>
      )}
      <div className="geo-fields">
        <label>
          父投影系
          <select
            value={system?.id ?? ''}
            onChange={(e) => {
              setParent(e.target.value);
              const a = doc.auxiliarySystems?.find((a) => a.id === e.target.value);
              setRetained(a?.newViewId ?? baseViews[1].id);
              setReplaced(a?.retainedViewId ?? baseViews[0].id);
            }}
          >
            <option value="">基准投影系</option>
            {doc.auxiliarySystems?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          保留投影面
          <select value={retainedId} onChange={(e) => setRetained(e.target.value)}>
            {pair.map((id) => (
              <option key={id} value={id}>
                {doc.views.find((v) => v.id === id)?.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          替换投影面
          <select value={replacedId} onChange={(e) => setReplaced(e.target.value)}>
            {pair.map((id) => (
              <option key={id} value={id}>
                {doc.views.find((v) => v.id === id)?.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          新轴构造
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as AxisConstruction['method'])}
          >
            <option value="FREE">普通 · 两点定轴</option>
            <option value="PARALLEL">平行参考线</option>
            <option value="PERPENDICULAR">垂直参考线</option>
          </select>
        </label>
        <label>
          轴名称
          <input
            value={name}
            placeholder={suggested.name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          新面名称
          <input
            value={viewName}
            placeholder={suggested.viewName}
            onChange={(e) => setViewName(e.target.value)}
          />
        </label>
      </div>
      <button
        type="button"
        disabled={role === 'student' && !doc.sheet?.allowAuxiliaryViews}
        onClick={() => {
          if (retainedId === replacedId) {
            report('保留面与替换面必须不同');
            return;
          }
          start({
            name: name || suggested.name,
            viewName: viewName || suggested.viewName,
            parentId: system?.id ?? null,
            retainedViewId: retainedId,
            replacedViewId: replacedId,
            method,
            referenceEntityId: null,
            anchor: { x: 0, y: 0 },
            through: { x: 1, y: 0 },
            side: 1,
          });
        }}
      >
        开始定位新轴
      </button>
      {(doc.auxiliarySystems?.length ?? 0) > 0 && (
        <p>
          已有轴：{doc.auxiliarySystems?.map((a) => a.name).join('、')}
          。点击图纸上的轴查看属性、重命名或按依赖规则删除。
        </p>
      )}
    </details>
  );
}
