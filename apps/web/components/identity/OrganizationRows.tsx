'use client';
import { Badge } from '@tuheng/ui';
import { SchoolDetails } from '../organization/SchoolDetails';
import { FormDrawer } from './FormDrawer';
import { OrganizationSelect } from './OrganizationSelect';
import type { OrganizationCommand, Person, School } from './organization-types';
const fields = (form: HTMLFormElement) => Object.fromEntries(new FormData(form));

function Identifier({ value }: { value?: string | null }) {
  return <span className="organization-id">{value || '—'}</span>;
}
export function PersonRow({
  person: p,
  schoolId,
  student,
  busy,
  command,
}: {
  person: Person;
  schoolId: string;
  student: boolean;
  busy: boolean;
  command: OrganizationCommand;
}) {
  const memberships = student ? p.enrollments : p.grants;
  return (
    <article className="organization-row">
      <div>
        <h3>{p.name}</h3>
        <Identifier value={p.studentNumber ?? p.loginId} />
      </div>
      <div
        className="organization-memberships"
        title={memberships?.map((e) => e.teachingClass.name).join('、')}
      >
        {memberships?.map((e) => e.teachingClass.name).join('、') || '未分班'}
      </div>
      <div className="organization-status">
        <Badge tone={p.active ? 'green' : 'gray'}>{p.active ? '账号启用' : '账号停用'}</Badge>
        <span>{p.mustChangePassword ? '待首次改密' : '已改密'}</span>
        <span>{p.emailVerifiedAt ? '邮箱已验证' : '邮箱未绑定'}</span>
      </div>
      <div className="row-actions">
        <FormDrawer
          title={(student ? '学生' : '教师') + '详情：' + p.name}
          trigger="查看详情"
          busy={busy}
        >
          {(saved) => (
            <>
              <p className="muted">
                {student ? '学号' : '登录 ID'}：{p.studentNumber ?? p.loginId}
              </p>
              <form
                className="identity-dialog-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (await command('update-account', { id: p.id, ...fields(e.currentTarget) }))
                    saved();
                }}
              >
                <label>
                  姓名
                  <input name="name" defaultValue={p.name} required maxLength={100} />
                </label>
                {student && (
                  <label>
                    学号
                    <input
                      name="studentNumber"
                      defaultValue={p.studentNumber}
                      required
                      maxLength={100}
                    />
                  </label>
                )}
                <button className="button primary" disabled={busy}>
                  保存资料
                </button>
              </form>
              <section className="detail-section">
                <h3>账号状态</h3>
                <p>
                  {p.active ? '启用' : '停用'} · {p.mustChangePassword ? '待首次改密' : '已改密'} ·{' '}
                  {p.emailVerifiedAt ? '邮箱已验证' : '邮箱未绑定'}
                </p>
                <p className="muted">
                  最近登录：
                  {p.lastLoginAt ? new Date(p.lastLoginAt).toLocaleString() : '尚无登录记录'}
                </p>
                <div className="identity-inline">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          '为“' + p.name + '”生成新的临时密码，并撤销旧凭据和所有会话？',
                        )
                      )
                        void command('reset-password', { id: p.id });
                    }}
                  >
                    重置初始密码
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          (p.active ? '停用' : '启用') +
                            '“' +
                            p.name +
                            '”的账号？现有会话将失效，历史作答保留。',
                        )
                      )
                        void command('update-account', { id: p.id, active: !p.active });
                    }}
                  >
                    {p.active ? '停用' : '启用'}
                  </button>
                </div>
              </section>
              <section className="detail-section">
                <h3>班级关系</h3>
                <p>{memberships?.map((e) => e.teachingClass.name).join('、') || '暂无班级'}</p>
                {student && (
                  <FormDrawer title={'调整班级：' + p.name} trigger="调整班级">
                    {(done) => (
                      <form
                        className="identity-dialog-form"
                        onSubmit={async (e) => {
                          e.preventDefault();
                          const data = fields(e.currentTarget);
                          if (
                            await command('membership', {
                              classId: data.classId,
                              studentId: p.id,
                              joined: data.action === 'JOIN',
                            })
                          )
                            done();
                        }}
                      >
                        <OrganizationSelect
                          schoolId={schoolId}
                          kind="classes"
                          label="班级"
                          name="classId"
                          required
                        />
                        <label>
                          成员操作
                          <select name="action">
                            <option value="JOIN">加入（保留其他班级）</option>
                            <option value="LEAVE">退出此班级</option>
                          </select>
                        </label>
                        <button className="button primary" disabled={busy}>
                          调整成员关系
                        </button>
                      </form>
                    )}
                  </FormDrawer>
                )}
                {!student && <p className="muted">在班级列表中新增班级或交接负责教师。</p>}
              </section>
            </>
          )}
        </FormDrawer>
      </div>
    </article>
  );
}

export function SchoolRow({
  school: s,
  busy,
  command,
  choose,
}: {
  school: School;
  busy: boolean;
  command: OrganizationCommand;
  choose: () => void;
}) {
  return (
    <article className="organization-row">
      <div>
        <h3>{s.name}</h3>
        <Identifier value={s.code} />
      </div>
      <div>
        <span>
          {s.counts.teachers} 位教师 · {s.counts.students} 位学生
        </span>
        <small className="muted">{s._count.users} 个账号（含管理账号）</small>
      </div>
      <div className="organization-status">
        <Badge tone={s.active ? 'green' : 'gray'}>{s.active ? '学校启用' : '学校停用'}</Badge>
        <span>
          管理账号：
          {s.administrators.length
            ? s.administrators.every((a) => a.active)
              ? '启用'
              : '含停用账号'
            : '未建立'}
        </span>
      </div>
      <div className="row-actions">
        <button
          type="button"
          className="button secondary"
          disabled={!s.active}
          title={!s.active ? '请先启用学校' : undefined}
          onClick={choose}
        >
          管理该学校
        </button>
        <FormDrawer
          title="学校详情"
          trigger="查看详情"
          busy={busy}
          className="school-detail-drawer"
        >
          {(saved) => <SchoolDetails school={s} busy={busy} command={command} saved={saved} />}
        </FormDrawer>
      </div>
    </article>
  );
}
