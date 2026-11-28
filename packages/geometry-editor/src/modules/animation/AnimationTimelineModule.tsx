import { useEffect, useRef } from 'react';
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
  const timeline = useRef<HTMLElement>(null);
  const currentStep = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const list = timeline.current;
    const active = currentStep.current;
    if (!list || !active) return;
    const reveal = () => {
      if (!list.clientWidth) return;
      const viewport = list.getBoundingClientRect();
      const step = active.getBoundingClientRect();
      const inset = 8;
      if (step.right > viewport.right - inset)
        list.scrollLeft += step.right - viewport.right + inset;
      else if (step.left < viewport.left + inset)
        list.scrollLeft += step.left - viewport.left - inset;
    };
    reveal();
    const resize = new ResizeObserver(reveal);
    resize.observe(list);
    return () => resize.disconnect();
  }, [animation, index]);
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
      <nav ref={timeline} className="geo-construction-timeline" aria-label="作图步骤时间轴">
        {groups.map(({ id, steps }) => (
          <div key={steps[0].id} className="geo-timeline-phase">
            <span>{id ? names.get(id) : '未分阶段'}</span>
            <div className="geo-timeline-steps">
              {steps.map((step) => (
                <button
                  key={step.id}
                  ref={step.order === index ? currentStep : undefined}
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
