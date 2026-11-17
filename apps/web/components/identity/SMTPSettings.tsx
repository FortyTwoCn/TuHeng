'use client';
import { useEffect, useRef, useState } from 'react';
import { SMTPConfig } from '@tuheng/contracts';
import { Reauthentication, type ReauthenticationHandle } from './Reauthentication';
import { identityRequest, IdentityRequestError } from './client';
import { SecretInput } from './SecretInput';
import { useDraftNavigation } from './useDraftNavigation';

type Version = {
  id: string;
  version: number;
  config: SMTPConfig;
  enabled: boolean;
  secretConfigured: boolean;
  secretSuffix: string;
  secretUpdatedAt: string | null;
};
const empty: SMTPConfig = {
  name: '学校邮件服务',
  host: '',
  port: 587,
  tls: 'STARTTLS',
  username: '',
  fromName: '图衡',
  fromEmail: '',
  timeoutMs: 10000,
  perMinute: 60,
};
type Result = { id?: string; version?: number; status?: string };

export function SMTPSettings() {
  const auth = useRef<ReauthenticationHandle>(null),
    pending = useRef(false);
  const [versions, setVersions] = useState<Version[]>([]),
    [editing, setEditing] = useState<Version | null>(null),
    [baseline, setBaseline] = useState(0),
    [formKey, setFormKey] = useState(0),
    [testId, setTestId] = useState(''),
    [recipient, setRecipient] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [stale, setStale] = useState(false),
    [evidence, setEvidence] = useState<Record<string, string>>({});
  const savedId = useRef<string | null>(null),
    guard = useDraftNavigation(busy);
  const active = versions.find((v) => v.enabled),
    testing = versions.find((v) => v.id === testId);
  function select(v: Version | null, rows: Version[]) {
    setEditing(v);
    setBaseline(rows[0]?.version ?? 0);
    setFormKey((k) => k + 1);
    if (v) setTestId(v.id);
  }
  useEffect(() => {
    const controller = new AbortController();
    identityRequest('/api/settings/mail', undefined, 'STAFF', controller.signal)
      .then((rows: Version[]) => {
        setVersions(rows);
        select(rows.find((v) => v.enabled) ?? rows[0] ?? null, rows);
        setLoading(false);
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setMessage(e.message);
          setStale(true);
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, []);
  async function refresh() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      const rows: Version[] = await identityRequest('/api/settings/mail');
      setVersions(rows);
      setStale(false);
      setMessage('已重新读取版本，请核对后操作。');
      const chosen =
        rows.find((v) => v.id === (savedId.current ?? editing?.id)) ??
        rows.find((v) => v.enabled) ??
        rows[0] ??
        null;
      select(chosen, rows);
      savedId.current = null;
      guard.saved();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function act(data: Record<string, unknown>): Promise<Result | null> {
    if (pending.current || stale) return null;
    pending.current = true;
    setBusy(true);
    setMessage('');
    try {
      const proof = await auth.current?.request();
      if (!proof) {
        guard.keep();
        return null;
      }
      const result: Result = await identityRequest(
        '/api/settings/mail',
        { ...data, proof },
        'STAFF',
      );
      const status =
        result.status === 'SUBMITTED_TO_SMTP'
          ? '已提交 SMTP，请实际检查收件箱。'
          : result.status === 'CONNECTION_VERIFIED'
            ? '连接与认证通过，尚未证明邮件已送达。'
            : data.action === 'SAVE'
              ? '已保存新版本，尚未启用。'
              : '已更新生效状态。';
      setMessage(status);
      if (data.action === 'VERIFY' || data.action === 'TEST') {
        setEvidence((v) => ({
          ...v,
          [String(data.id)]: new Date().toLocaleString('zh-CN') + ' · ' + status,
        }));
      } else {
        savedId.current = result.id ?? editing?.id ?? null;
        try {
          const rows: Version[] = await identityRequest('/api/settings/mail');
          setVersions(rows);
          if (data.action === 'SAVE') {
            select(rows.find((v) => v.id === result.id) ?? null, rows);
            guard.saved();
          }
          savedId.current = null;
        } catch {
          setStale(true);
          setMessage('操作已保存，但读取最新配置失败。请刷新配置后继续，勿重复操作。');
          if (data.action === 'SAVE') guard.saved();
        }
      }
      return result;
    } catch (e) {
      if (e instanceof IdentityRequestError && e.code === 'RECENT_AUTH_REQUIRED') {
        auth.current?.invalidate();
        void auth.current?.request();
      }
      const text = (e as Error).message;
      setMessage(text);
      if (data.action === 'VERIFY' || data.action === 'TEST')
        setEvidence((v) => ({ ...v, [String(data.id)]: '本次测试未成功：' + text }));
      guard.keep();
      return null;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  function toggle() {
    if (!testing) return;
    const action = testing.enabled ? 'DISABLE' : 'ENABLE';
    if (
      !window.confirm(
        (testing.enabled ? '停用' : '启用') +
          ' v' +
          testing.version +
          ' 将影响后续验证码和账号通知。已排队邮件按服务端既有版本策略发送。确认继续？',
      )
    )
      return;
    void act({ action, id: testing.id, expectedActiveId: active?.id ?? null });
  }
  const draft = editing?.config ?? empty;
  return (
    <section
      className="identity-console configuration-center mail-settings"
      onChangeCapture={guard.changed}
    >
      <div className="configuration-toolbar">
        <div>
          <h2>邮件服务</h2>
          <p className="muted">
            当前生效：{active ? active.config.name + ' · v' + active.version : '未配置生效版本'}
          </p>
        </div>
        <Reauthentication ref={auth} />
      </div>
      <div role="status" className={message ? 'configuration-alert' : ''}>
        {message}
      </div>
      <div className="identity-inline">
        <button
          type="button"
          disabled={busy || loading}
          onClick={() => guard.navigate(() => select(null, versions))}
        >
          新建邮件配置
        </button>
        <button type="button" disabled={busy} onClick={() => guard.navigate(() => void refresh())}>
          刷新邮件配置
        </button>
      </div>
      {loading ? (
        <p role="status">读取配置中…</p>
      ) : (
        <div className="configuration-detail">
          <label>
            正在编辑版本
            <select
              aria-label="正在编辑版本"
              disabled={busy || stale}
              value={editing?.id ?? ''}
              onChange={(e) => {
                const next = e.target.value;
                guard.navigate(() => select(versions.find((v) => v.id === next) ?? null, versions));
              }}
            >
              <option value="">新配置</option>
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.config.name} · v{v.version}
                  {v.enabled ? '（当前生效）' : ''}
                </option>
              ))}
            </select>
          </label>
          <p className="muted">
            显示最近 30 个版本及当前生效版本。编辑或保存不会自动启用；旧版本内容保持不变。
          </p>
          <form
            key={formKey}
            data-config-form
            className="identity-form"
            method="post"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget,
                f = new FormData(form);
              const parsed = SMTPConfig.safeParse({
                name: f.get('name'),
                host: f.get('host'),
                port: Number(f.get('port')),
                tls: f.get('tls'),
                username: f.get('username'),
                fromName: f.get('fromName'),
                fromEmail: f.get('fromEmail'),
                replyTo: f.get('replyTo') || undefined,
                timeoutMs: Number(f.get('timeoutMs')),
                perMinute: Number(f.get('perMinute')),
              });
              if (!parsed.success) {
                setMessage(
                  '请核对字段格式与范围：' +
                    parsed.error.issues.map((i) => i.path.join('.')).join('、'),
                );
                guard.keep();
                return;
              }
              const result = await act({
                action: 'SAVE',
                config: parsed.data,
                password: f.get('password'),
                sourceId: editing?.id ?? null,
                expectedVersion: baseline,
              });
              if (result) (form.elements.namedItem('password') as HTMLInputElement).value = '';
            }}
          >
            <fieldset disabled={busy || stale} className="configuration-form-body">
              <fieldset>
                <legend>基本信息</legend>
                <label>
                  配置名称
                  <input name="name" defaultValue={draft.name} required maxLength={100} />
                </label>
              </fieldset>
              <fieldset>
                <legend>SMTP 连接</legend>
                <div className="configuration-fields">
                  <label>
                    SMTP 主机
                    <input name="host" defaultValue={draft.host} required />
                  </label>
                  <label>
                    端口
                    <input
                      name="port"
                      type="number"
                      min={1}
                      max={65535}
                      defaultValue={draft.port}
                      required
                    />
                  </label>
                  <label>
                    传输安全
                    <select name="tls" defaultValue={draft.tls}>
                      <option value="STARTTLS">STARTTLS</option>
                      <option value="TLS">TLS</option>
                      <option value="LOCAL_TEST">仅部署白名单中的本地测试</option>
                    </select>
                  </label>
                  <label>
                    连接超时（毫秒）
                    <input
                      name="timeoutMs"
                      type="number"
                      min={1000}
                      max={30000}
                      defaultValue={draft.timeoutMs}
                      required
                    />
                  </label>
                </div>
              </fieldset>
              <fieldset>
                <legend>身份认证</legend>
                <div className="configuration-fields">
                  <label>
                    认证用户名
                    <input name="username" defaultValue={draft.username} autoComplete="off" />
                  </label>
                  <SecretInput
                    name="password"
                    label="密码 / 授权码"
                    autoComplete="new-password"
                    hint={
                      editing?.secretConfigured
                        ? '此版本凭据已配置，留空保留。更新时间：' +
                          (editing.secretUpdatedAt
                            ? new Date(editing.secretUpdatedAt).toLocaleString('zh-CN')
                            : '未知')
                        : '尚未配置凭据；使用 SMTP 认证时请输入新授权码。'
                    }
                  />
                </div>
              </fieldset>
              <fieldset>
                <legend>发信身份与限制</legend>
                <div className="configuration-fields">
                  <label>
                    发件名称
                    <input name="fromName" defaultValue={draft.fromName} required />
                  </label>
                  <label>
                    发件邮箱
                    <input name="fromEmail" type="email" defaultValue={draft.fromEmail} required />
                  </label>
                  <label>
                    回复邮箱（可选）
                    <input name="replyTo" type="email" defaultValue={draft.replyTo ?? ''} />
                  </label>
                  <label>
                    每分钟发送上限
                    <input
                      name="perMinute"
                      type="number"
                      min={1}
                      max={500}
                      defaultValue={draft.perMinute}
                      required
                    />
                  </label>
                </div>
              </fieldset>
              <div className="configuration-save">
                <button className="button primary" type="submit" disabled={busy || stale}>
                  保存为新版本
                </button>
                <span className="muted">
                  {guard.dirty ? '有未保存的修改' : '保存与启用是独立操作'}
                </span>
              </div>
            </fieldset>
          </form>
          <section className="mail-version-actions" aria-label="已保存版本测试与启用">
            <h3>测试与启用</h3>
            <label>
              测试与生效操作版本
              <select
                aria-label="测试与生效操作版本"
                value={testId}
                disabled={busy || stale}
                onChange={(e) => setTestId(e.target.value)}
              >
                {!testing && <option value="">请选择已保存版本</option>}
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.config.name} · v{v.version}
                    {v.enabled ? '（当前生效）' : ''}
                  </option>
                ))}
              </select>
            </label>
            {testing && (
              <p>
                {testing.config.host}:{testing.config.port} ·{' '}
                {testing.enabled ? '已启用（连接状态需测试）' : '已保存，未启用'}
              </p>
            )}
            {guard.dirty && (
              <p className="configuration-alert">
                有未保存修改。下面的操作仅针对明确选择的已保存版本，不代表当前草稿通过测试。
              </p>
            )}
            {testing && evidence[testing.id] && (
              <p role="status">
                v{testing.version} · {evidence[testing.id]}
              </p>
            )}
            <div className="identity-inline">
              <button
                type="button"
                disabled={busy || stale || !testing}
                onClick={() => void act({ action: 'VERIFY', id: testId })}
              >
                测试连接
              </button>
              <button type="button" disabled={busy || stale || !testing} onClick={toggle}>
                {testing?.enabled ? '停用此版本' : '启用此版本'}
              </button>
              {testing?.secretConfigured && (
                <button
                  type="button"
                  disabled={busy || stale}
                  onClick={() => {
                    if (
                      window.confirm(
                        '撤销 v' +
                          testing.version +
                          ' 的凭据会影响所有复用此凭据的邮件版本，并停用此版本。确认继续？',
                      )
                    )
                      void act({ action: 'REVOKE_KEY', id: testId });
                  }}
                >
                  撤销此版本凭据
                </button>
              )}
            </div>
            <form
              className="identity-inline"
              onSubmit={(e) => {
                e.preventDefault();
                void act({ action: 'TEST', id: testId, recipient });
              }}
            >
              <label>
                测试收件邮箱
                <input
                  type="email"
                  required
                  value={recipient}
                  disabled={busy || stale}
                  onChange={(e) => setRecipient(e.target.value)}
                />
              </label>
              <button disabled={busy || stale || !testing || !recipient}>发送测试邮件</button>
            </form>
            <p className="muted">
              发送一次测试邮件可能产生邮件服务费用。SMTP
              接受不等于到达收件箱；状态未知时请先核查，再决定是否重发。
            </p>
          </section>
        </div>
      )}
      {guard.dialog}
    </section>
  );
}
