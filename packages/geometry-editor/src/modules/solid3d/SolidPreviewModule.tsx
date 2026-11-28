import { Box } from 'lucide-react';
import type { DrawingReconstructionResult } from '@tuheng/geometry-core';
import { SolidPreview, type SolidPreviewProps } from './SolidPreview';

export function SolidPreviewModule({
  scene,
  build,
  generate,
  available,
  review,
  reason,
  ...props
}: Omit<SolidPreviewProps, 'scene'> & {
  scene?: SolidPreviewProps['scene'];
  build?: { result?: DrawingReconstructionResult; error?: string };
  generate: () => void;
  available: boolean;
  review?: () => void;
  reason?: string;
}) {
  const failure =
    build?.error ?? (build?.result && !build.result.ok ? build.result.reason : undefined);
  const pending = available && !!build && !failure;
  const message = pending
    ? '正在重建三维场景…'
    : available
      ? (failure ?? '根据当前图纸的正交投影查看空间结构。')
      : reason;
  const action = available ? generate : review;
  const actionLabel = !available ? '查看审核项' : failure ? '重新生成三维模型' : '生成三维模型';
  return (
    <section className="geo-solid-pane" aria-label="立体图三维预览" data-scene-kind={scene?.kind}>
      {scene ? (
        <SolidPreview {...props} scene={scene} />
      ) : (
        <>
          <header className="geo-solid-heading">
            <h3>立体图 3D</h3>
          </header>
          <div className="geo-solid-placeholder">
            <div className="geo-solid-message">
              <span className="geo-solid-icon" aria-hidden="true">
                <Box size={27} strokeWidth={1.5} />
              </span>
              <p role={pending ? 'status' : available && failure ? 'alert' : undefined}>
                {message}
              </p>
              {!pending && action && (
                <button
                  className={available ? 'geo-teaching-primary' : undefined}
                  type="button"
                  onClick={action}
                >
                  {actionLabel}
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
