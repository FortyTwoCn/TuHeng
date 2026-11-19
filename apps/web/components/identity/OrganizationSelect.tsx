'use client';
import { useEffect, useState } from 'react';
import { identityRequest } from './client';

/** Scoped choices keep the selected ID even when a different search page is visible. */
export function OrganizationSelect({
  schoolId,
  kind,
  label,
  name,
  required = false,
  initial,
  onSelect,
  disabled = false,
  empty = '请选择',
}: {
  schoolId: string;
  kind: 'classes' | 'teachers' | 'offerings';
  initial?: { id: string; name: string };
  onSelect?: (id: string) => void;
  disabled?: boolean;
  label: string;
  name: string;
  required?: boolean;
  empty?: string;
}) {
  const [query, setQuery] = useState(''),
    [page, setPage] = useState(0),
    [total, setTotal] = useState(0);
  const [items, setItems] = useState<
    { id: string; name: string; loginId?: string; archived?: boolean }[]
  >([]);
  const [selected, setSelected] = useState<{ id: string; name: string } | undefined>(initial),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          schoolId,
          open: '1',
          q: query,
          page: String(page),
          ...(kind === 'teachers' ? { kind: 'TEACHER' } : {}),
        });
        const data = await identityRequest(
          '/api/organization/' + (kind === 'teachers' ? 'accounts' : kind) + '?' + params,
          undefined,
          'STAFF',
          abort.signal,
        );
        if (!abort.signal.aborted) {
          const choices: {
            id: string;
            name: string;
            loginId?: string;
            archived?: boolean;
            offering?: { term: string; course: { title: string } };
          }[] = data.items;
          setItems(
            choices.map((item) =>
              item.offering
                ? {
                    ...item,
                    name: [item.name, item.offering.course.title, item.offering.term].join(' · '),
                  }
                : item,
            ),
          );
          setTotal(data.total);
          setError('');
        }
      } catch (e) {
        if (!abort.signal.aborted) setError((e as Error).message);
      } finally {
        if (!abort.signal.aborted) setLoading(false);
      }
    }, 150);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [schoolId, kind, query, page]);
  return (
    <div className="organization-choice">
      <label>
        搜索{label}
        <input
          type="search"
          placeholder={'按名称查找' + label}
          disabled={disabled}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
        />
      </label>
      <label>
        {label}
        <select
          name={name}
          value={selected?.id ?? ''}
          required={required}
          disabled={disabled}
          onChange={(e) => {
            setSelected(items.find((i) => i.id === e.target.value));
            onSelect?.(e.target.value);
          }}
        >
          <option value="">{empty}</option>
          {selected && !items.some((i) => i.id === selected.id) && (
            <option value={selected.id}>{selected.name}</option>
          )}
          {items.map((item) => (
            <option key={item.id} value={item.id} disabled={item.archived}>
              {item.name}
              {item.loginId ? ' · ' + item.loginId : ''}
              {item.archived ? '（已归档）' : ''}
            </option>
          ))}
        </select>
      </label>
      <div className="choice-pagination">
        {(page > 0 || total > 20) && (
          <button
            type="button"
            disabled={disabled || !page || loading}
            onClick={() => setPage((p) => p - 1)}
          >
            上一页选项
          </button>
        )}
        <small>{loading ? '正在查询…' : total + ' 个匹配结果'}</small>
        {(page > 0 || total > 20) && (
          <button
            type="button"
            disabled={disabled || (page + 1) * 20 >= total || loading}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页选项
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}
