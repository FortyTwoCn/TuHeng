'use client';
import { useEffect, useId, useState } from 'react';
import { Search, ChevronDown } from 'lucide-react';
type School = { id: string; name: string; code: string };

export function SchoolCombobox({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(''),
    [page, setPage] = useState(0);
  const [options, setOptions] = useState<School[]>([]),
    [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [active, setActive] = useState(0);
  const [recent, setRecent] = useState<School>();
  useEffect(() => {
    void Promise.resolve().then(() => {
      try {
        const saved = JSON.parse(localStorage.getItem('tuheng-recent-school') ?? 'null');
        if (saved && ['id', 'name', 'code'].every((key) => typeof saved[key] === 'string'))
          setRecent(saved);
      } catch {
        /* Optional non-sensitive preference. */
      }
    });
  }, []);
  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      setBusy(true);
      setError('');
      try {
        const response = await fetch(`/api/schools?q=${encodeURIComponent(query)}&page=${page}`, {
          signal: abort.signal,
        });
        if (!response.ok) throw new Error('学校列表暂时不可用，请重试。');
        const data = await response.json();
        if (abort.signal.aborted) return;
        setOptions((old) => (page === 0 ? data.schools : [...old, ...data.schools]));
        setMore(data.hasMore);
      } catch (e) {
        if (!abort.signal.aborted) setError((e as Error).message);
      } finally {
        if (!abort.signal.aborted) setBusy(false);
      }
    }, 150);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [open, query, page]);
  function choose(school: School) {
    onChange(school.id);
    setQuery(school.name);
    setOpen(false);
    setPage(0);
    setRecent(school);
    try {
      localStorage.setItem('tuheng-recent-school', JSON.stringify(school));
    } catch {
      /* Optional preference. */
    }
  }
  return (
    <div
      className="school-combobox"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <label htmlFor={id}>学校</label>
      <div className="school-search">
        <Search size={17} aria-hidden="true" />
        <input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={id + '-options'}
          aria-autocomplete="list"
          aria-activedescendant={open && options[active] ? id + '-' + active : undefined}
          autoComplete="off"
          placeholder="搜索并选择学校"
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            onChange('');
            setOptions([]);
            setMore(false);
            setBusy(true);
            setPage(0);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              setOpen(true);
              setActive((a) =>
                Math.max(0, Math.min(options.length - 1, a + (e.key === 'ArrowDown' ? 1 : -1))),
              );
            }
            if (e.key === 'Enter' && open && options[active]) {
              e.preventDefault();
              choose(options[active]);
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              setOpen(false);
            }
          }}
        />
        <button
          type="button"
          className="icon-button"
          aria-label="展开学校列表"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <ChevronDown size={17} />
        </button>
      </div>
      {open && (
        <div className="school-options">
          <div role="listbox" id={id + '-options'} aria-label="学校搜索结果">
            {recent && !query && (
              <button
                type="button"
                role="option"
                aria-selected={value === recent.id}
                onClick={() => choose(recent)}
              >
                上次选择：{recent.name}
              </button>
            )}
            {options.map((school, index) => (
              <button
                type="button"
                role="option"
                id={id + '-' + index}
                key={school.id}
                aria-selected={value === school.id}
                className={index === active ? 'highlighted' : ''}
                onClick={() => choose(school)}
              >
                {school.name}
                <small>{school.code}</small>
              </button>
            ))}
          </div>
          {busy && <p role="status">正在搜索学校…</p>}
          {!busy && !error && !options.length && (
            <p role="status">未找到可用学校，请检查名称或联系学校管理员。</p>
          )}
          {error && <p role="alert">{error}</p>}
          {more && (
            <button type="button" disabled={busy} onClick={() => setPage((p) => p + 1)}>
              加载更多学校
            </button>
          )}
          {error && (
            <button
              type="button"
              onClick={() => {
                setPage(0);
                setOpen(false);
                requestAnimationFrame(() => setOpen(true));
              }}
            >
              重试搜索
            </button>
          )}
        </div>
      )}
    </div>
  );
}
