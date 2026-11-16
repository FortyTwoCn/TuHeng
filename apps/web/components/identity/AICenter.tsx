'use client';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AIModelConfig, AIProviderConfig, AITaskParameters } from '@tuheng/contracts';
import type { aiCenter } from '../../../../packages/infrastructure/src/ai-admin';
import { identityRequest } from './client';
import { Reauthentication } from './Reauthentication';

type Center = Awaited<ReturnType<typeof aiCenter>>;
const number = (f: FormData, key: string) => Number(f.get(key));
const string = (f: FormData, key: string) => String(f.get(key) ?? '').trim();
const yes = (f: FormData, key: string) => f.get(key) === 'on';
function Field({ title, children }: { title: string; children: ReactNode }) {
  return (
    <label>
      {title}
      {children}
    </label>
  );
}
function Num({
  name,
  value,
  title,
  min = 1,
  max = 1000000,
}: {
  name: string;
  value: number;
  title: string;
  min?: number;
  max?: number;
}) {
  return (
    <Field title={title}>
      <input name={name} type="number" min={min} max={max} defaultValue={value} required />
    </Field>
  );
}
function Check({ name, value, title }: { name: string; value: boolean; title: string }) {
  return (
    <label className="checkbox-label">
      <input name={name} type="checkbox" defaultChecked={value} />
      {title}
    </label>
  );
}
function Protocol({ value, inherit = false }: { value: string; inherit?: boolean }) {
  return (
    <Field title="API 协议">
      <select name="protocol" defaultValue={value}>
        {inherit && <option value="">继承供应商</option>}
        <option value="OPENAI_CHAT_COMPLETIONS">OpenAI Chat Completions</option>
        <option value="ANTHROPIC_MESSAGES">Anthropic Messages</option>
      </select>
    </Field>
  );
}
function OutputMode({ value, name = 'outputMode' }: { value: string; name?: string }) {
  return (
    <Field title="输出模式">
      <select name={name} defaultValue={value}>
        <option value="json_schema">原生 JSON Schema</option>
        <option value="json_object">JSON 模式（OpenAI 协议）</option>
        <option value="prompt_json">提示词约定 JSON</option>
      </select>
    </Field>
  );
}

