import { useState } from 'react';
import {
  constructionReferenceFields,
  type ConstructionAnimationDocument,
  type ConstructionAnimationStep,
} from '@tuheng/contracts';

const kinds: Record<ConstructionAnimationStep['kind'], string> = {
  CENTERLINE: '中心线',
  CONSTRUCT: '作投影线',
  DRAW: '画轮廓',
  ERASE: '擦除',
  DEEPEN: '加深',
};
const referenceNames = {
  entityIds: '主体',
  constructionEntityIds: '辅助线',
  eraseEntityIds: '擦除',
};
type Ordered = { id: string; order: number };
const renumber = <T extends Ordered>(list: T[]) => list.map((item, order) => ({ ...item, order }));
function move<T extends Ordered>(list: T[], index: number, offset: number) {
  const next = [...list];
  [next[index], next[index + offset]] = [next[index + offset], next[index]];
  return renumber(next);
}

export function ConstructionAuthor({
  initial,
  selected,
  save,
  generate,
  reset,
  hasSaved,
}: {
  initial: ConstructionAnimationDocument;
  selected: string[];
  save: (value: ConstructionAnimationDocument) => void;
  generate: () => ConstructionAnimationDocument;
  reset: () => void;
  hasSaved: boolean;
}) {
  const [draft, setDraft] = useState(initial);
  const [stepId, setStepId] = useState(initial.steps[0].id);
  const [phaseId, setPhaseId] = useState(initial.phases[0]?.id ?? '');
  const step = draft.steps.find((step) => step.id === stepId) ?? draft.steps[0];
  const phase = draft.phases.find((phase) => phase.id === phaseId) ?? draft.phases[0];

  const changeStep = (patch: Partial<ConstructionAnimationStep>) =>
    setDraft((value) => ({
      ...value,
      steps: value.steps.map((item) => (item.id === step.id ? { ...item, ...patch } : item)),
    }));

  return (
    <div
      className="geo-construction-author"
      onKeyDown={(event) => {
        if (event.key === 'Enter' && event.target instanceof HTMLInputElement)
          event.preventDefault();
      }}
    >
      <label>
        动画标题
        <input
          maxLength={120}
          value={draft.title}
          onChange={(event) => setDraft({ ...draft, title: event.target.value })}
        />
      </label>
      <label>
        动画说明
        <textarea
          rows={2}
          maxLength={4000}
          value={draft.description}
          onChange={(event) => setDraft({ ...draft, description: event.target.value })}
        />
      </label>
      <fieldset>
        <legend>阶段</legend>
        <label>
          编辑阶段
          <select value={phase?.id ?? ''} onChange={(event) => setPhaseId(event.target.value)}>
            {!phase && <option value="">无阶段</option>}
            {draft.phases.map((item) => (
              <option key={item.id} value={item.id}>
                {item.order + 1} · {item.title}
              </option>
            ))}
          </select>
        </label>
        {phase && (
          <label>
            阶段名称
            <input
              maxLength={120}
              value={phase.title}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  phases: draft.phases.map((item) =>
                    item.id === phase.id ? { ...item, title: event.target.value } : item,
                  ),
                })
              }
            />
          </label>
        )}
        <div className="geo-teaching-controls">
          <button
            type="button"
            disabled={draft.phases.length >= 64}
            onClick={() => {
              const id = crypto.randomUUID();
              setPhaseId(id);
              setDraft({
                ...draft,
                phases: [...draft.phases, { id, order: draft.phases.length, title: '新阶段' }],
              });
            }}
          >
            新增阶段
          </button>
          {phase && (
            <>
              <button
                type="button"
                disabled={!phase.order}
                onClick={() => setDraft({ ...draft, phases: move(draft.phases, phase.order, -1) })}
              >
                阶段上移
              </button>
              <button
                type="button"
                disabled={phase.order === draft.phases.length - 1}
                onClick={() => setDraft({ ...draft, phases: move(draft.phases, phase.order, 1) })}
              >
                阶段下移
              </button>
              <button
                type="button"
                onClick={() =>
                  setDraft({
                    ...draft,
                    phases: renumber(draft.phases.filter((item) => item.id !== phase.id)),
                    steps: draft.steps.map((item) =>
                      item.phaseId === phase.id ? { ...item, phaseId: undefined } : item,
                    ),
                  })
                }
              >
                删除阶段
              </button>
            </>
          )}
        </div>
      </fieldset>
      <fieldset>
        <legend>步骤</legend>
        <label>
          编辑步骤
          <select value={step.id} onChange={(event) => setStepId(event.target.value)}>
            {draft.steps.map((item) => (
              <option key={item.id} value={item.id}>
                {item.order + 1} · {item.title}
              </option>
            ))}
          </select>
        </label>
        <div className="geo-teaching-controls">
          <button
            type="button"
            disabled={draft.steps.length >= 200}
            onClick={() => {
              const id = crypto.randomUUID();
              setStepId(id);
              setDraft({
                ...draft,
                steps: [
                  ...draft.steps,
                  {
                    id,
                    order: draft.steps.length,
                    phaseId: phase?.id,
                    title: '新步骤',
                    narration: '说明本步的定位依据和笔顺。',
                    kind: 'DRAW',
                    entityIds: [],
                  },
                ],
              });
            }}
          >
            新增步骤
          </button>
          <button
            type="button"
            disabled={!step.order}
            onClick={() => setDraft({ ...draft, steps: move(draft.steps, step.order, -1) })}
          >
            步骤上移
          </button>
          <button
            type="button"
            disabled={step.order === draft.steps.length - 1}
            onClick={() => setDraft({ ...draft, steps: move(draft.steps, step.order, 1) })}
          >
            步骤下移
          </button>
          <button
            type="button"
            disabled={draft.steps.length === 1}
            onClick={() =>
              setDraft({
                ...draft,
                steps: renumber(draft.steps.filter((item) => item.id !== step.id)),
              })
            }
          >
            删除步骤
          </button>
        </div>
        <label>
          步骤标题
          <input
            maxLength={120}
            value={step.title}
            onChange={(event) => changeStep({ title: event.target.value })}
          />
        </label>
        <label>
          步骤讲解
          <textarea
            maxLength={4000}
            rows={4}
            value={step.narration}
            onChange={(event) => changeStep({ narration: event.target.value })}
          />
        </label>
        <label>
          所属阶段
          <select
            value={step.phaseId ?? ''}
            onChange={(event) => changeStep({ phaseId: event.target.value || undefined })}
          >
            <option value="">未分阶段</option>
            {draft.phases.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          步骤类型
          <select
            value={step.kind}
            onChange={(event) => {
              const kind = event.target.value as ConstructionAnimationStep['kind'];
              changeStep(kind === 'ERASE' ? { kind } : { kind, eraseEntityIds: undefined });
            }}
          >
            {Object.entries(kinds).map(([kind, label]) => (
              <option key={kind} value={kind}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          建议时长（毫秒）
          <input
            type="number"
            value={step.durationMs ?? ''}
            onChange={(event) =>
              changeStep({
                durationMs: event.target.value ? event.target.valueAsNumber : undefined,
              })
            }
          />
        </label>
        <p>已选中图元 {selected.length} 个。按选择顺序追加至本步。</p>
        {constructionReferenceFields.map(
          (field) =>
            (field !== 'eraseEntityIds' || step.kind === 'ERASE') && (
              <div key={field} className="geo-teaching-controls">
                <button
                  type="button"
                  disabled={!selected.length}
                  onClick={() =>
                    changeStep({ [field]: [...new Set([...(step[field] ?? []), ...selected])] })
                  }
                >
                  绑定{referenceNames[field]}（{step[field]?.length ?? 0}）
                </button>
                <button
                  type="button"
                  disabled={!step[field]?.length}
                  onClick={() => changeStep({ [field]: [] })}
                >
                  清除{referenceNames[field]}绑定
                </button>
              </div>
            ),
        )}
      </fieldset>
      <div className="geo-teaching-controls">
        <button type="button" className="geo-teaching-primary" onClick={() => save(draft)}>
          保存动画编排
        </button>
        <button
          type="button"
          onClick={() => {
            const value = generate();
            setDraft(value);
            setStepId(value.steps[0].id);
            setPhaseId(value.phases[0].id);
          }}
        >
          自动生成默认步骤
        </button>
        {hasSaved && (
          <button type="button" onClick={reset}>
            清除已保存动画
          </button>
        )}
      </div>
    </div>
  );
}
