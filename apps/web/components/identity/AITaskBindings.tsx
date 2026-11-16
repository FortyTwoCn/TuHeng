'use client';
import { Field, Num, Check, OutputMode, number, string, yes, type Center } from './AIFields';
import { AITaskParameters } from '@tuheng/contracts';
export function AITaskBindings({
  data,
  busy,
  proof,
  command,
}: {
  data: Center;
  busy: boolean;
  proof: string;
  command: (body: Record<string, unknown>) => Promise<{ id?: string } | null>;
}) {
  return (
    <>
      {Object.entries(data.tasks).map(([taskKey, task]) => {
        const binding = data.bindings.find((b) => b.taskKey === taskKey),
          p = AITaskParameters.parse(binding?.parameters ?? { outputMode: 'prompt_json' });
        return (
          <form
            className="identity-form"
            key={`${taskKey}:${binding?.version ?? 0}`}
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void command({
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
            }}
          >
            <h3>{task.name}</h3>
            <p>
              {taskKey} · 版本 {binding?.version ?? '未配置'} · {task.inputSchema} →{' '}
              {task.outputSchema}
            </p>
            <Field title="调用模型">
              <select name="modelId" defaultValue={binding?.modelId ?? ''} required>
                <option value="">选择模型</option>
                {data.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                    {!m.enabled || m.archived ? '（不可用）' : ''}
                  </option>
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
            <Num name="perSchoolPerDay" value={p.perSchoolPerDay} title="本模块每校每日请求上限" />
            <Num
              name="perUserPerDay"
              value={p.perUserPerDay}
              title="本模块每人每日请求上限"
              max={10000}
            />
            <Check name="enabled" value={binding?.enabled ?? false} title="启用此规则" />
            <button disabled={!proof || busy}>保存模块规则</button>
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
                        disabled={!proof || busy}
                        onClick={() =>
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
          </form>
        );
      })}
    </>
  );
}
