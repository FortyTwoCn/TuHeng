'use client';
import { Field, Num, Check, Protocol, number, string, yes, type Center } from './AIFields';
import { AIProviderConfig } from '@tuheng/contracts';
export function AIProviderEditor({
  data,
  busy,
  proof,
  command,
  providerId,
  setProviderId,
}: {
  data: Center;
  busy: boolean;
  proof: string;
  command: (body: Record<string, unknown>) => Promise<{ id?: string } | null>;
  providerId: string;
  setProviderId: (id: string) => void;
}) {
  const provider = data.providers.find((p) => p.id === providerId);
  const pc = AIProviderConfig.parse(
    provider?.versions[0]?.config ?? {
      baseUrl: 'https://api.openai.com/v1',
      protocol: 'OPENAI_CHAT_COMPLETIONS',
    },
  );
  return (
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
        <Num name="requestsPerDay" title="供应商每日请求上限（含重试）" value={pc.requestsPerDay} />
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
                版本 {v.version} · {v.key?.configured ? `密钥尾号 ${v.key.suffix}` : '无有效密钥'}
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
  );
}
