'use client';
import { useEffect, useState, useCallback } from 'react';
import type { AccountKind } from '@tuheng/contracts';
import { identityRequest } from './client';
import { Reauthentication } from './Reauthentication';
import { RosterImportWizard } from './RosterImportWizard';
import { CredentialDelivery } from './CredentialDelivery';
type Person = {
  id: string;
  name: string;
  loginId?: string;
  studentNumber?: string;
  active?: boolean;
  mustChangePassword?: boolean;
  emailVerifiedAt?: string;
  kind?: string;
  enrollments?: { classId: string; teachingClass: { name: string } }[];
};
type ClassRow = {
  id: string;
  name: string;
  archived: boolean;
  offering: { term: string; course: { title: string } };
  grants: { user: Person }[];
  _count: { enrollments: number };
};
type School = {
  id: string;
  name: string;
  code: string;
  active: boolean;
  _count: { users: number };
};
type Offering = { id: string; term: string; course: { title: string } };
export function OrganizationConsole({
  identity,
  initial = 'students',
}: {
  identity: { id: string; kind: AccountKind; schoolId?: string | null };
  initial?: string;
}) {
  const root = identity.kind === 'SITE_ADMIN',
    teacher = identity.kind === 'TEACHER';
  const [tab, setTab] = useState(initial === 'schools' && !root ? 'students' : initial),
    [schoolId, setSchoolId] = useState(identity.schoolId ?? ''),
    [schools, setSchools] = useState<School[]>([]),
    [schoolQuery, setSchoolQuery] = useState(''),
    [schoolPage, setSchoolPage] = useState(0),
    [schoolTotal, setSchoolTotal] = useState(0);
  const [people, setPeople] = useState<Person[]>([]),
    [classes, setClasses] = useState<ClassRow[]>([]),
    [teachers, setTeachers] = useState<Person[]>([]),
    [offerings, setOfferings] = useState<Offering[]>([]);
  const [query, setQuery] = useState(''),
    [page, setPage] = useState(0),
    [total, setTotal] = useState(0),
    [proof, setProof] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [batchId, setBatchId] = useState(''),
    [filterClass, setFilterClass] = useState('');
  const [classChoiceQuery, setClassChoiceQuery] = useState(''),
    [classChoicePage, setClassChoicePage] = useState(0),
    [classChoiceTotal, setClassChoiceTotal] = useState(0);
  const [teacherChoiceQuery, setTeacherChoiceQuery] = useState(''),
    [teacherChoicePage, setTeacherChoicePage] = useState(0),
    [teacherChoiceTotal, setTeacherChoiceTotal] = useState(0);
  const loadSchools = useCallback(async () => {
    if (!root) return;
    const r = await identityRequest(
      '/api/organization/schools?' +
        new URLSearchParams({ q: schoolQuery, page: String(schoolPage) }),
    );
    setSchools(r.items);
    setSchoolTotal(r.total);
  }, [root, schoolQuery, schoolPage]);
  const load = useCallback(async () => {
    if (!schoolId) return;
    const params = new URLSearchParams({
      schoolId,
      q: query,
      page: String(page),
      ...(filterClass ? { classId: filterClass } : {}),
    });
    if (['students', 'teachers'].includes(tab)) {
      const r = await identityRequest(
        '/api/organization/accounts?' +
          params +
          '&kind=' +
          (tab === 'students' ? 'STUDENT' : 'TEACHER'),
      );
      setPeople(r.items);
      setTotal(r.total);
    }
    if (tab === 'classes') {
      const r = await identityRequest('/api/organization/classes?' + params);
      setClasses(r.items);
      setTotal(r.total);
    }
    const [o, t, c] = await Promise.all([
      identityRequest('/api/organization/offerings?schoolId=' + schoolId),
      identityRequest(
        '/api/organization/accounts?schoolId=' +
          schoolId +
          '&kind=TEACHER&q=' +
          encodeURIComponent(teacherChoiceQuery) +
          '&page=' +
          teacherChoicePage,
      ),
      identityRequest(
        '/api/organization/classes?schoolId=' +
          schoolId +
          '&q=' +
          encodeURIComponent(classChoiceQuery) +
          '&page=' +
          classChoicePage,
      ),
    ]);
    setOfferings(o);
    setTeachers(t.items);
    setTeacherChoiceTotal(t.total);
    setClassChoiceTotal(c.total);
    if (tab !== 'classes') setClasses(c.items);
  }, [
    schoolId,
    query,
    page,
    tab,
    filterClass,
    classChoiceQuery,
    classChoicePage,
    teacherChoiceQuery,
    teacherChoicePage,
  ]);
  useEffect(() => {
    const timer = setTimeout(() => {
      loadSchools().catch((e) => setMessage(e.message));
    }, 150);
    return () => clearTimeout(timer);
  }, [loadSchools]);
  useEffect(() => {
    const timer = setTimeout(() => {
      load().catch((e) => setMessage(e.message));
    }, 150);
    return () => clearTimeout(timer);
  }, [load]);
  async function command(operation: string, data: Record<string, unknown>) {
    setBusy(true);
    setMessage('');
    try {
      const result = await identityRequest(
        '/api/organization/' + operation,
        { ...data, schoolId, proof },
        'STAFF',
      );
      setMessage('操作已保存。');
      if (result.credentialBatchId) setBatchId(result.credentialBatchId);
      if (result.school) {
        setSchoolId(result.school.id);
        setTab('delivery');
      }
      await loadSchools();
      await load();
      return result;
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function formData(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    return Object.fromEntries(new FormData(event.currentTarget));
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
    <div className="organization-console">
      <h1>学校与人员</h1>
      <div className="identity-tabs">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            aria-pressed={tab === key}
            onClick={() => {
              setTab(key);
              setPage(0);
              setQuery('');
              setFilterClass('');
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {root && (
        <section className="identity-panel">
          <label>
            搜索学校
            <input
              value={schoolQuery}
              onChange={(e) => {
                setSchoolQuery(e.target.value);
                setSchoolPage(0);
              }}
            />
          </label>
          <label>
            当前操作学校
            <select
              value={schoolId}
              onChange={(e) => {
                setSchoolId(e.target.value);
                setPage(0);
              }}
            >
              <option value="">请明确选择学校</option>
              {schoolId && !schools.some((s) => s.id === schoolId) && (
                <option value={schoolId}>已选择学校</option>
              )}
              {schools.map((s) => (
                <option value={s.id} key={s.id}>
                  {s.name} · {s.code}
                  {s.active ? '' : '（停用）'}
                </option>
              ))}
            </select>
          </label>
          <div className="identity-inline">
            <button disabled={!schoolPage} onClick={() => setSchoolPage((v) => v - 1)}>
              上一页学校
            </button>
            <span>{schoolTotal} 所学校</span>
            <button
              disabled={(schoolPage + 1) * 20 >= schoolTotal}
              onClick={() => setSchoolPage((v) => v + 1)}
            >
              下一页学校
            </button>
          </div>
        </section>
      )}
      <details>
        <summary>敏感操作验证（重置、停用、交接）</summary>
        <Reauthentication onProof={setProof} />
      </details>
      <p role="status">{message}</p>
      {tab === 'schools' && root && (
        <>
          <details className="identity-panel">
            <summary>新增学校和管理账号</summary>
            <form onSubmit={(e) => command('create-school', formData(e))}>
              <label>
                学校名称
                <input name="name" required />
              </label>
              <label>
                学校管理员姓名
                <input name="administratorName" required />
              </label>
              <button className="button" disabled={busy || !proof}>
                创建学校并生成独立凭据
              </button>
            </form>
          </details>
          <div className="identity-list">
            {schools.map((s) => (
              <article key={s.id}>
                <h2>{s.name}</h2>
                <details>
                  <summary>编辑学校名称</summary>
                  <form onSubmit={(e) => command('rename-school', { ...formData(e), id: s.id })}>
                    <label>
                      学校名称
                      <input name="name" defaultValue={s.name} required maxLength={100} />
                    </label>
                    <button disabled={!proof || busy}>保存名称</button>
                  </form>
                </details>
                <p>
                  {s.code} · {s._count.users} 个账号 · {s.active ? '启用' : '停用'}
                </p>
                <div className="identity-inline">
                  <button
                    onClick={() => {
                      setSchoolId(s.id);
                      setTab('teachers');
                    }}
                  >
                    管理该学校
                  </button>
                  <button
                    disabled={!proof || busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          `此操作影响该校 ${s._count.users} 个账号及后台任务；保留数据。确认继续？`,
                        )
                      )
                        void command('set-school-active', { id: s.id, active: !s.active });
                    }}
                  >
                    {s.active ? '停用学校' : '启用学校'}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
      {tab !== 'schools' && !schoolId && <p>请选择操作学校。</p>}
      {schoolId && tab !== 'schools' && (
        <>
          {['teachers', 'students', 'classes'].includes(tab) && (
            <>
              <label>
                搜索{tab === 'classes' ? '班级' : '姓名 / 登录 ID / 学号'}
                <input
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPage(0);
                  }}
                />
              </label>
              {tab === 'students' && (
                <label>
                  按班级筛选
                  <select
                    value={filterClass}
                    onChange={(e) => {
                      setFilterClass(e.target.value);
                      setPage(0);
                    }}
                  >
                    <option value="">所有授权班级 / 范围</option>
                    {classes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </>
          )}
          {tab === 'teachers' && (
            <details className="identity-panel">
              <summary>新增教师</summary>
              <form onSubmit={(e) => command('create-teacher', formData(e))}>
                <label>
                  教师姓名
                  <input name="name" required />
                </label>
                <button className="button" disabled={busy}>
                  创建并生成初始凭据
                </button>
              </form>
            </details>
          )}
          {(tab === 'students' || (tab === 'classes' && !teacher)) && (
            <details className="identity-panel">
              <summary>查找表单中的{tab === 'students' ? '班级' : '教师'}选项</summary>
              <p>下面的新增与调整表单使用当前这一页的选项，可搜索全部授权对象。</p>
              {tab === 'students' ? (
                <>
                  <label>
                    搜索班级选项
                    <input
                      value={classChoiceQuery}
                      onChange={(e) => {
                        setClassChoiceQuery(e.target.value);
                        setClassChoicePage(0);
                      }}
                    />
                  </label>
                  <div className="identity-inline">
                    <button
                      disabled={!classChoicePage}
                      onClick={() => setClassChoicePage((p) => p - 1)}
                    >
                      上一页班级选项
                    </button>
                    <span>{classChoiceTotal} 个班级</span>
                    <button
                      disabled={(classChoicePage + 1) * 20 >= classChoiceTotal}
                      onClick={() => setClassChoicePage((p) => p + 1)}
                    >
                      下一页班级选项
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <label>
                    搜索教师选项
                    <input
                      value={teacherChoiceQuery}
                      onChange={(e) => {
                        setTeacherChoiceQuery(e.target.value);
                        setTeacherChoicePage(0);
                      }}
                    />
                  </label>
                  <div className="identity-inline">
                    <button
                      disabled={!teacherChoicePage}
                      onClick={() => setTeacherChoicePage((p) => p - 1)}
                    >
                      上一页教师选项
                    </button>
                    <span>{teacherChoiceTotal} 位教师</span>
                    <button
                      disabled={(teacherChoicePage + 1) * 20 >= teacherChoiceTotal}
                      onClick={() => setTeacherChoicePage((p) => p + 1)}
                    >
                      下一页教师选项
                    </button>
                  </div>
                </>
              )}
            </details>
          )}
          {tab === 'students' && (
            <details className="identity-panel">
              <summary>新增学生 / 复用已有学号加入班级</summary>
              <form
                onSubmit={(e) => {
                  const data = formData(e);
                  return command('upsert-student', {
                    name: data.name,
                    studentNumber: data.studentNumber,
                    classIds: data.classId ? [data.classId] : [],
                  });
                }}
              >
                <label>
                  学号（保留前导零）
                  <input name="studentNumber" required inputMode="text" />
                </label>
                <label>
                  学生姓名
                  <input name="name" required />
                </label>
                <label>
                  加入班级
                  <select name="classId" required={teacher}>
                    <option value="">暂不分班</option>
                    {classes
                      .filter((c) => !c.archived)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                </label>
                <button className="button" disabled={busy}>
                  保存学生与班级关系
                </button>
              </form>
            </details>
          )}
          {['teachers', 'students'].includes(tab) && (
            <div className="identity-list">
              {people.map((p) => (
                <article key={p.id}>
                  <h2>{p.name}</h2>
                  <p>
                    {p.studentNumber ?? p.loginId} · {p.active ? '启用' : '停用'} ·{' '}
                    {p.mustChangePassword ? '待首次改密' : '已改密'} ·{' '}
                    {p.emailVerifiedAt ? '邮箱已验证' : '邮箱未绑定'}
                  </p>
                  {p.enrollments && (
                    <p>
                      班级：{p.enrollments.map((e) => e.teachingClass.name).join('、') || '未分班'}
                    </p>
                  )}
                  <details>
                    <summary>管理账号</summary>
                    <form onSubmit={(e) => command('update-account', { id: p.id, ...formData(e) })}>
                      <label>
                        姓名
                        <input name="name" defaultValue={p.name} />
                      </label>
                      {p.studentNumber && (
                        <label>
                          学号
                          <input name="studentNumber" defaultValue={p.studentNumber} />
                        </label>
                      )}
                      <button disabled={!proof || busy}>保存资料</button>
                    </form>
                    <div className="identity-inline">
                      <button
                        disabled={!proof || busy}
                        onClick={() => {
                          if (window.confirm('生成新的独立临时密码，撤销旧凭据和所有会话？'))
                            void command('reset-password', { id: p.id });
                        }}
                      >
                        重置初始密码
                      </button>
                      <button
                        disabled={!proof || busy}
                        onClick={() => command('update-account', { id: p.id, active: !p.active })}
                      >
                        {p.active ? '停用' : '启用'}
                      </button>
                    </div>
                    {tab === 'students' && (
                      <form
                        onSubmit={(e) => {
                          const d = formData(e);
                          return command('membership', {
                            classId: d.classId,
                            studentId: p.id,
                            joined: d.action === 'JOIN',
                          });
                        }}
                      >
                        <label>
                          班级
                          <select name="classId">
                            {classes
                              .filter((c) => !c.archived)
                              .map((c) => (
                                <option value={c.id} key={c.id}>
                                  {c.name}
                                </option>
                              ))}
                          </select>
                        </label>
                        <label>
                          成员操作
                          <select name="action">
                            <option value="JOIN">加入（保留其他班级）</option>
                            <option value="LEAVE">退出此班级</option>
                          </select>
                        </label>
                        <button disabled={busy}>调整成员关系</button>
                      </form>
                    )}
                  </details>
                </article>
              ))}
            </div>
          )}
          {tab === 'classes' && (
            <>
              <details className="identity-panel">
                <summary>新增课程 / 开课学期</summary>
                <form onSubmit={(e) => command('create-course', formData(e))}>
                  <label>
                    课程名称
                    <input name="title" required />
                  </label>
                  <label>
                    本校课程编号
                    <input name="code" required />
                  </label>
                  <label>
                    学期
                    <input name="term" required placeholder="例如 2026 秋季" />
                  </label>
                  <button disabled={busy}>创建课程与开课实例</button>
                </form>
              </details>
              <details className="identity-panel">
                <summary>新增班级</summary>
                <form
                  onSubmit={(e) =>
                    command('create-class', {
                      ...formData(e),
                      ...(teacher ? { teacherId: identity.id } : {}),
                    })
                  }
                >
                  <label>
                    班级名称
                    <input name="name" required />
                  </label>
                  <label>
                    课程 / 学期
                    <select name="offeringId" required>
                      <option value="">请选择</option>
                      {offerings.map((o) => (
                        <option value={o.id} key={o.id}>
                          {o.course.title} · {o.term}
                        </option>
                      ))}
                    </select>
                  </label>
                  {!teacher && (
                    <label>
                      负责教师
                      <select name="teacherId" required>
                        {teachers.map((t) => (
                          <option value={t.id} key={t.id}>
                            {t.name} · {t.loginId}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <button disabled={busy}>创建班级</button>
                </form>
              </details>
              <div className="identity-list">
                {classes.map((c) => (
                  <article key={c.id}>
                    <h2>{c.name}</h2>
                    <p>
                      {c.offering.course.title} · {c.offering.term} · {c._count.enrollments} 人 ·{' '}
                      {c.archived ? '已归档' : '使用中'}
                    </p>
                    <p>教师：{c.grants.map((g) => g.user.name).join('、')}</p>
                    <div className="identity-inline">
                      <button
                        onClick={() => {
                          setTab('students');
                          setFilterClass(c.id);
                        }}
                      >
                        查看学生
                      </button>
                      <button
                        disabled={!proof || busy}
                        onClick={() =>
                          command('update-class', { classId: c.id, archived: !c.archived })
                        }
                      >
                        {c.archived ? '恢复班级' : '归档班级'}
                      </button>
                    </div>
                    {!teacher && (
                      <details>
                        <summary>交接教师</summary>
                        <p>交接后保留学生与历史作答。已发布作业的复核分工需显式修订。</p>
                        <form
                          onSubmit={(e) =>
                            command('update-class', { classId: c.id, ...formData(e) })
                          }
                        >
                          <label>
                            新负责教师
                            <select name="teacherId">
                              {teachers.map((t) => (
                                <option value={t.id} key={t.id}>
                                  {t.name} · {t.loginId}
                                </option>
                              ))}
                            </select>
                          </label>
                          <button disabled={!proof || busy}>确认交接</button>
                        </form>
                      </details>
                    )}
                  </article>
                ))}
              </div>
            </>
          )}
          {['teachers', 'students', 'classes'].includes(tab) && (
            <div className="identity-inline">
              <button disabled={!page} onClick={() => setPage((v) => v - 1)}>
                上一页
              </button>
              <span>
                {total} 条 · 第 {page + 1} 页
              </span>
              <button disabled={(page + 1) * 20 >= total} onClick={() => setPage((v) => v + 1)}>
                下一页
              </button>
            </div>
          )}
          {tab === 'imports' && (
            <RosterImportWizard
              key={schoolId}
              schoolId={schoolId}
              teacher={teacher}
              offerings={offerings}
            />
          )}
          {(tab === 'delivery' || batchId) && (
            <CredentialDelivery schoolId={schoolId} batchId={batchId} siteAdmin={root} />
          )}
        </>
      )}
    </div>
  );
}
