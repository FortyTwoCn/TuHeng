'use client';
import { useEffect, useRef, useState } from 'react';
import { identityRequest, IdentityRequestError } from './client';
import type { SchoolCredentialCard } from '../../../../packages/infrastructure/src/credential-delivery';
import { Reauthentication, type ReauthenticationHandle } from './Reauthentication';
import { RefreshCw, Download } from 'lucide-react';
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
      {
        id: string;
        expiresAt: string;
        createdAt: string;
        expired: boolean;
        kinds: {
          kind: 'TEACHER' | 'STUDENT' | 'SCHOOL_ADMIN';
          total: number;
          available: number;
          unavailable: number;
        }[];
      }[]
    >([]),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const [card, setCard] = useState<SchoolCredentialCard>();
  const [page, setPage] = useState(0),
    [total, setTotal] = useState(0),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0);
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
    const controller = new AbortController();
    identityRequest(
      '/api/organization/deliveries?' + new URLSearchParams({ schoolId, page: String(page) }),
      undefined,
      'STAFF',
      controller.signal,
    )
      .then((r) => {
        if (!controller.signal.aborted) {
          setBatches(r.items);
          setTotal(r.total);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setMessage(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [schoolId, batchId, page, revision]);
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
      setLoading(true);
      setRevision((v) => v + 1);
    }
  }
  return (
    <section className="identity-panel delivery-console">
      <header className="org-section-heading">
        <h2>初始凭据交付</h2>
        <button
          className="button secondary"
          type="button"
          disabled={loading || busy}
          onClick={() => {
            setLoading(true);
            setRevision((v) => v + 1);
          }}
        >
          <RefreshCw size={16} aria-hidden="true" />
          刷新交付状态
        </button>
      </header>
      <p className="delivery-note">
        导出窗口 24 小时；临时密码 7
        天有效。用户改密或再次重置后，旧凭据立即失效。数量为最近查询结果，下载时会再次校验。
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
      {loading && <p role="status">正在读取交付状态…</p>}
      {!loading && !batches.length && <p>暂无凭据交付批次。</p>}
      {batches.map((b) => (
        <article key={b.id} className="delivery-batch">
          <header className="delivery-batch-heading">
            <h3>
              {new Date(b.createdAt).toLocaleString('zh-CN', {
                timeZone: 'Asia/Shanghai',
                hour12: false,
              })}{' '}
              创建
            </h3>
            <span className={'org-status' + (b.expired ? ' is-archived' : '')}>
              {b.expired ? '交付已过期' : '交付窗口开放'}
            </span>
          </header>
          <p>
            导出截止：
            {new Date(b.expiresAt).toLocaleString('zh-CN', {
              timeZone: 'Asia/Shanghai',
              hour12: false,
            })}
            （北京时间）
          </p>
          <div className="credential-kinds">
            {b.kinds
              .filter((k) => k.total > 0 && (k.kind !== 'SCHOOL_ADMIN' || siteAdmin))
              .map((k) => (
                <div key={k.kind} className="credential-kind">
                  <p>
                    <strong>
                      {k.kind === 'TEACHER' ? '教师' : k.kind === 'STUDENT' ? '学生' : '学校管理员'}
                    </strong>
                    {' · '}可交付 {k.available} · 失效 {k.unavailable}
                  </p>
                  <button
                    className="button secondary"
                    disabled={busy || !k.available || b.expired}
                    onClick={() => download(b.id, k.kind)}
                  >
                    <Download size={15} aria-hidden="true" />
                    {k.kind === 'TEACHER'
                      ? '下载教师初始凭据'
                      : k.kind === 'STUDENT'
                        ? '下载学生初始凭据'
                        : '学校管理账号交付'}
                  </button>
                </div>
              ))}
            {!b.kinds.some((k) => k.total > 0) && <p>此批次没有当前权限内可交付的账号。</p>}
          </div>
        </article>
      ))}
      <div className="choice-pagination">
        <button
          disabled={loading || !page}
          onClick={() => {
            setLoading(true);
            setPage((v) => v - 1);
          }}
        >
          上一页批次
        </button>
        <span>
          第 {page + 1} 页 · 共 {total} 批
        </span>
        <button
          disabled={loading || (page + 1) * 10 >= total}
          onClick={() => {
            setLoading(true);
            setPage((v) => v + 1);
          }}
        >
          下一页批次
        </button>
      </div>
    </section>
  );
}
