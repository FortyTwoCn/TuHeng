'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BellRing } from 'lucide-react';
import {
  NotificationCategory,
  notificationCategoryLabels,
  type AuthRealm,
  type NotificationPage,
} from '@tuheng/contracts';
import { NotificationList } from './NotificationList';
import { loadNotifications, markRead } from './notification-client';

export function NotificationCenter({ realm }: { realm: AuthRealm }) {
  const [data, setData] = useState<NotificationPage>();
  const [unread, setUnread] = useState(false);
  const [category, setCategory] = useState('');
  const [selection, setSelection] = useState(new Set<string>());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);

  const load = useCallback(
    async (before?: string) => {
      request.current?.abort();
      const abort = new AbortController();
      request.current = abort;
      const query = new URLSearchParams();
      if (unread) query.set('unread', '1');
      if (category) query.set('category', category);
      if (before) query.set('before', before);
      setLoading(true);
      setError('');
      try {
        const page = await loadNotifications(realm, query, abort.signal);
        if (!abort.signal.aborted)
          setData((old) =>
            before && old ? { ...page, items: [...old.items, ...page.items] } : page,
          );
      } catch {
        if (!abort.signal.aborted) setError('通知加载失败，请重试。');
      } finally {
        if (!abort.signal.aborted) setLoading(false);
      }
    },
    [realm, unread, category],
  );

  useEffect(() => {
    const start = setTimeout(() => void load(), 0);
    const focus = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener('visibilitychange', focus);
    window.addEventListener('focus', focus);
    return () => {
      request.current?.abort();
      clearTimeout(start);
      document.removeEventListener('visibilitychange', focus);
      window.removeEventListener('focus', focus);
    };
  }, [load]);

  async function mark(scope: { ids: string[] } | { through: string }) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await markRead(realm, scope);
      setSelection(new Set());
      await load();
    } catch {
      setError('标记已读失败，请重试。');
    } finally {
      setBusy(false);
    }
  }
  function resetView() {
    setData(undefined);
    setLoading(true);
    setSelection(new Set());
  }
  return (
    <section className="panel notification-center" aria-label="通知记录">
      <div className="notification-toolbar">
        <div className="notification-filter-tabs" aria-label="阅读状态">
          {[false, true].map((value) => (
            <button
              type="button"
              key={String(value)}
              className={'button ' + (value === unread ? 'secondary' : 'ghost')}
              aria-pressed={value === unread}
              onClick={() => {
                if (unread !== value) {
                  setUnread(value);
                  resetView();
                }
              }}
            >
              {value ? `未读${data ? `（${data.unreadCount}）` : ''}` : '全部'}
            </button>
          ))}
        </div>
        <label className="notification-category">
          通知分类
          <select
            aria-label="通知分类"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              resetView();
            }}
          >
            <option value="">全部分类</option>
            {NotificationCategory.options.map((key) => (
              <option key={key} value={key}>
                {notificationCategoryLabels[key]}
              </option>
            ))}
          </select>
        </label>
        <div className="button-row">
          {selection.size > 0 && (
            <button
              type="button"
              className="button secondary"
              disabled={busy || selection.size > 100}
              onClick={() => void mark({ ids: [...selection] })}
            >
              所选标为已读（{selection.size}）
            </button>
          )}
          <button
            type="button"
            className="button secondary"
            disabled={busy || !data?.unreadCount}
            onClick={() => {
              if (data) void mark({ through: data.readThrough });
            }}
          >
            全部标为已读
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="field-error">
          {error}{' '}
          <button className="button secondary" onClick={() => void load()}>
            重试
          </button>
        </p>
      )}
      {loading && !data && (
        <p role="status" className="muted">
          正在加载通知…
        </p>
      )}
      {data?.items.length ? (
        <NotificationList
          items={data.items}
          busy={busy}
          selection={selection}
          mark={(id) => void mark({ ids: [id] })}
          onSelect={(id, checked) =>
            setSelection((old) => {
              const next = new Set(old);
              if (checked && next.size < 100) next.add(id);
              if (!checked) next.delete(id);
              return next;
            })
          }
        />
      ) : (
        !loading &&
        !error && (
          <div className="account-empty">
            <BellRing size={26} aria-hidden="true" />
            <strong>暂无{unread ? '未读' : ''}通知</strong>
          </div>
        )
      )}
      {data?.nextCursor && (
        <button
          type="button"
          className="button secondary notification-more"
          disabled={loading}
          onClick={() => void load(data.nextCursor!)}
        >
          {loading ? '正在加载…' : '加载更早的通知'}
        </button>
      )}
    </section>
  );
}
