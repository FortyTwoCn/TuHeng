'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PageTitle } from '@tuheng/ui';
import { AIModelConfig, AIProviderConfig } from '@tuheng/contracts';
import type { Center } from './AIFields';
import { AIProviderEditor } from './AIProviderEditor';
import { AIModelEditor } from './AIModelEditor';
import { AITaskBindings } from './AITaskBindings';
import { InvocationList } from './AIInvocationList';
import { ConfigurationList, type ConfigurationItem } from './ConfigurationList';
import { useDraftNavigation } from './useDraftNavigation';
import { identityRequest, IdentityRequestError, identityMessage } from './client';
import { Reauthentication, type ReauthenticationHandle } from './Reauthentication';

const tabs = [
  ['providers', '供应商'],
  ['models', '模型目录'],
  ['bindings', '模块规则'],
  ['calls', '调用记录'],
] as const;
const stateName = (row: { enabled: boolean; archived: boolean }) =>
  row.archived ? '已归档' : row.enabled ? '启用' : '停用';
export function AICenter({
  initialTab = 'providers',
  initialRunId = '',
  initialTaskKey = '',
  returnTo,
}: {
  initialTab?: string;
  initialRunId?: string;
  initialTaskKey?: string;
  returnTo?: string;
}) {
  const auth = useRef<ReauthenticationHandle>(null),
    listScroll = useRef(0);
  const [data, setData] = useState<Center | null>(null),
    [tab, setTab] = useState<string>(
      tabs.some(([key]) => key === initialTab) ? initialTab : 'providers',
    );
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [stale, setStale] = useState(false);
  const [providerId, setProviderId] = useState<string | null>(null),
    [modelId, setModelId] = useState<string | null>(null),
    [taskKey, setTaskKey] = useState(
      initialTaskKey === 'grading.selftest' ? initialTaskKey : 'grading.assignment',
    ),
    [detail, setDetail] = useState(
      initialTab === 'bindings' &&
        ['grading.assignment', 'grading.selftest'].includes(initialTaskKey),
    ),
    [draftKey, setDraftKey] = useState(0);
  const [providerQuery, setProviderQuery] = useState(''),
    [modelQuery, setModelQuery] = useState(''),
    [taskQuery, setTaskQuery] = useState(''),
    [filterProvider, setFilterProvider] = useState(''),
    [filterState, setFilterState] = useState(''),
    [filterProtocol, setFilterProtocol] = useState(''),
    [filterImages, setFilterImages] = useState(false);
  const draft = useDraftNavigation(busy);
  const refresh = useCallback(async () => {
    const r = await fetch('/api/ai', { cache: 'no-store' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    setData(d);
    setStale(false);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/ai', { cache: 'no-store', signal: controller.signal })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        setData(d);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, []);
  async function command(body: Record<string, unknown>) {
    if (busy || stale) return null;
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const proof = await auth.current?.request();
      if (!proof) {
        draft.keep();
        return null;
      }
      const result = await identityRequest('/api/ai', { ...body, proof });
      setNotice(
        result.status
          ? `${result.status}${result.errorCode ? ' · ' + result.errorCode : ''}`
          : '已保存，新版本立即生效。已有调用保留原快照。',
      );
      await refresh().catch(() => {
        setStale(true);
        setError('操作已保存，但读取最新配置失败。请刷新配置后继续，勿重复保存。');
      });
      return result;
    } catch (e) {
      draft.keep();
      if (e instanceof IdentityRequestError && e.code === 'RECENT_AUTH_REQUIRED') {
        auth.current?.invalidate();
        void auth.current?.request();
      }
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  function open(action: () => void) {
    draft.navigate(() => {
      listScroll.current = window.scrollY;
      action();
      setDetail(true);
      setError('');
      setNotice('');
      setDraftKey((k) => k + 1);
    });
  }
  function back() {
    draft.navigate(() => {
      setDetail(false);
      setDraftKey((k) => k + 1);
      requestAnimationFrame(() => window.scrollTo({ top: listScroll.current }));
    });
  }
  if (!data)
    return (
      <p role="status">
        {error || '正在读取 AI 配置…'}
        {error && (
          <button onClick={() => void refresh().catch((e) => setError(e.message))}>重试</button>
        )}
      </p>
    );
  const providers = data.providers
    .map((p) => {
      const config = AIProviderConfig.parse(p.versions[0].config);
      return {
        id: p.id,
        title: p.name,
        detail: p.brand + ' · ' + new URL(config.baseUrl).host,
        status:
          stateName(p) + ' · ' + (p.versions[0].key?.configured ? '密钥已配置' : '无有效密钥'),
        note:
          config.protocol +
          ' · ' +
          data.models.filter((m) => m.providerId === p.id).length +
          ' 个模型',
      };
    })
    .filter((p) => (p.title + p.detail).toLowerCase().includes(providerQuery.toLowerCase()));
  const models: ConfigurationItem[] = data.models.flatMap((m) => {
    const c = AIModelConfig.parse(m.versions[0].config),
      provider = data.providers.find((p) => p.id === m.providerId);
    const protocol =
      c.protocol ?? (provider && AIProviderConfig.parse(provider.versions[0].config).protocol);
    if (
      !(m.name + ' ' + c.model).toLowerCase().includes(modelQuery.toLowerCase()) ||
      (filterProvider && m.providerId !== filterProvider) ||
      (filterState && stateName(m) !== filterState) ||
      (filterProtocol && protocol !== filterProtocol) ||
      (filterImages && !c.images)
    )
      return [];
    const references = Object.keys(data.tasks).filter(
      (k) => data.bindings.find((b) => b.taskKey === k)?.modelId === m.id,
    ).length;
    return [
      {
        id: m.id,
        title: m.name,
        detail: c.model + ' · ' + (provider?.name ?? '供应商不存在'),
        status: stateName(m) + ' · ' + (c.images ? '声明图像输入' : '文本输入'),
        note: protocol + ' · ' + references + ' 个模块引用 · v' + m.currentVersion,
      },
    ];
  });
  const tasks = Object.entries(data.tasks)
    .map(([id, task]) => {
      const binding = data.bindings.find((b) => b.taskKey === id);
      return {
        id,
        title: task.name,
        detail: id,
        status: binding
          ? binding.enabled
            ? data.diagnostics[id]?.errorCode
              ? '待处理：' + identityMessage(data.diagnostics[id].errorCode!)
              : '配置校验通过'
            : '规则停用'
          : '未配置',
        note: data.models.find((m) => m.id === binding?.modelId)?.name ?? '尚未选择模型',
      };
    })
    .filter((t) => (t.title + t.id).includes(taskQuery));
  return (
    <section className="identity-console configuration-center">
      <PageTitle
        eyebrow="平台管理"
        title="AI 中心"
        description="管理供应商、模型与模块调用规则；查看每次请求的实际结果。"
      />
      {returnTo && (
        <a className="button secondary" href={returnTo}>
          返回任务列表
        </a>
      )}
      <nav aria-label="AI 配置分类" className="identity-tabs">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            aria-pressed={tab === key}
            disabled={busy}
            onClick={() =>
              draft.navigate(() => {
                setTab(key);
                const url = new URL(window.location.href);
                url.searchParams.set('tab', key);
                window.history.replaceState(null, '', url);
                setDetail(false);
                setError('');
                setNotice('');
                setDraftKey((k) => k + 1);
              })
            }
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="configuration-toolbar">
        <Reauthentication ref={auth} />
        {tab === 'providers' && (
          <button
            className="button primary"
            disabled={busy}
            onClick={() => open(() => setProviderId(''))}
          >
            新增供应商
          </button>
        )}
        {tab === 'models' && (
          <button
            className="button primary"
            disabled={busy}
            onClick={() => open(() => setModelId(''))}
          >
            手动添加模型
          </button>
        )}
        {draft.dirty && <span role="status">有未保存的修改</span>}
      </div>
      {error && (
        <p role="alert" className="configuration-alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {stale && (
        <button onClick={() => void refresh().catch((e) => setError(e.message))}>刷新配置</button>
      )}
      {stale ? (
        <p>已保存的配置正在等待重新读取。</p>
      ) : tab === 'calls' ? (
        <InvocationList initialRunId={initialRunId} />
      ) : (
        <div className="configuration-workspace" data-detail={detail}>
          {tab === 'providers' && (
            <ConfigurationList
              label="供应商"
              query={providerQuery}
              setQuery={setProviderQuery}
              items={providers}
              selected={providerId}
              onSelect={(id) => open(() => setProviderId(id))}
            />
          )}
          {tab === 'models' && (
            <ConfigurationList
              label="模型"
              query={modelQuery}
              setQuery={setModelQuery}
              items={models}
              selected={modelId}
              onSelect={(id) => open(() => setModelId(id))}
              filters={
                <details>
                  <summary>筛选模型</summary>
                  <label>
                    供应商筛选
                    <select
                      value={filterProvider}
                      onChange={(e) => setFilterProvider(e.target.value)}
                    >
                      <option value="">全部供应商</option>
                      {data.providers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    状态筛选
                    <select value={filterState} onChange={(e) => setFilterState(e.target.value)}>
                      <option value="">全部状态</option>
                      {['启用', '停用', '已归档'].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    协议筛选
                    <select
                      value={filterProtocol}
                      onChange={(e) => setFilterProtocol(e.target.value)}
                    >
                      <option value="">全部协议</option>
                      <option>OPENAI_CHAT_COMPLETIONS</option>
                      <option>ANTHROPIC_MESSAGES</option>
                    </select>
                  </label>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={filterImages}
                      onChange={(e) => setFilterImages(e.target.checked)}
                    />
                    声明支持图像
                  </label>
                </details>
              }
            />
          )}
          {tab === 'bindings' && (
            <ConfigurationList
              label="模块"
              query={taskQuery}
              setQuery={setTaskQuery}
              items={tasks}
              selected={taskKey}
              onSelect={(id) => open(() => setTaskKey(id))}
            />
          )}
          <div className="configuration-detail" onChangeCapture={draft.changed}>
            <button type="button" className="button secondary configuration-back" onClick={back}>
              返回列表
            </button>
            {tab === 'providers' &&
              (providerId === null ? (
                <p>选择供应商查看配置，或新增供应商。</p>
              ) : (
                <AIProviderEditor
                  key={
                    providerId +
                    ':' +
                    (data.providers.find((p) => p.id === providerId)?.currentVersion ?? 0) +
                    ':' +
                    draftKey
                  }
                  data={data}
                  busy={busy}
                  dirty={draft.dirty}
                  command={command}
                  providerId={providerId}
                  setProviderId={(id) => draft.saved(() => setProviderId(id))}
                />
              ))}
            {tab === 'models' &&
              (modelId === null ? (
                <p>选择模型查看声明能力、版本和测试证据。</p>
              ) : (
                <AIModelEditor
                  key={
                    modelId +
                    ':' +
                    (data.models.find((m) => m.id === modelId)?.currentVersion ?? 0) +
                    ':' +
                    draftKey
                  }
                  data={data}
                  busy={busy}
                  dirty={draft.dirty}
                  command={command}
                  modelId={modelId}
                  setModelId={(id) => draft.saved(() => setModelId(id))}
                />
              ))}
            {tab === 'bindings' && (
              <AITaskBindings
                key={taskKey + ':' + draftKey}
                data={data}
                busy={busy}
                dirty={draft.dirty}
                command={command}
                taskKey={taskKey}
                saved={() => draft.saved()}
              />
            )}
          </div>
        </div>
      )}
      {draft.dialog}
    </section>
  );
}
