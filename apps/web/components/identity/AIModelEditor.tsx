'use client';
import { Field, Num, Check, Protocol, number, string, yes, type Center } from './AIFields';
import { AIModelConfig } from '@tuheng/contracts';
import { ModelTests } from './AIModelTests';
export function AIModelEditor({
  data,
  busy,
  command,
  modelId,
  setModelId,
  query,
  setQuery,
}: {
  data: Center;
  busy: boolean;
  command: (body: Record<string, unknown>) => Promise<{ id?: string } | null>;
  query: string;
  setQuery: (q: string) => void;
  modelId: string;
  setModelId: (id: string) => void;
}) {
  const model = data.models.find((m) => m.id === modelId);
  const mc = AIModelConfig.parse(
    model?.versions[0]?.config ?? { model: '填写实际模型 ID', outputModes: ['prompt_json'] },
  );
  return (
    <div>
      <Field title="搜索模型名称">
        <input value={query} onChange={(e) => setQuery(e.target.value)} />
      </Field>
      <Field title="编辑模型">
        <select value={modelId} onChange={(e) => setModelId(e.target.value)}>
          <option value="">手动添加模型</option>
          {data.models.map((m) => (
            <option value={m.id} key={m.id}>
              {m.name} · {m.archived ? '已归档' : m.enabled ? '启用' : '停用'}
            </option>
          ))}
        </select>
      </Field>
      <form
        className="identity-form"
        key={`${modelId}:${model?.currentVersion ?? 0}`}
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const result = await command({
            operation: 'model',
            id: modelId || undefined,
            expectedVersion: model?.currentVersion ?? 0,
            providerId: string(f, 'providerId'),
            name: string(f, 'name'),
            enabled: yes(f, 'enabled'),
            archived: yes(f, 'archived'),
            config: {
              model: string(f, 'model'),
              protocol: string(f, 'protocol') || null,
              baseUrl: string(f, 'baseUrl') || null,
              endpoint: string(f, 'endpoint') || null,
              text: yes(f, 'text'),
              images: yes(f, 'images'),
              outputModes: ['json_schema', 'json_object', 'prompt_json'].filter((k) => yes(f, k)),
              temperature: yes(f, 'temperature'),
              temperatureMax: number(f, 'temperatureMax'),
              tokenParameter: string(f, 'tokenParameter'),
              maxOutputTokens: number(f, 'maxOutputTokens'),
              systemRole: string(f, 'systemRole'),
              pricing: yes(f, 'pricing')
                ? {
                    currency: string(f, 'currency'),
                    inputPerMillion: number(f, 'inputPrice'),
                    outputPerMillion: number(f, 'outputPrice'),
                  }
                : null,
            },
          });
          if (result?.id) setModelId(result.id);
        }}
      >
        <Field title="供应商">
          <select
            name="providerId"
            defaultValue={model?.providerId ?? data.providers[0]?.id}
            required
          >
            {data.providers
              .filter((p) => !p.archived)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </Field>
        <Field title="模型显示名">
          <input name="name" defaultValue={model?.name} required />
        </Field>
        <Field title="供应商实际 model ID">
          <input name="model" defaultValue={model ? mc.model : ''} required />
        </Field>
        <Protocol value={mc.protocol ?? ''} inherit />
        <Check name="text" value={mc.text} title="支持文本" />
        <Check name="images" value={mc.images} title="声明支持图片输入（不代表已测试）" />
        <fieldset>
          <legend>声明输出能力</legend>
          {[
            ['json_schema', '原生 JSON Schema'],
            ['json_object', 'JSON 模式'],
            ['prompt_json', '提示词约定 JSON'],
          ].map(([key, label]) => (
            <Check
              key={key}
              name={key}
              value={mc.outputModes.includes(key as (typeof mc.outputModes)[number])}
              title={label}
            />
          ))}
        </fieldset>
        <Num
          name="maxOutputTokens"
          title="允许的输出 Token 上限"
          value={mc.maxOutputTokens}
          min={128}
          max={128000}
        />
        <Field title="Token 参数名">
          <select name="tokenParameter" defaultValue={mc.tokenParameter}>
            <option>max_completion_tokens</option>
            <option>max_tokens</option>
          </select>
        </Field>
        <Check name="temperature" value={mc.temperature} title="接受 temperature 参数" />
        <Num name="temperatureMax" title="温度上限" value={mc.temperatureMax} min={0} max={2} />
        <details>
          <summary>端点覆盖与价格估算</summary>
          <Field title="覆盖 Base URL（空白继承）">
            <input name="baseUrl" type="url" defaultValue={mc.baseUrl ?? ''} />
          </Field>
          <Field title="相对于 Base URL 的端点（如 /messages）">
            <input name="endpoint" defaultValue={mc.endpoint ?? ''} />
          </Field>
          <Field title="OpenAI 系统消息角色">
            <select name="systemRole" defaultValue={mc.systemRole}>
              <option>system</option>
              <option>developer</option>
            </select>
          </Field>
          <Check name="pricing" value={!!mc.pricing} title="维护此版本的估算单价" />
          <Field title="币种">
            <select name="currency" defaultValue={mc.pricing?.currency ?? 'CNY'}>
              <option>CNY</option>
              <option>USD</option>
            </select>
          </Field>
          <Field title="每百万输入 Token">
            <input
              type="number"
              name="inputPrice"
              step="any"
              min={0}
              defaultValue={mc.pricing?.inputPerMillion ?? 0}
            />
          </Field>
          <Field title="每百万输出 Token">
            <input
              type="number"
              name="outputPrice"
              step="any"
              min={0}
              defaultValue={mc.pricing?.outputPerMillion ?? 0}
            />
          </Field>
        </details>
        <Check name="enabled" value={model?.enabled ?? false} title="启用模型" />
        <Check
          name="archived"
          value={model?.archived ?? false}
          title="归档（已有规则不会自动改选其他模型）"
        />
        <button disabled={busy || !data.providers.length}>保存模型版本</button>
      </form>
      {model && (
        <>
          <ModelTests model={model} command={command} disabled={busy} />
          <details>
            <summary>版本和模块引用</summary>
            <p>
              {Object.keys(data.tasks)
                .filter((k) => data.bindings.find((b) => b.taskKey === k)?.modelId === model.id)
                .join('、') || '未被当前规则引用'}
            </p>
            {model.versions.map((v) => (
              <p key={v.id}>
                版本 {v.version}{' '}
                <button
                  disabled={busy}
                  onClick={() =>
                    command({
                      operation: 'rollback',
                      kind: 'model',
                      id: model.id,
                      version: v.version,
                      expectedVersion: model.currentVersion,
                    })
                  }
                >
                  恢复为新版本
                </button>
              </p>
            ))}
          </details>
        </>
      )}
    </div>
  );
}
