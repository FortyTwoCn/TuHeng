'use client';
import { useEffect, useRef, useState } from 'react';
import { identityRequest, IdentityRequestError } from './client';
import type { SchoolCredentialCard } from '../../../../packages/infrastructure/src/credential-delivery';
import { Reauthentication, type ReauthenticationHandle } from './Reauthentication';
export function CredentialDelivery({
  schoolId,
  batchId,
  siteAdmin = false,
}: {
  schoolId: string;
  batchId?: string;
  siteAdmin?: boolean;
}) {
  const auth = useRef<ReauthenticationHandle>(null);
  const [batches, setBatches] = useState<
      { id: string; expiresAt: string; createdAt: string; _count: { items: number } }[]
    >([]),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const [card, setCard] = useState<SchoolCredentialCard>();
  useEffect(() => {
    if (!card) return;
    const timer = setTimeout(() => setCard(undefined), 120000);
    const hide = () => {
      if (document.hidden) setCard(undefined);
    };
    document.addEventListener('visibilitychange', hide);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', hide);
    };
  }, [card]);
  useEffect(() => {
    if (schoolId)
      identityRequest('/api/organization/deliveries?schoolId=' + encodeURIComponent(schoolId))
        .then(setBatches)
        .catch((e) => setMessage(e.message));
  }, [schoolId, batchId]);
  async function download(id: string, kind: 'TEACHER' | 'STUDENT' | 'SCHOOL_ADMIN') {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      const proof = await auth.current?.request();
      if (!proof) return;
      const ticket = await identityRequest(
        '/api/credentials',
        { operation: 'prepare', batchId: id, kind, proof },
        'STAFF',
      );
      if (kind === 'SCHOOL_ADMIN') {
        setCard(
          await identityRequest(
            '/api/credentials',
            { token: ticket.token, format: 'card' },
            'STAFF',
          ),
        );
        return;
      }
      const response = await fetch('/api/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tuheng-realm': 'STAFF' },
        body: JSON.stringify({ token: ticket.token }),
      });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(
          body.error === 'NO_AVAILABLE_INITIAL_CREDENTIALS'
            ? '本类账号没有仍可交付的初始凭据（可能已改密、过期或未创建）。'
            : body.error,
        );
      }
      const url = URL.createObjectURL(await response.blob()),
        a = document.createElement('a');
      a.href = url;
      a.download = kind === 'STUDENT' ? '学生初始凭据.xlsx' : '教师初始凭据.xlsx';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage('已下载。文件含敏感初始凭据，请安全交付；服务端过期无法撤回本地副本。');
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
      <h2>初始凭据交付</h2>
      <p>
        导出窗口 24 小时；临时密码 7
        天有效。用户改密或再次重置后，旧凭据立即失效。普通名单不包含密码。
      </p>
      <Reauthentication ref={auth} />
      <p role="status">{message}</p>
      {card && (
        <section className="identity-panel" aria-label="学校管理账号一次性交付卡">
          <h3>{card.school} · 管理账号交付</h3>
          <p>{card.name} · 首次必须改密并绑定邮箱。</p>
          <label>
            登录 ID
            <input value={card.loginId} readOnly />
          </label>
          <label>
            临时密码
            <input value={card.password} readOnly autoComplete="off" />
          </label>
          <p>
            密码到期：{new Date(card.expiresAt).toLocaleString()}
            。本卡两分钟后或离开页面时隐藏，请安全交付。
          </p>
          <button onClick={() => setCard(undefined)}>关闭并清除卡片</button>
        </section>
      )}
      {!batches.length && <p>暂无凭据交付批次。</p>}
      {batches.map((b) => (
        <article key={b.id} className="identity-panel">
          <p>
            {new Date(b.createdAt).toLocaleString()} · {b._count.items} 个账号
          </p>
          <p>导出截止：{new Date(b.expiresAt).toLocaleString()}</p>
          <div className="identity-inline">
            <button
              disabled={busy || new Date(b.expiresAt) <= new Date()}
              onClick={() => download(b.id, 'TEACHER')}
            >
              下载教师初始凭据
            </button>
            <button
              disabled={busy || new Date(b.expiresAt) <= new Date()}
              onClick={() => download(b.id, 'STUDENT')}
            >
              下载学生初始凭据
            </button>
            {siteAdmin && (
              <button disabled={busy} onClick={() => download(b.id, 'SCHOOL_ADMIN')}>
                学校管理账号交付
              </button>
            )}
          </div>
        </article>
      ))}
    </section>
  );
}
