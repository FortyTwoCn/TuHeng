import type { CurveDraft } from './curve-session';
export function CurveControls({
  draft,
  confirm,
  change,
}: {
  draft: CurveDraft | null;
  confirm: () => void;
  change: (d: CurveDraft | null) => void;
}) {
  const count = draft?.marks.length ?? 0;
  return (
    <div className="geo-snap geo-curve-controls" data-curve-controls="true">
      <span role="status">
        {count === 0
          ? '曲线：选择第一个端点（也可点击空白新建）'
          : count === 1
            ? '选择第二个端点'
            : draft?.finishAt !== undefined
              ? '检查曲线预览，点击确认完成'
              : `按顺序标记经过点（已有 ${count - 2} 个），完成后点击任意端点`}
      </span>
      <button type="button" disabled={draft?.finishAt === undefined} onClick={confirm}>
        确认曲线
      </button>
      <button
        type="button"
        disabled={!count}
        onClick={() =>
          change(
            draft && draft.marks.length > 1
              ? { ...draft, marks: draft.marks.slice(0, -1), finishAt: undefined }
              : null,
          )
        }
      >
        撤回上一点
      </button>
      <button type="button" onClick={() => change(null)}>
        取消曲线
      </button>
    </div>
  );
}
