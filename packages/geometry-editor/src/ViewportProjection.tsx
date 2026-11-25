import type { GeometryDocument } from '@tuheng/contracts';
import { addProjectionAxis, orthographic, targetFromKey } from '@tuheng/geometry-core';
import { AxisTools } from './AxisTools';
import { ConstructionPanel } from './ConstructionPanel';
import type { AxisDraft } from './projection-command';
import type { EditorControls } from './types';

export function ViewportProjection({
  controls,
  axis,
  setAxis,
  preview,
  clearPreview,
  accept,
  cancelGesture,
}: {
  controls: EditorControls;
  axis: AxisDraft | null;
  setAxis: (draft: AxisDraft | null) => void;
  preview?: GeometryDocument;
  clearPreview: () => void;
  accept: (drawing: GeometryDocument) => GeometryDocument | undefined;
  cancelGesture: () => void;
}) {
  const { document: doc, role, session, dispatch, readOnly, report } = controls;
  return (
    <>
      {session.construction && (
        <ConstructionPanel
          construction={session.construction}
          document={doc}
          dispatch={dispatch}
          validPreview={!!preview}
          confirm={() => {
            if (preview) accept(preview);
          }}
          clearPreview={clearPreview}
        />
      )}
      {axis && (
        <div className="geo-snap" role="status">
          新轴 {axis.spec.name} · {axis.phase === 'confirm' ? '检查展开侧后确认' : '在图纸上定位'}
          <button
            type="button"
            disabled={axis.phase !== 'confirm'}
            onClick={() => {
              try {
                accept(addProjectionAxis(doc, axis.spec, role));
                setAxis(null);
                report('新轴已创建；学生投影点由学生自行作图');
              } catch (error) {
                report(error instanceof Error ? error.message : '几何操作失败');
              }
            }}
          >
            确认新轴
          </button>
          <button type="button" onClick={() => setAxis(null)}>
            取消新轴
          </button>
        </div>
      )}
      {!readOnly && session.panel === 'axis' && orthographic(doc) && (
        <div className="geo-panel" role="dialog" aria-label="新增投影轴">
          <button type="button" onClick={() => dispatch({ type: 'patch', patch: { panel: null } })}>
            关闭面板
          </button>
          <AxisTools
            doc={doc}
            role={role}
            commit={controls.commit}
            report={report}
            initialSystemId={
              controls.selected.map(targetFromKey).find((r) => r.kind === 'projectionAxis')
                ?.systemId
            }
            start={(spec) => {
              cancelGesture();
              dispatch({ type: 'patch', patch: { panel: null } });
              setAxis({ spec, phase: spec.method === 'FREE' ? 'anchor' : 'reference' });
              report(spec.method === 'FREE' ? '点击新轴的第一点' : '点击保留面中的参考线或投影轴');
            }}
          />
        </div>
      )}
    </>
  );
}
