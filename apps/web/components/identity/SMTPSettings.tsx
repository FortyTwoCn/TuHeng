'use client';
import { useEffect, useRef, useState } from 'react';
import type { SMTPConfig } from '@tuheng/contracts';
import { Reauthentication, type ReauthenticationHandle } from './Reauthentication';
import { identityRequest, IdentityRequestError } from './client';
type Version = {
  id: string;
  version: number;
  config: SMTPConfig;
  enabled: boolean;
  secretConfigured: boolean;
  secretSuffix: string;
};
export function SMTPSettings() {
  const auth = useRef<ReauthenticationHandle>(null);
  const [versions, setVersions] = useState<Version[]>([]),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [recipient, setRecipient] = useState('');
  const [draft, setDraft] = useState<SMTPConfig>({
    name: '学校邮件服务',
    host: '',
    port: 587,
    tls: 'STARTTLS',
    username: '',
    fromName: '图衡',
    fromEmail: '',
    timeoutMs: 10000,
    perMinute: 60,
  });
  useEffect(() => {
    identityRequest('/api/settings/mail')
      .then(setVersions)
      .catch((e) => setMessage(e.message));
  }, []);
  async function act(data: object) {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      const proof = await auth.current?.request();
      if (!proof) return;
      const r = await identityRequest('/api/settings/mail', { ...data, proof }, 'STAFF');
      setMessage(
        r.status === 'SUBMITTED_TO_SMTP'
          ? '已提交 SMTP，请实际检查收件箱。'
          : r.status === 'CONNECTION_VERIFIED'
            ? '连接与认证通过，尚未证明邮件已送达。'
            : '已保存配置状态。',
      );
      setVersions(await identityRequest('/api/settings/mail'));
    } catch (e) {
      if (e instanceof IdentityRequestError && e.code === 'RECENT_AUTH_REQUIRED') {
        auth.current?.invalidate();
        void auth.current?.request();
      }
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="identity-panel">
      <h2>邮件服务</h2>
      <p>保存、测试连接、发送测试邮件和启用是独立操作。密码留空会保留原值。</p>
      <Reauthentication ref={auth} />
      <form
        method="post"
        className="identity-grid-form"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void act({ action: 'SAVE', config: draft, password: f.get('password') });
        }}
      >
        {(['name', 'host', 'username', 'fromName', 'fromEmail'] as const).map((key) => (
          <label key={key}>
            {
              {
                name: '配置名称',
                host: 'SMTP 主机',
                username: '认证用户名',
                fromName: '发件名称',
                fromEmail: '发件邮箱',
              }[key]
            }
            <input
              value={draft[key]}
              required={key !== 'username'}
              type={key === 'fromEmail' ? 'email' : 'text'}
              onChange={(e) => setDraft((v) => ({ ...v, [key]: e.target.value }))}
            />
          </label>
        ))}
        <label>
          端口
          <input
            type="number"
            min={1}
            max={65535}
            value={draft.port}
            onChange={(e) => setDraft((v) => ({ ...v, port: Number(e.target.value) }))}
          />
        </label>
        <label>
          传输安全
          <select
            value={draft.tls}
            onChange={(e) => setDraft((v) => ({ ...v, tls: e.target.value as SMTPConfig['tls'] }))}
          >
            <option value="STARTTLS">STARTTLS</option>
            <option value="TLS">TLS</option>
            <option value="LOCAL_TEST">仅部署白名单中的本地测试</option>
          </select>
        </label>
        <label>
          回复邮箱（可选）
          <input
            type="email"
            value={draft.replyTo ?? ''}
            onChange={(e) => setDraft((v) => ({ ...v, replyTo: e.target.value || undefined }))}
          />
        </label>
        <label>
          连接超时（毫秒）
          <input
            type="number"
            min={1000}
            max={30000}
            value={draft.timeoutMs}
            onChange={(e) => setDraft((v) => ({ ...v, timeoutMs: Number(e.target.value) }))}
          />
        </label>
        <label>
          每分钟发送上限
          <input
            type="number"
            min={1}
            max={500}
            value={draft.perMinute}
            onChange={(e) => setDraft((v) => ({ ...v, perMinute: Number(e.target.value) }))}
          />
        </label>
        <label>
          密码 / 授权码
          <input name="password" type="password" autoComplete="new-password" />
        </label>
        <button className="button" disabled={busy}>
          保存为新版本
        </button>
      </form>
      <p role="status">{message}</p>
      <label>
        测试收件邮箱
        <input type="email" value={recipient} onChange={(e) => setRecipient(e.target.value)} />
      </label>
      <div className="identity-list">
        {versions.map((v) => (
          <article key={v.id}>
            <h3>
              {v.config.name} · v{v.version}
            </h3>
            <p>
              {v.config.host}:{v.config.port} · {v.enabled ? '启用' : '停用'} ·{' '}
              {v.secretConfigured ? '凭据已配置 · 尾号 ' + v.secretSuffix : '未配置凭据'}
            </p>
            <div className="identity-inline">
              {v.secretConfigured && (
                <button disabled={busy} onClick={() => act({ action: 'REVOKE_KEY', id: v.id })}>
                  撤销此版本凭据
                </button>
              )}
              <button onClick={() => setDraft(v.config)}>载入此版本编辑</button>
              <button disabled={busy} onClick={() => act({ action: 'VERIFY', id: v.id })}>
                测试连接
              </button>
              <button
                disabled={busy || !recipient}
                onClick={() => act({ action: 'TEST', id: v.id, recipient })}
              >
                发送测试邮件
              </button>
              <button
                disabled={busy}
                onClick={() => act({ action: v.enabled ? 'DISABLE' : 'ENABLE', id: v.id })}
              >
                {v.enabled ? '停用' : '启用'}
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
