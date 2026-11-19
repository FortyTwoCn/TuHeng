'use client';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { notificationCategoryLabels, type NotificationItem } from '@tuheng/contracts';

const time = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Shanghai',
});
export function NotificationList({
  items,
  busy,
  mark,
  selection,
  onSelect,
}: {
  items: NotificationItem[];
  busy: boolean;
  mark: (id: string) => void;
  selection?: Set<string>;
  onSelect?: (id: string, checked: boolean) => void;
}) {
  return (
    <ul className="notification-list">
      {items.map((item) => (
        <li key={item.id} className={item.readAt ? '' : 'notification-unread'}>
          {onSelect && (
            <input
              className="notification-select"
              type="checkbox"
              checked={selection?.has(item.id) ?? false}
              aria-label={'选择通知：' + item.title}
              disabled={busy || !!item.readAt}
              onChange={(e) => onSelect(item.id, e.target.checked)}
            />
          )}
          <div className="notification-copy">
            <div className="notification-meta">
              <span>{notificationCategoryLabels[item.category]}</span>
              <time dateTime={item.createdAt}>{time.format(new Date(item.createdAt))}</time>
              {!item.readAt && <span className="unread-label">未读</span>}
            </div>
            <strong>{item.title}</strong>
            <p>{item.summary}</p>
            <div className="notification-actions">
              {item.href && (
                <Link className="button ghost" href={item.href}>
                  查看详情 <ArrowUpRight size={14} aria-hidden="true" />
                </Link>
              )}
              {!item.readAt && (
                <button
                  type="button"
                  className="button ghost"
                  disabled={busy}
                  onClick={() => mark(item.id)}
                >
                  标记已读
                </button>
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
