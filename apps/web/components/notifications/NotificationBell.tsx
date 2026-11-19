'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import type { AuthRealm, NotificationPage } from '@tuheng/contracts';
import { Dialog } from '../identity/Dialog';
import { NotificationList } from './NotificationList';
import { loadNotifications, markRead, notificationChange } from './notification-client';

export function NotificationBell({ realm, href }: { realm: AuthRealm; href: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<NotificationPage>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    request.current?.abort();
    const abort = new AbortController();
    request.current = abort;
    try {
      const result = await loadNotifications(
        realm,
        new URLSearchParams({ mode: 'recent' }),
        abort.signal,
      );
      if (!abort.signal.aborted) {
        setData(result);
        setError('');
      }
    } catch {
      if (!abort.signal.aborted) setError('通知暂时无法加载。');
    }
  }, [realm]);
  useEffect(() => {
    const stayCurrent = () => {
      if (!document.hidden) void refresh();
    };
    const changed = (event: Event) => {
      if ((event as CustomEvent<AuthRealm>).detail === realm) stayCurrent();
    };
    stayCurrent();
    window.addEventListener('focus', stayCurrent);
    document.addEventListener('visibilitychange', stayCurrent);
    window.addEventListener(notificationChange, changed);
    const timer = setInterval(stayCurrent, 45_000);
    return () => {
      request.current?.abort();
      clearInterval(timer);
      window.removeEventListener('focus', stayCurrent);
      document.removeEventListener('visibilitychange', stayCurrent);
      window.removeEventListener(notificationChange, changed);
    };
  }, [realm, refresh]);
  const count = data?.unreadCount ?? 0;
  return (
    <>
      <button
        type="button"
        className="topbar-control notification-bell"
        aria-label={`通知${count ? `，${count} 条未读` : ''}`}
        aria-haspopup="dialog"
        onClick={() => {
          setOpen(true);
          void refresh();
        }}
      >
        <Bell size={21} aria-hidden="true" />
        {count > 0 && (
          <span className="notification-count" aria-hidden="true">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>
      <Dialog
        open={open}
        title="最近通知"
        className="notification-dialog"
        onClose={() => setOpen(false)}
      >
        <div className="notification-scroll">
          {error && (
            <p role="alert" className="field-error">
              {error}{' '}
              <button type="button" className="button secondary" onClick={() => void refresh()}>
                重试
              </button>
            </p>
          )}
          {!data && !error && (
            <p role="status" className="muted">
              正在加载通知…
            </p>
          )}
          {data && (
            <>
              <p className="notification-dialog-status">
                {count ? `${count} 条未读通知` : '当前没有未读通知'}
              </p>
              {data.items.length > 0 ? (
                <NotificationList
                  items={data.items}
                  busy={busy}
                  mark={(id) => {
                    setBusy(true);
                    void markRead(realm, { ids: [id] })
                      .catch(() => setError('标记已读失败，请重试。'))
                      .finally(() => setBusy(false));
                  }}
                />
              ) : (
                <p className="muted">有新的教学动态时，会出现在这里。</p>
              )}
            </>
          )}
        </div>
        <Link
          className="button primary notification-view-all"
          href={href}
          onClick={() => setOpen(false)}
        >
          查看全部通知
        </Link>
      </Dialog>
    </>
  );
}
