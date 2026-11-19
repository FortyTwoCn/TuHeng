import Link from 'next/link';
import type { Actor } from '@tuheng/domain';
import { PageTitle } from '@tuheng/ui';
import { Search, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  searchSchools,
  pageSize,
} from '../../../../packages/infrastructure/src/organization-queries';
import {
  OrganizationPanel,
  OrganizationEmpty,
  SchoolChoice,
} from '../../components/organization/OrganizationPresentation';

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
    <form className="org-search" action={path} role="search">
      {Object.entries(search)
        .filter(([k, v]) => v && !['q', 'page'].includes(k))
        .map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
      <label className="org-search-field">
        <Search size={18} aria-hidden="true" />
        <input
          aria-label={label}
          type="search"
          name="q"
          defaultValue={search.q}
          placeholder={placeholder ?? label}
        />
      </label>
      <button className="button secondary">查询</button>
      {search.q && (
        <Link
          className="org-clear-filter"
          href={href(path, { ...search, q: undefined, page: undefined })}
        >
          清除筛选
        </Link>
      )}
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
    <nav className="org-pagination" aria-label="翻页">
      <span>共 {total} 条记录</span>
      <div>
        {page > 0 ? (
          <Link href={href(path, { ...search, page: String(page - 1) })}>
            <ChevronLeft size={16} aria-hidden="true" />
            上一页
          </Link>
        ) : (
          <span aria-disabled="true">
            <ChevronLeft size={16} aria-hidden="true" />
            上一页
          </span>
        )}
        <span aria-current="page" className="org-page-number">
          {page + 1}
        </span>
        {(page + 1) * pageSize < total ? (
          <Link href={href(path, { ...search, page: String(page + 1) })}>
            下一页
            <ChevronRight size={16} aria-hidden="true" />
          </Link>
        ) : (
          <span aria-disabled="true">
            下一页
            <ChevronRight size={16} aria-hidden="true" />
          </span>
        )}
      </div>
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
      <PageTitle title={title} description="请选择本次操作的学校，进入对应的管理页面。" />
      <OrganizationPanel title="选择学校" count={list.total}>
        <SearchForm path={path} search={{ choose: '1', q: search.q }} label="学校名称或编号" />
        {list.items.length > 0 ? (
          <div className="org-school-grid">
            {list.items.map((s) => (
              <SchoolChoice
                key={s.id}
                school={s}
                href={href(path, { schoolId: s.id })}
                action={'进入' + title}
              />
            ))}
          </div>
        ) : (
          <OrganizationEmpty>没有找到匹配的学校。</OrganizationEmpty>
        )}
        <Pagination path={path} search={{ choose: '1', q: search.q }} {...list} />
      </OrganizationPanel>
    </>
  );
}