export function AICenter() {
  const [data, setData] = useState<Center | null>(null),
    [proof, setProof] = useState(''),
    [tab, setTab] = useState('providers');
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [query, setQuery] = useState('');
  const [providerId, setProviderId] = useState(''),
    [modelId, setModelId] = useState('');
  const refresh = useCallback(async () => {
    const r = await fetch(`/api/ai?q=${encodeURIComponent(query)}`, { cache: 'no-store' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    setData(d);
  }, [query]);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/ai?q=${encodeURIComponent(query)}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (r) => {
        const value = await r.json();
        if (!r.ok) throw new Error(value.error);
        setData(value);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [query]);
  async function command(body: Record<string, unknown>) {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const result = await identityRequest('/api/ai', { ...body, proof });
      setNotice(
        result.status
          ? `${result.status}${result.errorCode ? ` · ${result.errorCode}` : ''}`
          : '已保存，新版本立即生效。已有调用保留原快照。',
      );
      await refresh();
      return result;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  if (!data) return <p role="status">{error || '正在读取 AI 配置…'}</p>;
  const provider = data.providers.find((p) => p.id === providerId),
    model = data.models.find((m) => m.id === modelId);
  const pc = AIProviderConfig.parse(
    provider?.versions[0]?.config ?? {
      baseUrl: 'https://api.openai.com/v1',
      protocol: 'OPENAI_CHAT_COMPLETIONS',
    },
  );
  const mc = AIModelConfig.parse(
    model?.versions[0]?.config ?? { model: '填写实际模型 ID', outputModes: ['prompt_json'] },
  );
  return (
    <section className="identity-console">
      <h2>AI 中心</h2>
      <p>供应商、模型和模块规则分别管理。真实密钥只写入；声明能力与测试结果分别保存。</p>
      <Reauthentication onProof={setProof} />
      <nav aria-label="AI 配置分类" className="identity-tabs">
        {[
          ['providers', '供应商'],
          ['models', '模型目录'],
          ['bindings', '模块规则'],
          ['calls', '调用记录'],
        ].map(([key, label]) => (
          <button key={key} aria-pressed={tab === key} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </nav>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {tab === 'providers' && (
        <div className="identity-card-list">
          <Field title="编辑供应商">
            <select value={providerId} onChange={(e) => setProviderId(e.target.value)}>
              <option value="">新增供应商</option>
              {data.providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.archived ? '已归档' : p.enabled ? '启用' : '停用'}
                </option>
              ))}
            </select>
          </Field>
          <form
            className="identity-form"
            key={`${providerId}:${provider?.currentVersion ?? 0}`}
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget,
                f = new FormData(form);
              const result = await command({
                operation: 'provider',
                id: providerId || undefined,
                expectedVersion: provider?.currentVersion ?? 0,
                name: string(f, 'name'),
                brand: string(f, 'brand'),
                enabled: yes(f, 'enabled'),
                archived: yes(f, 'archived'),
                apiKey: string(f, 'apiKey'),
                config: {
                  baseUrl: string(f, 'baseUrl'),
                  protocol: string(f, 'protocol'),
                  timeoutMs: number(f, 'timeoutMs'),
                  concurrency: number(f, 'concurrency'),
                  requestsPerDay: number(f, 'requestsPerDay'),
                  anthropicVersion: string(f, 'anthropicVersion'),
                  anthropicAuthentication: string(f, 'anthropicAuthentication'),
                },
              });
              if (result?.id) {
                setProviderId(result.id);
                (form.elements.namedItem('apiKey') as HTMLInputElement).value = '';
              }
            }}
          >
            <Field title="显示名称">
              <input name="name" defaultValue={provider?.name} required maxLength={100} />
            </Field>
            <Field title="厂商品牌 / 自定义网关">
              <input name="brand" defaultValue={provider?.brand ?? '自定义'} required />
            </Field>
            <Field title="Base URL（包含 API 前缀，如 /v1）">
              <input name="baseUrl" type="url" defaultValue={pc.baseUrl} required />
            </Field>
            <Protocol value={pc.protocol} />
            <Field title="API Key（留空保持原值）">
              <input name="apiKey" type="password" autoComplete="new-password" />
            </Field>
            <p>
              密钥：
              {provider?.versions[0]?.key?.configured
                ? `已配置 · 尾号 ${provider.versions[0].key.suffix} · ${provider.versions[0].key.updatedAt}`
                : '未配置或已撤销'}
            </p>
            <Num
              name="timeoutMs"
              title="调用超时（毫秒）"
              value={pc.timeoutMs}
              min={1000}
              max={180000}
            />
            <Num name="concurrency" title="跨 Worker 总并发" value={pc.concurrency} max={64} />
            <Num
              name="requestsPerDay"
              title="供应商每日请求上限（含重试）"
              value={pc.requestsPerDay}
            />
            <details>
              <summary>Anthropic 协议版本</summary>
              <Field title="API 版本">
                <select name="anthropicVersion" defaultValue={pc.anthropicVersion}>
                  <option>2023-06-01</option>
                  <option>2026-10-21</option>
                </select>
              </Field>
              <Field title="认证方式">
                <select name="anthropicAuthentication" defaultValue={pc.anthropicAuthentication}>
                  <option value="X_API_KEY">x-api-key（传统兼容端点）</option>
                  <option value="BEARER">Bearer（新版本端点）</option>
                </select>
              </Field>
            </details>
            <Check name="enabled" value={provider?.enabled ?? false} title="启用供应商" />
            <Check
              name="archived"
              value={provider?.archived ?? false}
              title="归档（会阻塞引用它的任务）"
            />
            <button disabled={busy || !proof}>保存供应商版本</button>
          </form>
          {provider && (
            <details>
              <summary>版本、密钥撤销与模型引用</summary>
              <p>
                模型：
                {data.models
                  .filter((m) => m.providerId === provider.id)
                  .map((m) => m.name)
                  .join('、') || '暂无'}
              </p>
              {provider.versions.map((v) => (
                <div className="list-item" key={v.id}>
                  <span>
                    版本 {v.version} ·{' '}
                    {v.key?.configured ? `密钥尾号 ${v.key.suffix}` : '无有效密钥'}
                  </span>
                  <button
                    disabled={!proof || busy}
                    onClick={() =>
                      command({
                        operation: 'rollback',
                        kind: 'provider',
                        id: provider.id,
                        version: v.version,
                        expectedVersion: provider.currentVersion,
                      })
                    }
                  >
                    恢复此配置为新版本
                  </button>
                  {v.secretId && v.key?.configured && (
                    <button
                      disabled={!proof || busy}
                      onClick={() =>
                        command({
                          operation: 'revoke-key',
                          providerId: provider.id,
                          secretId: v.secretId,
                        })
                      }
                    >
                      立即撤销此密钥
                    </button>
                  )}
                </div>
              ))}
              <p>撤销会立即阻塞引用该凭据的历史重试；恢复配置不恢复旧密钥。</p>
            </details>
          )}
        </div>
      )}
      {tab === 'models' && (
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
                  outputModes: ['json_schema', 'json_object', 'prompt_json'].filter((k) =>
                    yes(f, k),
                  ),
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
            <button disabled={!proof || busy || !data.providers.length}>保存模型版本</button>
          </form>
          {model && (
            <>
              <ModelTests model={model} command={command} disabled={!proof || busy} />
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
                      disabled={!proof || busy}
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
      )}
      {tab === 'bindings' &&
        Object.entries(data.tasks).map(([taskKey, task]) => {
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
      {tab === 'calls' && <InvocationList />}
    </section>
  );
}
function ModelTests({
  model,
  command,
  disabled,
}: {
  model: Center['models'][number];
  command: (body: Record<string, unknown>) => Promise<unknown>;
  disabled: boolean;
}) {
  const [cost, setCost] = useState(false),
    [mode, setMode] = useState('prompt_json');
  const tests = model.versions[0].testStatus as Record<
    string,
    { status: string; at: string; errorCode?: string; providerVersion: number; outputMode: string }
  >;
  return (
    <section>
      <h3>协议测试</h3>
      <p>发送无个人信息的最小样本，可能产生费用。测试通过仅证明此项协议行为，不能证明评分正确。</p>
      <label>
        <input type="checkbox" checked={cost} onChange={(e) => setCost(e.target.checked)} />
        我确认发起可能计费的真实请求
      </label>
      <label>
        测试输出模式
        <select value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="prompt_json">提示词 JSON</option>
          <option value="json_schema">原生 JSON Schema</option>
          <option value="json_object">JSON 模式</option>
        </select>
      </label>
      {[
        ['connection', '连通'],
        ['text', '最小文本'],
        ['image', '图片输入'],
        ['structured', '结构化输出'],
      ].map(([kind, label]) => (
        <div className="list-item" key={kind}>
          <span>
            {label}：
            {tests[kind]
              ? `${tests[kind].status} · ${tests[kind].at} · ${tests[kind].errorCode ?? ''}`
              : '未测试'}
          </span>
          <button
            disabled={disabled || !cost}
            onClick={() =>
              command({
                operation: 'test',
                modelId: model.id,
                kind,
                costConfirmed: true,
                outputMode: mode,
              })
            }
          >
            测试{label}
          </button>
        </div>
      ))}
    </section>
  );
}
function InvocationList() {
  const [page, setPage] = useState(0),
    [school, setSchool] = useState(''),
    [user, setUser] = useState(''),
    [task, setTask] = useState('');
  const [data, setData] = useState<{
      items: {
        id: string;
        taskKey: string;
        schoolId: string | null;
        actorId: string;
        status: string;
        errorCode: string | null;
        inputTokens: number | null;
        outputTokens: number | null;
        durationMs: number | null;
        estimatedCost: number | null;
        costCurrency: string | null;
        billingUncertain: boolean;
        attempts: number;
        snapshot: unknown;
        callAttempts: unknown[];
      }[];
      total: number;
    }>({ items: [], total: 0 }),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void fetch(
      `/api/ai?view=invocations&page=${page}&schoolId=${encodeURIComponent(school)}&actorId=${encodeURIComponent(user)}&taskKey=${encodeURIComponent(task)}`,
    )
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        if (active) setData(d);
      })
      .catch((e) => setError(e.message));
    return () => {
      active = false;
    };
  }, [page, school, user, task]);
  return (
    <section>
      <h3>调用与用量</h3>
      <p>Token 和费用未知时保留“未知”；费用为配置单价估算。重试逐次记录，超时可能已被计费。</p>
      <div className="identity-form">
        <Field title="学校 ID">
          <input
            value={school}
            onChange={(e) => {
              setSchool(e.target.value);
              setPage(0);
            }}
          />
        </Field>
        <Field title="账号 ID">
          <input
            value={user}
            onChange={(e) => {
              setUser(e.target.value);
              setPage(0);
            }}
          />
        </Field>
        <Field title="任务">
          <select
            value={task}
            onChange={(e) => {
              setTask(e.target.value);
              setPage(0);
            }}
          >
            <option value="">全部</option>
            <option>grading.assignment</option>
            <option>grading.selftest</option>
            <option>admin.model-test</option>
          </select>
        </Field>
      </div>
      {error && <p role="alert">{error}</p>}
      {data.items.map((i) => (
        <article className="panel" key={i.id}>
          <strong>
            {i.taskKey} · {i.status}
          </strong>
          <p>
            {i.errorCode} · 请求 {i.attempts} 次 · 输入 {i.inputTokens ?? '未知'} / 输出{' '}
            {i.outputTokens ?? '未知'} Token · {i.durationMs ?? '未知'} ms · 估算费用{' '}
            {i.estimatedCost === null ? '未知' : `${i.estimatedCost.toFixed(6)} ${i.costCurrency}`}
            {i.billingUncertain && ' · 存在计费状态未知的请求'}
          </p>
          <details>
            <summary>版本快照与逐次记录</summary>
            <pre>
              {JSON.stringify(
                {
                  invocationId: i.id,
                  schoolId: i.schoolId,
                  actorId: i.actorId,
                  snapshot: i.snapshot,
                  attempts: i.callAttempts,
                },
                null,
                2,
              )}
            </pre>
          </details>
        </article>
      ))}
      <div className="identity-pagination">
        <button disabled={!page} onClick={() => setPage(page - 1)}>
          上一页
        </button>
        <span>共 {data.total} 次调用</span>
        <button disabled={(page + 1) * 30 >= data.total} onClick={() => setPage(page + 1)}>
          下一页
        </button>
      </div>
    </section>
  );
}
