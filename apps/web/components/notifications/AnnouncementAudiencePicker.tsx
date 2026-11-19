'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnnouncementAudience } from '@tuheng/contracts';
import { identityRequest } from '../identity/client';
import { SchoolCombobox } from '../identity/SchoolCombobox';

type Person = { id: string; name: string; kind: 'STUDENT' | 'TEACHER'; schoolName: string };
type Class = { id: string; name: string; context: string };
type Page<T> = { items: T[]; nextCursor: string | null };
const changeMembership = (ids: string[], id: string, include: boolean) =>
  include ? [...new Set([...ids, id])] : ids.filter((existing) => existing !== id);

export const emptyAnnouncementAudience = (
  scope: AnnouncementAudience['scope'],
): AnnouncementAudience => ({
  scope,
  allStudents: false,
  allTeachers: false,
  studentClassIds: [],
  teacherClassIds: [],
  personIds: [],
  excludeIds: [],
});

export function AnnouncementAudiencePicker({
  value,
  onChange,
  actorKind,
  scopeName,
}: {
  value: AnnouncementAudience;
  onChange: (next: AnnouncementAudience) => void;
  actorKind: 'SITE_ADMIN' | 'SCHOOL_ADMIN' | 'TEACHER';
  scopeName?: string;
}) {
  const [view, setView] = useState<'people' | 'classes'>('people');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('');
  const [cls, setClass] = useState<Class>();
  const [list, setList] = useState<Page<Person | Class>>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const scope = value.scope.kind;
  const schoolId = value.scope.kind === 'SCHOOL' ? value.scope.schoolId : '';
  const load = useCallback(
    async (after?: string) => {
      controller.current?.abort();
      if (scope === 'SCHOOL' && !schoolId) return;
      const abort = new AbortController();
      controller.current = abort;
      setBusy(true);
      setError('');
      const params = new URLSearchParams({ scope, schoolId, view, q: query });
      if (after) params.set('after', after);
      if (view === 'people' && kind) params.set('kind', kind);
      if (view === 'people' && cls) params.set('classId', cls.id);
      try {
        const page: Page<Person | Class> = await identityRequest(
          '/api/announcements?' + params,
          undefined,
          'STAFF',
          abort.signal,
        );
        if (!abort.signal.aborted)
          setList((old) =>
            after && old ? { ...page, items: [...old.items, ...page.items] } : page,
          );
      } catch (error) {
        if (!abort.signal.aborted) setError((error as Error).message);
      } finally {
        if (!abort.signal.aborted) setBusy(false);
      }
    },
    [scope, schoolId, cls, kind, query, view],
  );
  useEffect(() => {
    const start = setTimeout(() => void load(), 0);
    return () => {
      clearTimeout(start);
      controller.current?.abort();
    };
  }, [load]);

  function changeScope(next: AnnouncementAudience['scope']) {
    setList(undefined);
    setSearch('');
    setQuery('');
    setClass(undefined);
    setError('');
    onChange(emptyAnnouncementAudience(next));
  }
  const bulkScope =
    scope === 'PLATFORM' ? '全平台' : actorKind === 'TEACHER' ? '授权班级' : '所选学校';
  return (
    <section className="announcement-picker" aria-label="公告接收人">
      {actorKind === 'SITE_ADMIN' && (
        <>
          <label>
            发布范围
            <select
              value={scope}
              onChange={(e) =>
                changeScope(
                  e.target.value === 'PLATFORM'
                    ? { kind: 'PLATFORM' }
                    : { kind: 'SCHOOL', schoolId: '' },
                )
              }
            >
              <option value="SCHOOL">指定学校</option>
              <option value="PLATFORM">全平台</option>
            </select>
          </label>
          {scope === 'SCHOOL' && (
            <SchoolCombobox
              value={schoolId}
              onChange={(id) => {
                if (id !== schoolId) changeScope({ kind: 'SCHOOL', schoolId: id });
              }}
            />
          )}
          {scope === 'SCHOOL' && schoolId && scopeName && (
            <p className="muted">当前学校：{scopeName}</p>
          )}
        </>
      )}
      {(scope === 'PLATFORM' || schoolId) && (
        <>
          <div className="announcement-bulk">
            <label className="check">
              <input
                type="checkbox"
                checked={value.allStudents}
                onChange={(e) => onChange({ ...value, allStudents: e.target.checked })}
              />
              {bulkScope}全部学生
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={value.allTeachers}
                onChange={(e) => onChange({ ...value, allTeachers: e.target.checked })}
              />
              {bulkScope}全部教师
            </label>
          </div>
          <div className="notification-filter-tabs">
            {(['people', 'classes'] as const).map((tab) => (
              <button
                type="button"
                key={tab}
                className={'button ' + (view === tab ? 'secondary' : 'ghost')}
                aria-pressed={view === tab}
                onClick={() => {
                  setView(tab);
                  setList(undefined);
                  setSearch('');
                  setQuery('');
                }}
              >
                {tab === 'people' ? '选择人员' : '按班级选择'}
              </button>
            ))}
          </div>
          {view === 'people' && cls && (
            <div className="button-row">
              <strong>{cls.name}</strong>
              <button
                type="button"
                className="button ghost"
                onClick={() => {
                  setList(undefined);
                  setClass(undefined);
                }}
              >
                清除班级筛选
              </button>
            </div>
          )}
          <div className="announcement-search">
            <label>
              搜索{view === 'people' ? '人员' : '班级'}
              <input
                type="search"
                maxLength={100}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    setQuery(search);
                  }
                }}
              />
            </label>
            {view === 'people' && (
              <label>
                身份
                <select
                  value={kind}
                  onChange={(e) => {
                    setList(undefined);
                    setKind(e.target.value);
                  }}
                >
                  <option value="">学生和教师</option>
                  <option value="STUDENT">学生</option>
                  <option value="TEACHER">教师</option>
                </select>
              </label>
            )}
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                if (query !== search) setList(undefined);
                setQuery(search);
              }}
            >
              查询
            </button>
          </div>
          <p className="muted small">
            已单独选择 {value.personIds.length} 人 · 排除 {value.excludeIds.length} 人 · 学生班级{' '}
            {value.studentClassIds.length} · 教师班级 {value.teacherClassIds.length}
          </p>
          {error && (
            <p role="alert" className="field-error">
              {error}{' '}
              <button type="button" className="button secondary" onClick={() => void load()}>
                重试
              </button>
            </p>
          )}
          {busy && !list && <p role="status">正在查找接收人…</p>}
          {list && (
            <ul className="announcement-directory">
              {list.items.map((entry) => (
                <li key={entry.id}>
                  <div>
                    <strong>{entry.name}</strong>
                    <small>
                      {'context' in entry
                        ? entry.context
                        : `${entry.schoolName} · ${entry.kind === 'TEACHER' ? '教师' : '学生'}`}
                    </small>
                  </div>
                  <div className="announcement-row-options">
                    {'context' in entry ? (
                      <>
                        <label className="check">
                          <input
                            type="checkbox"
                            checked={value.studentClassIds.includes(entry.id)}
                            onChange={(e) =>
                              onChange({
                                ...value,
                                studentClassIds: changeMembership(
                                  value.studentClassIds,
                                  entry.id,
                                  e.target.checked,
                                ),
                              })
                            }
                          />
                          班级学生
                        </label>
                        <label className="check">
                          <input
                            type="checkbox"
                            checked={value.teacherClassIds.includes(entry.id)}
                            onChange={(e) =>
                              onChange({
                                ...value,
                                teacherClassIds: changeMembership(
                                  value.teacherClassIds,
                                  entry.id,
                                  e.target.checked,
                                ),
                              })
                            }
                          />
                          授课教师
                        </label>
                        <button
                          type="button"
                          className="button ghost"
                          onClick={() => {
                            setList(undefined);
                            setClass(entry);
                            setView('people');
                            setSearch('');
                            setQuery('');
                          }}
                        >
                          查看成员
                        </button>
                      </>
                    ) : (
                      <label>
                        接收设置
                        <select
                          aria-label={`${entry.name}的接收设置`}
                          value={
                            value.excludeIds.includes(entry.id)
                              ? 'exclude'
                              : value.personIds.includes(entry.id)
                                ? 'include'
                                : ''
                          }
                          onChange={(e) =>
                            onChange({
                              ...value,
                              personIds: changeMembership(
                                value.personIds,
                                entry.id,
                                e.target.value === 'include',
                              ),
                              excludeIds: changeMembership(
                                value.excludeIds,
                                entry.id,
                                e.target.value === 'exclude',
                              ),
                            })
                          }
                        >
                          <option value="">按现有范围</option>
                          <option value="include">加入接收人</option>
                          <option value="exclude">排除</option>
                        </select>
                      </label>
                    )}
                  </div>
                </li>
              ))}
              {!list.items.length && (
                <li className="muted">未找到符合条件的{view === 'people' ? '人员' : '班级'}。</li>
              )}
            </ul>
          )}
          {list?.nextCursor && !busy && (
            <button
              type="button"
              className="button secondary"
              onClick={() => void load(list.nextCursor!)}
            >
              加载更多
            </button>
          )}
        </>
      )}
    </section>
  );
}
