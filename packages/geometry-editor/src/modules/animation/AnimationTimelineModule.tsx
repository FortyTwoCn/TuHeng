import type { ConstructionAnimationDocument } from '@tuheng/contracts';

const legend = [
  ['visible', '可见轮廓'],
  ['hidden', '不可见轮廓'],
  ['draw', '当前步骤'],
  ['guide', '作图线'],
  ['special', '特殊点'],
  ['general', '一般点'],
  ['erase', '被切去的轮廓'],
] as const;

export function AnimationTimelineModule({
  animation,
  index,
  jump,
}: {
  animation: ConstructionAnimationDocument;
  index: number;
  jump: (index: number) => void;
}) {
  const names = new Map(animation.phases.map((phase) => [phase.id, phase.title]));
  const groups: { id?: string; steps: ConstructionAnimationDocument['steps'] }[] = [];
  for (const step of animation.steps) {
    if (!groups.length || groups.at(-1)?.id !== step.phaseId)
      groups.push({ id: step.phaseId, steps: [] });
    groups.at(-1)!.steps.push(step);
  }
  return (
    <div className="geo-construction-footer">
      <div className="geo-construction-legend" aria-label="作图线型图例">
        {legend.map(([key, label]) => (
          <span key={key}>
            <i data-sample={key} aria-hidden="true" />
            {label}
          </span>
        ))}
      </div>
      <nav className="geo-construction-timeline" aria-label="作图步骤时间轴">
        {groups.map(({ id, steps }) => (
          <div key={steps[0].id} className="geo-timeline-phase">
            <span>{id ? names.get(id) : '未分阶段'}</span>
            <div className="geo-timeline-steps">
              {steps.map((step) => (
                <button
                  key={step.id}
                  type="button"
                  title={step.title}
                  aria-current={step.order === index ? 'step' : undefined}
                  onClick={() => jump(step.order)}
                >
                  第 {step.order + 1} 步
                </button>
              ))}
            </div>
          </div>
        ))}
      </nav>
    </div>
  );
}
