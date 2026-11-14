import type { GeometryDocument } from '@tuheng/contracts';
import { transact } from '@tuheng/geometry-core';
export function ProjectionSettings({
  document: doc,
  perform,
}: {
  document: GeometryDocument;
  perform: (operation: () => GeometryDocument) => void;
}) {
  const orthographic = doc.editorType === 'VHW_PROJECTION' || doc.editorType === 'THREE_VIEW';
  return (
    <details>
      <summary>投影参数</summary>
      <div className="geo-fields">
        {orthographic && (
          <>
            <label>
              侧视约定
              <select
                value={doc.projectionConfig.convention}
                onChange={(event) =>
                  perform(() =>
                    transact(doc, (d) => {
                      const convention = event.target
                        .value as GeometryDocument['projectionConfig']['convention'];
                      d.projectionConfig.convention = convention;
                      const side = d.views[2];
                      side.signs[0] = convention === 'FIRST_ANGLE_LEFT' ? 1 : -1;
                      if (d.editorType === 'THREE_VIEW')
                        side.name = convention === 'FIRST_ANGLE_LEFT' ? '左视图' : '右视图';
                    }),
                  )
                }
              >
                <option value="FIRST_ANGLE_LEFT">第一角法 · 左视图</option>
                <option value="THIRD_ANGLE_RIGHT">第三角法 · 右视图</option>
              </select>
            </label>
            {doc.views.map((view) => (
              <label key={view.id}>
                {view.name} 展开方向
                <select
                  value={view.signs.join(',')}
                  onChange={(event) =>
                    perform(() =>
                      transact(doc, (d) => {
                        d.views.find((v) => v.id === view.id)!.signs = event.target.value
                          .split(',')
                          .map(Number) as [1 | -1, 1 | -1];
                      }),
                    )
                  }
                >
                  <option value="1,1">正向 / 正向</option>
                  <option value="1,-1">正向 / 反向</option>
                  <option value="-1,1">反向 / 正向</option>
                  <option value="-1,-1">反向 / 反向</option>
                </select>
              </label>
            ))}
          </>
        )}
        {doc.editorType === 'OBLIQUE_DIMETRIC' &&
          (['depthAngle', 'depthScale'] as const).map((key) => (
            <label key={key}>
              {key === 'depthAngle' ? '深度轴角度' : '深度缩短系数'}
              <input
                type="number"
                step="0.1"
                value={doc.projectionConfig[key]}
                onChange={(event) =>
                  perform(() =>
                    transact(doc, (d) => {
                      d.projectionConfig[key] = event.target.valueAsNumber;
                    }),
                  )
                }
              />
            </label>
          ))}
        {doc.editorType === 'ISOMETRIC' &&
          (['x', 'y', 'z'] as const).map((axis) => (
            <fieldset key={axis}>
              <legend>{axis} 轴</legend>
              {(['angle', 'scale'] as const).map((key) => (
                <label key={key}>
                  {key === 'angle' ? '角度' : '比例'}
                  <input
                    type="number"
                    step="0.1"
                    value={doc.projectionConfig.axes[axis][key]}
                    onChange={(event) =>
                      perform(() =>
                        transact(doc, (d) => {
                          d.projectionConfig.axes[axis][key] = event.target.valueAsNumber;
                        }),
                      )
                    }
                  />
                </label>
              ))}
            </fieldset>
          ))}
      </div>
    </details>
  );
}
