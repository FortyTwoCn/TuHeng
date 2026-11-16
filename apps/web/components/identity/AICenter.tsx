'use client';
import { useCallback, useEffect, useState } from 'react';
import type { Center } from './AIFields';
import { AIProviderEditor } from './AIProviderEditor';
import { AIModelEditor } from './AIModelEditor';
import { AITaskBindings } from './AITaskBindings';
import { InvocationList } from './AIInvocationList';
import { identityRequest } from './client';
import { Reauthentication } from './Reauthentication';
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
        <AIProviderEditor
          data={data}
          busy={busy}
          proof={proof}
          command={command}
          providerId={providerId}
          setProviderId={setProviderId}
        />
      )}
      {tab === 'models' && (
        <AIModelEditor
          data={data}
          busy={busy}
          proof={proof}
          command={command}
          modelId={modelId}
          setModelId={setModelId}
          query={query}
          setQuery={setQuery}
        />
      )}
      {tab === 'bindings' && (
        <AITaskBindings data={data} busy={busy} proof={proof} command={command} />
      )}
      {tab === 'calls' && <InvocationList />}
    </section>
  );
}
