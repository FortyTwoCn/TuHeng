import { resolveReference, point } from '@tuheng/geometry-core';
import type { GeometryDocument, GeometryTargetRef } from '@tuheng/contracts';
import type { Dispatch } from 'react';
import type { ConstructionSession, SessionAction } from './session';
export function ConstructionPanel({
  construction,
  document: doc,
  dispatch,
  confirm,
  clearPreview,
  validPreview,
}: {
  construction: ConstructionSession;
  document: GeometryDocument;
  dispatch: Dispatch<SessionAction>;
  confirm: () => void;
  clearPreview: () => void;
  validPreview: boolean;
}) {
  const describe = (ref: GeometryTargetRef) => {
    const r = resolveReference(doc, ref);
    const e = ref.kind === 'entity' ? doc.entities.find((e) => e.id === ref.entityId) : undefined;
    const at =
      e?.kind === 'segment' ? point(doc, e.startPoint) : e?.kind === 'line' ? e.anchor : undefined;
    return (
      r.name +
      (e ? ' · ' + doc.views.find((v) => v.id === e.viewId)?.name : '') +
      (at ? `（起点/锚点 u ${at.x.toFixed(1)}, v ${at.y.toFixed(1)}）` : '')
    );
  };
  return (
    <div className="geo-operation-panel" role="dialog" aria-label="构造与关系">
      <strong>
        {construction.spec.directionMode === 'PARALLEL' ? '平行' : '垂直'} ·{' '}
        {construction.phase === 'reference'
          ? '请选择参考线或轴'
          : construction.phase === 'position'
            ? '选择通过点'
            : construction.phase === 'target'
              ? '选择待修改线'
              : '检查预览'}
      </strong>
      {construction.reference && <p>参考：{describe(construction.reference)}（保持不动）</p>}
      {construction.targetId && (
        <p>
          待修改：{describe({ kind: 'entity', entityId: construction.targetId })} · 固定起点和长度
        </p>
      )}
      <fieldset className="geo-fields" disabled={construction.phase === 'confirm'}>
        {construction.mode === 'create' ? (
          <>
            <label>
              几何范围
              <select
                value={construction.spec.geometryExtent}
                onChange={(e) =>
                  dispatch({
                    type: 'patch',
                    patch: {
                      construction: {
                        ...construction,
                        spec: {
                          ...construction.spec,
                          geometryExtent: e.target.value as 'line' | 'segment',
                        },
                      },
                    },
                  })
                }
              >
                <option value="line">无限辅助线</option>
                <option value="segment">有限线段</option>
              </select>
            </label>
            <label>
              线型
              <select
                value={construction.spec.semanticStyle}
                onChange={(e) =>
                  dispatch({
                    type: 'patch',
                    patch: {
                      construction: {
                        ...construction,
                        spec: {
                          ...construction.spec,
                          semanticStyle: e.target.value as 'visible' | 'hidden',
                        },
                      },
                    },
                  })
                }
              >
                <option value="visible">实线</option>
                <option value="hidden">虚线</option>
              </select>
            </label>
            <label>
              构造长度 (mm)
              <input
                type="number"
                min="0.01"
                value={construction.spec.length}
                onChange={(e) =>
                  dispatch({
                    type: 'patch',
                    patch: {
                      construction: {
                        ...construction,
                        spec: {
                          ...construction.spec,
                          length: Number(e.target.value),
                        },
                      },
                    },
                  })
                }
              />
            </label>
          </>
        ) : (
          <label>
            <input
              type="checkbox"
              checked={construction.keep}
              onChange={(e) => {
                clearPreview();
                dispatch({
                  type: 'patch',
                  patch: {
                    construction: {
                      ...construction,
                      keep: e.target.checked,
                      phase: 'target',
                    },
                  },
                });
              }}
            />
            保持关系（有向绑定）
          </label>
        )}
      </fieldset>
      {construction.phase === 'confirm' && (
        <>
          {!validPreview && <p>文档已更新，请重新选择位置或目标。</p>}
          <button
            type="button"
            onClick={() => {
              clearPreview();
              dispatch({
                type: 'patch',
                patch: {
                  construction: {
                    ...construction,
                    phase: construction.mode === 'create' ? 'position' : 'target',
                  },
                },
              });
            }}
          >
            重新选择
          </button>
          <button
            type="button"
            disabled={!validPreview}
            onClick={() => {
              confirm();
              clearPreview();
              dispatch({ type: 'patch', patch: { construction: null } });
            }}
          >
            {construction.mode === 'create' ? '确认创建' : '确认方向调整'}
          </button>
        </>
      )}
      <button
        type="button"
        onClick={() => {
          clearPreview();

          dispatch({ type: 'patch', patch: { construction: null } });
        }}
      >
        取消构造
      </button>
    </div>
  );
}
