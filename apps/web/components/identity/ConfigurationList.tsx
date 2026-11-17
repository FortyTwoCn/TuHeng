'use client';
import { useState, type ReactNode } from 'react';

export type ConfigurationItem = {
  id: string;
  title: string;
  detail: string;
  status: string;
  note?: string;
};
export function ConfigurationList({
  label,
  query,
  setQuery,
  items,
  selected,
  onSelect,
  filters,
}: {
  label: string;
  query: string;
  setQuery: (query: string) => void;
  items: ConfigurationItem[];
  selected: string | null;
  onSelect: (id: string) => void;
  filters?: ReactNode;
}) {
  const [page, setPage] = useState(0);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(items.length / 20) - 1));
  return (
    <aside className="configuration-list" aria-label={label + '列表'}>
      <label>
        {'搜索' + label}
        <input
          value={query}
          onChange={(e) => {
            setPage(0);
            setQuery(e.target.value);
          }}
          type="search"
        />
      </label>
      {filters}
      <p className="muted">{items.length} 项匹配</p>
      <div className="configuration-records">
        {items.slice(currentPage * 20, (currentPage + 1) * 20).map((item) => (
          <button
            type="button"
            key={item.id}
            data-record-id={item.id}
            aria-pressed={selected === item.id}
            onClick={() => onSelect(item.id)}
          >
            <strong>{item.title}</strong>
            <span>{item.detail}</span>
            <span className="configuration-record-status">{item.status}</span>
            {item.note && <small>{item.note}</small>}
          </button>
        ))}
        {!items.length && <p className="empty-inline">没有符合筛选的配置。</p>}
      </div>
      {items.length > 20 && (
        <div className="choice-pagination">
          <button type="button" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>
            上一页配置
          </button>
          <span>
            {currentPage + 1}/{Math.ceil(items.length / 20)}
          </span>
          <button
            type="button"
            disabled={(currentPage + 1) * 20 >= items.length}
            onClick={() => setPage(currentPage + 1)}
          >
            下一页配置
          </button>
        </div>
      )}
    </aside>
  );
}
