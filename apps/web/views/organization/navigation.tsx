import Link from 'next/link';
import type { Actor } from '@tuheng/domain';
import { PageTitle, Panel } from '@tuheng/ui';
import {
  searchSchools,
  pageSize,
} from '../../../../packages/infrastructure/src/organization-queries';

export type Params = Record<string, string | undefined>;
export function href(path: string, search: Params = {}) {
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(search)) if (v) query.set(k, v);
  return path + (query.size ? '?' + query : '');
}
export function SearchForm({
  path,
  search,
  label = '搜索',
  placeholder,
}: {
  path: string;
  search: Params;
  label?: string;
  placeholder?: string;
}) {
  return (
    <form className="filters" action={path}>
      {Object.entries(search)
        .filter(([k, v]) => v && !['q', 'page'].includes(k))
        .map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
      <label>
        {label}
        <input type="search" name="q" defaultValue={search.q} placeholder={placeholder} />
      </label>
      <button className="button secondary">查询</button>
    </form>
  );
}
export function Pagination({
  path,
  search,
  total,
  page,
}: {
  path: string;
  search: Params;
  total: number;
  page: number;
}) {
  return (
    <nav className="row-actions" aria-label="翻页">
      {page > 0 && <Link href={href(path, { ...search, page: String(page - 1) })}>上一页</Link>}
      <span>
        {total} 条 · 第 {page + 1} 页
      </span>
      {(page + 1) * pageSize < total && (
        <Link href={href(path, { ...search, page: String(page + 1) })}>下一页</Link>
      )}
    </nav>
  );
}
export async function ChooseSchool({
  a,
  path,
  search,
  title,
}: {
  a: Actor;
  path: string;
  search: Params;
  title: string;
}) {
  const list = await searchSchools(a, search);
  return (
    <>
      <PageTitle title={title} description="选择本次管理的学校。" />
      <Panel title="选择学校">
        <SearchForm path={path} search={{ choose: '1', q: search.q }} label="学校名称或编号" />
        {list.items.map((s) => (
          <p key={s.id}>
            {s.active ? (
              <Link href={href(path, { schoolId: s.id })}>
                {s.name} · {s.code}
              </Link>
            ) : (
              s.name + '（已停用）'
            )}
          </p>
        ))}
        <Pagination path={path} search={{ choose: '1', q: search.q }} {...list} />
      </Panel>
    </>
  );
}
