'use client';
import { useEffect, useRef, useState } from 'react';
import { Empty, PageTitle } from '@tuheng/ui';
import { identityRequest, IdentityRequestError } from './client';
import { Reauthentication, type ReauthenticationHandle } from './Reauthentication';
import { RosterImportWizard } from './RosterImportWizard';
import { CredentialDelivery } from './CredentialDelivery';
import { OrganizationCreate } from './OrganizationCreate';
import { ClassRowView, PersonRow, SchoolRow } from './OrganizationRows';
import { OrganizationSelect } from './OrganizationSelect';
import { FormDrawer, FormFeedback } from './FormDrawer';
import type {
  ClassRow,
  Offering,
  OrganizationIdentity,
  Person,
  School,
} from './organization-types';

export function OrganizationConsole({
  identity,
  initial = 'students',
}: {
  identity: OrganizationIdentity;
  initial?: string;
}) {
  const auth = useRef<ReauthenticationHandle>(null);
  const importGuard = useRef<{ requestLeave: () => boolean }>(null);
  const root = identity.kind === 'SITE_ADMIN',
    teacher = identity.kind === 'TEACHER';
  const [tab, setTab] = useState(initial === 'schools' && !root ? 'students' : initial);
  const [schoolId, setSchoolId] = useState(identity.schoolId ?? ''),
    [scope, setScope] = useState<{ name: string; code: string }>();
  const [schools, setSchools] = useState<School[]>([]),
    [schoolQuery, setSchoolQuery] = useState(''),
    [schoolPage, setSchoolPage] = useState(0),
    [schoolTotal, setSchoolTotal] = useState(0);
  const [people, setPeople] = useState<Person[]>([]),
    [classes, setClasses] = useState<ClassRow[]>([]),
    [offerings, setOfferings] = useState<Offering[]>([]);
  const [query, setQuery] = useState(''),
    [page, setPage] = useState(0),
    [total, setTotal] = useState(0);
  const [filterClass, setFilterClass] = useState(''),
    [filterName, setFilterName] = useState('');
  const [message, setMessage] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [schoolLoading, setSchoolLoading] = useState(false);
  const [batchId, setBatchId] = useState(''),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!root) return;
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      setSchoolLoading(true);
      try {
        const r = await identityRequest(
          '/api/organization/schools?' +
            new URLSearchParams({ q: schoolQuery, page: String(schoolPage) }),
          undefined,
          'STAFF',
          abort.signal,
        );
        if (!abort.signal.aborted) {
          setSchools(r.items);
          setSchoolTotal(r.total);
        }
      } catch (e) {
        if (!abort.signal.aborted) setError((e as Error).message);
      } finally {
        if (!abort.signal.aborted) setSchoolLoading(false);
      }
    }, 150);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [root, schoolQuery, schoolPage, revision]);
  useEffect(() => {
    if (!schoolId) return;
    const abort = new AbortController();
    void Promise.all([
      identityRequest(
        '/api/organization/scope?schoolId=' + encodeURIComponent(schoolId),
        undefined,
        'STAFF',
        abort.signal,
      ),
      identityRequest(
        '/api/organization/offerings?schoolId=' + encodeURIComponent(schoolId),
        undefined,
        'STAFF',
        abort.signal,
      ),
    ])
      .then(([s, o]) => {
        if (!abort.signal.aborted) {
          setScope(s);
          setOfferings(o);
        }
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [schoolId, revision]);
  useEffect(() => {
    if (!schoolId || !['students', 'teachers', 'classes'].includes(tab)) return;
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      const params = new URLSearchParams({
        schoolId,
        q: query,
        page: String(page),
        ...(filterClass ? { classId: filterClass } : {}),
        ...(tab !== 'classes' ? { kind: tab === 'students' ? 'STUDENT' : 'TEACHER' } : {}),
      });
      try {
        const r = await identityRequest(
          '/api/organization/' + (tab === 'classes' ? 'classes' : 'accounts') + '?' + params,
          undefined,
          'STAFF',
          abort.signal,
        );
        if (abort.signal.aborted) return;
        if (tab === 'classes') setClasses(r.items);
        else setPeople(r.items);
        setTotal(r.total);
        setError('');
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
  }, [schoolId, tab, query, page, filterClass, revision]);
  function changeSchool(id: string) {
    if (id !== schoolId && importGuard.current && !importGuard.current.requestLeave()) return;
    setSchoolId(id);
    setScope(undefined);
    setQuery('');
    setPage(0);
    setFilterClass('');
    setFilterName('');
    setPeople([]);
    setClasses([]);
    setTotal(0);
    setOfferings([]);
    setBatchId('');
    setMessage('');
    setError('');
    setLoading(!!id);
  }
  function changeTab(next: string) {
    if (next !== tab && importGuard.current && !importGuard.current.requestLeave()) return;
    setTab(next);
    setPage(0);
    setQuery('');
    setFilterClass('');
    setFilterName('');
    setPeople([]);
    setClasses([]);
    setTotal(0);
    setError('');
    setLoading(!!schoolId && ['teachers', 'students', 'classes'].includes(next));
  }
  async function command(operation: string, data: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const sensitive = [
        'create-school',
        'rename-school',
        'reset-password',
        'update-account',
        'set-school-active',
        'update-class',
      ].includes(operation);
      const proof = sensitive ? await auth.current?.request() : undefined;
      if (sensitive && !proof) return;
      const result = await identityRequest(
        '/api/organization/' + operation,
        { ...data, schoolId, proof },
        'STAFF',
      );
      if (result.school) {
        changeSchool(result.school.id);
        setTab('delivery');
      }
      if (result.credentialBatchId) setBatchId(result.credentialBatchId);
      setMessage(
        result.credentialBatchId ? '操作已保存。请在凭据交付中领取初始凭据。' : '操作已保存。',
      );
      setRevision((v) => v + 1);
      return result;
    } catch (e) {
      if (e instanceof IdentityRequestError && e.code === 'RECENT_AUTH_REQUIRED') {
        auth.current?.invalidate();
        void auth.current?.request();
      }
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const tabs = [
    ...(root ? [['schools', '学校']] : []),
    ...(!teacher ? [['teachers', '教师']] : []),
    ['classes', '班级'],
    ['students', '学生'],
    ['imports', 'Excel 导入'],
    ['delivery', '凭据交付'],
  ];
  return (
    <FormFeedback.Provider value={{ error, clear: () => setError('') }}>
      <div className="organization-console identity-console">
        <PageTitle
          eyebrow={root ? '平台管理' : teacher ? '教学管理' : '学校管理'}
          title="学校与人员"
          description={
            teacher
              ? '管理获授权的班级与学生；历史作答与成绩独立保留。'
              : '在明确的学校范围内管理账号、班级与初始凭据。'
          }
        />
        <section className="organization-scope" aria-label="当前管理范围">
          {root ? (
            <>
              <label>
                搜索学校
                <input
                  type="search"
                  value={schoolQuery}
                  placeholder="名称或编号"
                  disabled={busy}
                  onChange={(e) => {
                    setSchoolQuery(e.target.value);
                    setSchoolPage(0);
                  }}
                />
              </label>
              <label>
                当前操作学校
                <select
                  disabled={busy}
                  value={schoolId}
                  onChange={(e) => changeSchool(e.target.value)}
                >
                  <option value="">请选择学校</option>
                  {schoolId && !schools.some((s) => s.id === schoolId) && (
                    <option value={schoolId}>{scope?.name ?? '已选择学校'}</option>
                  )}
                  {schools.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} · {s.code}
                      {s.active ? '' : '（停用）'}
                    </option>
                  ))}
                </select>
              </label>
              <div className="scope-pagination">
                <button
                  type="button"
                  aria-label="上一页学校"
                  disabled={!schoolPage || schoolLoading}
                  onClick={() => setSchoolPage((p) => p - 1)}
                >
                  ‹
                </button>
                <small>{schoolLoading ? '查询中…' : schoolTotal + ' 所学校'}</small>
                <button
                  type="button"
                  aria-label="下一页学校"
                  disabled={(schoolPage + 1) * 20 >= schoolTotal || schoolLoading}
                  onClick={() => setSchoolPage((p) => p + 1)}
                >
                  ›
                </button>
              </div>
            </>
          ) : (
            <p>
              <strong>{scope?.name ?? '本校授权范围'}</strong>
              {scope && <small> · {scope.code}</small>} ·{' '}
              {teacher ? '仅获授权的班级和学生' : '学校范围已锁定'}
            </p>
          )}
        </section>
        <nav className="identity-tabs" aria-label="人员管理分类">
          {tabs.map(([key, label]) => (
            <button
              key={key}
              type="button"
              disabled={busy}
              aria-pressed={tab === key}
              onClick={() => changeTab(key)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="management-toolbar">
          <div>
            {tab !== 'schools' && scope && <strong>{scope.name}</strong>}
            <Reauthentication ref={auth} />
          </div>
          <OrganizationCreate
            tab={tab}
            schoolId={schoolId}
            identity={identity}
            offerings={offerings}
            busy={busy}
            command={command}
          />
        </div>
        {error && (
          <p className="field-error" role="alert">
            {error}
            <button
              type="button"
              className="button secondary"
              onClick={() => setRevision((v) => v + 1)}
            >
              重新加载
            </button>
          </p>
        )}
        {message && (
          <p role="status">
            {message}
            {batchId && tab !== 'delivery' && (
              <button
                type="button"
                className="button secondary"
                onClick={() => changeTab('delivery')}
              >
                领取初始凭据
              </button>
            )}
          </p>
        )}
        {tab === 'schools' && root && (
          <>
            <div className="organization-list">
              {schools.map((s) => (
                <SchoolRow
                  key={s.id}
                  school={s}
                  busy={busy}
                  command={command}
                  choose={() => {
                    changeSchool(s.id);
                    setTab('teachers');
                  }}
                />
              ))}
            </div>
            {!schoolLoading && !schools.length && (
              <Empty
                title="没有匹配的学校"
                description="调整名称或编号搜索，或创建新的学校与管理账号。"
              />
            )}
          </>
        )}
        {tab !== 'schools' && !schoolId && (
          <Empty
            title="先选择操作学校"
            description="使用上方范围栏定位学校，再查看教师、班级、学生或导入名单。"
          />
        )}
        {schoolId && tab !== 'schools' && (
          <>
            {['teachers', 'students', 'classes'].includes(tab) && (
              <>
                <div className="management-filters">
                  <label>
                    搜索{tab === 'classes' ? '班级' : '姓名 / 登录 ID / 学号'}
                    <input
                      type="search"
                      value={query}
                      placeholder={tab === 'classes' ? '当前学校的班级名称' : '也可搜索已绑定邮箱'}
                      onChange={(e) => {
                        setQuery(e.target.value);
                        setPage(0);
                      }}
                    />
                  </label>
                  {tab === 'students' && (
                    <>
                      <FormDrawer
                        trigger={filterName ? '班级：' + filterName : '筛选班级'}
                        title="筛选班级"
                      >
                        {(saved) => (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              const select = e.currentTarget.elements.namedItem(
                                'classId',
                              ) as HTMLSelectElement;
                              setFilterClass(select.value);
                              setFilterName(select.selectedOptions[0]?.text ?? '');
                              setPage(0);
                              saved();
                            }}
                          >
                            <OrganizationSelect
                              schoolId={schoolId}
                              kind="classes"
                              label="班级"
                              name="classId"
                              required
                            />
                            <button className="button primary">应用班级筛选</button>
                          </form>
                        )}
                      </FormDrawer>
                      {filterClass && (
                        <button
                          type="button"
                          className="button secondary"
                          onClick={() => {
                            setFilterClass('');
                            setFilterName('');
                            setPage(0);
                          }}
                        >
                          清除班级筛选
                        </button>
                      )}
                    </>
                  )}
                  <span className="muted">{loading ? '正在加载…' : total + ' 条匹配记录'}</span>
                </div>
                <div className="organization-list" aria-busy={loading}>
                  {tab === 'classes'
                    ? classes.map((c) => (
                        <ClassRowView
                          key={c.id}
                          row={c}
                          schoolId={schoolId}
                          teacher={teacher}
                          busy={busy}
                          command={command}
                          members={() => {
                            changeTab('students');
                            setFilterClass(c.id);
                            setFilterName(c.name);
                          }}
                        />
                      ))
                    : people.map((p) => (
                        <PersonRow
                          key={p.id}
                          person={p}
                          schoolId={schoolId}
                          student={tab === 'students'}
                          busy={busy}
                          command={command}
                        />
                      ))}
                </div>
                {!loading && !error && total === 0 && (
                  <Empty
                    title="暂无匹配记录"
                    description="可调整搜索或班级筛选，也可从右上方新增或导入名单。"
                  />
                )}
                <div className="identity-inline organization-pagination">
                  <button
                    type="button"
                    disabled={!page || loading}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    上一页
                  </button>
                  <span>
                    {total} 条 · 第 {page + 1} 页
                  </span>
                  <button
                    type="button"
                    disabled={(page + 1) * 20 >= total || loading}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    下一页
                  </button>
                </div>
              </>
            )}
            {tab === 'imports' && (
              <RosterImportWizard
                guardRef={importGuard}
                key={schoolId}
                schoolId={schoolId}
                teacher={teacher}
                offerings={offerings}
              />
            )}
            {tab === 'delivery' && (
              <CredentialDelivery
                key={schoolId}
                schoolId={schoolId}
                batchId={batchId}
                siteAdmin={root}
              />
            )}
          </>
        )}
      </div>
    </FormFeedback.Provider>
  );
}
