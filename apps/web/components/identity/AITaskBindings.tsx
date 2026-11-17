'use client';
import { Field, Num, Check, OutputMode, number, string, yes, type Center } from './AIFields';
import { identityMessage } from './client';
import { AITaskParameters } from '@tuheng/contracts';
export function AITaskBindings({
  data,
  busy,
  dirty,
  taskKey: selectedTask,
  saved,
  command,
}: {
  data: Center;
  busy: boolean;
  dirty: boolean;
  taskKey: string;
  saved: () => void;
  command: (body: Record<string, unknown>) => Promise<{ id?: string } | null>;
}) {
  return (
    <>
      {Object.entries(data.tasks)
        .filter(([key]) => key === selectedTask)
        .map(([taskKey, task]) => {
          const binding = data.bindings.find((b) => b.taskKey === taskKey),
            p = AITaskParameters.parse(binding?.parameters ?? { outputMode: 'prompt_json' });
          return (
            <form
              className="identity-form"
              data-config-form
              key={`${taskKey}:${binding?.version ?? 0}`}
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const result = await command({
                  operation: 'binding',
                  expectedVersion: binding?.version ?? 0,
                  taskKey,
                  modelId: string(f, 'modelId'),
                  enabled: yes(f, 'enabled'),
                  parameters: {
                    outputMode: string(f, 'outputMode'),
                    maxOutputTokens: number(f, 'maxOutputTokens'),
                    temperature: string(f, 'temperature') === '' ? null : number(f, 'temperature'),
                    perSchoolPerDay: number(f, 'perSchoolPerDay'),
                    perUserPerDay: number(f, 'perUserPerDay'),
                  },
                });
                if (result) saved();
              }}
            >
              <fieldset className="configuration-form-body" disabled={busy}>
                <h3>{task.name}</h3>
                <p>
                  {taskKey} · 版本 {binding?.version ?? '未配置'} · {task.inputSchema} →{' '}
                  {task.outputSchema}
                </p>
                <p className="muted">
                  必须支持文本；题干、参考或作答含图片时，还需要图片能力。声明和协议测试分别核对，保存不会替代评分质量评估。
                </p>
                <p className="configuration-version">
                  当前生效规则诊断：
                  {data.diagnostics[taskKey]?.errorCode
                    ? identityMessage(data.diagnostics[taskKey].errorCode!)
                    : '配置校验通过（不代表评分质量达标）'}
                  <br />
                  含图片输入：
                  {data.diagnostics[taskKey]?.imageErrorCode
                    ? identityMessage(data.diagnostics[taskKey].imageErrorCode!)
                    : '声明能力满足，仍需核对协议测试证据'}
                </p>
                <fieldset>
                  <legend>模型与输出</legend>
                  <Field title="调用模型">
                    <select name="modelId" defaultValue={binding?.modelId ?? ''} required>
                      <option value="">选择模型</option>
                      {data.providers.map((provider) => (
                        <optgroup key={provider.id} label={provider.name}>
                          {data.models
                            .filter((m) => m.providerId === provider.id)
                            .map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name}
                                {!m.enabled || m.archived || !provider.enabled || provider.archived
                                  ? '（不可用）'
                                  : ''}
                              </option>
                            ))}
                        </optgroup>
                      ))}
                    </select>
                  </Field>
                  <OutputMode value={p.outputMode} />
                  <Num
                    name="maxOutputTokens"
                    value={p.maxOutputTokens}
                    title="本模块输出 Token 上限"
                    min={128}
                    max={128000}
                  />
                  <Field title="temperature（空白不发送）">
                    <input
                      name="temperature"
                      type="number"
                      min={0}
                      max={2}
                      step="any"
                      defaultValue={p.temperature ?? ''}
                    />
                  </Field>
                </fieldset>
                <details>
                  <summary>高级配额（每日）</summary>
                  <Num
                    name="perSchoolPerDay"
                    value={p.perSchoolPerDay}
                    title="本模块每校每日请求上限"
                  />
                  <Num
                    name="perUserPerDay"
                    value={p.perUserPerDay}
                    title="本模块每人每日请求上限"
                    max={10000}
                  />
                </details>
                <Check name="enabled" value={binding?.enabled ?? false} title="启用此规则" />
                <div className="configuration-save">
                  <button className="button primary" disabled={busy}>
                    保存模块规则
                  </button>
                </div>
                {binding && (
                  <details>
                    <summary>规则历史</summary>
                    {data.bindings
                      .filter((b) => b.taskKey === taskKey)
                      .map((b) => (
                        <p key={b.id}>
                          版本 {b.version} ·{' '}
                          {data.models.find((m) => m.id === b.modelId)?.name ?? b.modelId}{' '}
                          <button
                            type="button"
                            disabled={busy || dirty}
                            onClick={() =>
                              window.confirm(
                                '恢复将为此模块创建新的规则版本，已排队任务仍使用原快照。确认恢复？',
                              ) &&
                              command({
                                operation: 'rollback',
                                kind: 'binding',
                                id: binding.id,
                                version: b.version,
                                expectedVersion: binding.version,
                              })
                            }
                          >
                            恢复为新版本
                          </button>
                        </p>
                      ))}
                  </details>
                )}
              </fieldset>
            </form>
          );
        })}
    </>
  );
}
