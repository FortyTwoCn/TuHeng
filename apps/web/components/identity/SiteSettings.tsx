'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SiteSettings as SettingsSchema, type SiteSettings as Settings } from '@tuheng/contracts';
import { identityRequest } from './client';
import { useDraftNavigation } from './useDraftNavigation';

export function SiteSettings() {
  const router = useRouter();
  const [current, setCurrent] = useState<Settings>();
  const [filingNumber, setFilingNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [revision, setRevision] = useState(0);
  const draft = useDraftNavigation(busy);

  useEffect(() => {
    const abort = new AbortController();
    void identityRequest('/api/settings/site', undefined, 'STAFF', abort.signal)
      .then((data) => {
        if (abort.signal.aborted) return;
        const settings = SettingsSchema.parse(data);
        setCurrent(settings);
        setFilingNumber(settings.filingNumber);
        setError('');
      })
      .catch((e: Error) => {
        if (!abort.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [revision]);

  return (
    <section
      className="panel site-settings"
      aria-labelledby="site-settings-title"
      onInput={draft.changed}
    >
      <h2 id="site-settings-title">网站信息</h2>
      <p className="muted">备案号显示在登录、教学和管理等所有页面底部。留空并保存可隐藏。</p>
      <form
        data-config-form
        onSubmit={async (event) => {
          event.preventDefault();
          if (!current || busy || loading) return;
          setBusy(true);
          setError('');
          setMessage('');
          try {
            const settings = SettingsSchema.parse(
              await identityRequest(
                '/api/settings/site',
                {
                  filingNumber,
                  expectedVersion: current.version,
                },
                'STAFF',
              ),
            );
            setCurrent(settings);
            setFilingNumber(settings.filingNumber);
            draft.saved();
            setMessage('网站信息已保存，页面底部已更新。');
            router.refresh();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label htmlFor="site-filing-number">备案号</label>
        <input
          id="site-filing-number"
          name="filingNumber"
          value={filingNumber}
          maxLength={120}
          disabled={busy || loading || !current}
          autoComplete="off"
          placeholder="填写实际备案号"
          aria-describedby="site-filing-help"
          onChange={(event) => {
            setFilingNumber(event.target.value);
            setMessage('');
          }}
        />
        <p id="site-filing-help" className="muted small">
          按备案信息填写完整编号，最多 120 个字符。
        </p>
        {loading && <p role="status">正在读取网站信息…</p>}
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        {message && <p role="status">{message}</p>}
        <div className="identity-inline">
          <button className="button primary" disabled={busy || loading || !current}>
            {busy ? '正在保存…' : '保存网站信息'}
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={busy || loading}
            onClick={() =>
              draft.navigate(() => {
                setLoading(true);
                setMessage('');
                setRevision((value) => value + 1);
              })
            }
          >
            重新读取
          </button>
        </div>
      </form>
      {draft.dialog}
    </section>
  );
}
