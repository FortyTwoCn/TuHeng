'use client';
import { useContext, useState } from 'react';
import { Building2, ShieldCheck, UserRoundPlus, KeyRound, Power, LockKeyhole } from 'lucide-react';
import { Badge } from '@tuheng/ui';
import { FormFeedback } from '../identity/FormDrawer';
import type { OrganizationCommand, School } from '../identity/organization-types';
import './school-details.css';

export function SchoolDetails({
  school: s,
  busy,
  command,
  saved,
}: {
  school: School;
  busy: boolean;
  command: OrganizationCommand;
  saved: () => void;
}) {
  const feedback = useContext(FormFeedback);
  const [noticeFor, setNoticeFor] = useState<string>();
  const enabled = s.administrators.filter((a) => a.active).length;
  async function accountAction(id: string, operation: string, data: Record<string, unknown>) {
    setNoticeFor(id);
    await command(operation, data);
  }
  return (
    <div className="school-details" aria-busy={busy}>
      <section className="school-detail-section" aria-label="学校基本信息">
        <div className="school-detail-heading">
          <h3>
            <Building2 size={19} aria-hidden="true" />
            基本信息
          </h3>
          <Badge tone={s.active ? 'green' : 'gray'}>{s.active ? '学校启用' : '学校停用'}</Badge>
        </div>
        <p className="school-detail-code">
          学校编号 <span>{s.code}</span>
        </p>
        <dl className="school-detail-stats">
          <div>
            <dt>全部账号</dt>
            <dd>
              {s._count.users}
              <span>个</span>
            </dd>
          </div>
          <div>
            <dt>教师</dt>
            <dd>
              {s.counts.teachers}
              <span>位</span>
            </dd>
          </div>
          <div>
            <dt>学生</dt>
            <dd>
              {s.counts.students}
              <span>位</span>
            </dd>
          </div>
        </dl>
        <form
          className="school-detail-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const name = new FormData(e.currentTarget).get('name');
            if (await command('rename-school', { id: s.id, name })) saved();
          }}
        >
          <label>
            学校名称
            <input name="name" defaultValue={s.name} required maxLength={100} />
          </label>
          <button className="button secondary" disabled={busy}>
            保存名称
          </button>
        </form>
      </section>

      <section className="school-detail-section" aria-label="学校管理账号">
        <div className="school-detail-heading">
          <h3>
            <ShieldCheck size={19} aria-hidden="true" />
            学校管理账号
          </h3>
          <span className="school-detail-count">
            {s.administrators.length} 位管理员 · {enabled} 位启用
          </span>
        </div>
        <p className="school-detail-description">
          每位管理员使用独立账号，至少保留一位启用的管理员。
        </p>
        <div className="school-admin-list">
          {s.administrators.map((a) => (
            <article
              className="school-admin-card"
              key={a.id}
              data-school-administrator={a.id}
              aria-label={a.name + '的管理账号'}
            >
              <div className="school-admin-identity">
                <span className="school-admin-avatar" aria-hidden="true">
                  {Array.from(a.name)[0] || '管'}
                </span>
                <div>
                  <h4>{a.name}</h4>
                  <p>
                    登录 ID <span>{a.loginId || '—'}</span>
                  </p>
                </div>
                <Badge tone={a.active ? 'green' : 'gray'}>{a.active ? '启用' : '停用'}</Badge>
              </div>
              <div className="school-admin-setup" aria-label="账号设置状态">
                <Badge tone={a.mustChangePassword ? 'amber' : 'gray'}>
                  {a.mustChangePassword ? '待改密' : '已改密'}
                </Badge>
                <Badge tone={a.emailVerifiedAt ? 'green' : 'amber'}>
                  {a.emailVerifiedAt ? '邮箱已验证' : '待验证邮箱'}
                </Badge>
              </div>
              <div className="school-admin-actions">
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy || !s.active || !a.active}
                  title={
                    !s.active
                      ? '启用学校后可重置密码'
                      : !a.active
                        ? '启用账号后可重置密码'
                        : undefined
                  }
                  onClick={() => {
                    if (window.confirm('为“' + a.name + '”重置临时密码？旧凭据和现有会话将失效。'))
                      void accountAction(a.id, 'reset-password', { id: a.id, schoolId: s.id });
                  }}
                >
                  <KeyRound size={16} aria-hidden="true" />
                  重置临时密码
                </button>
                <button
                  type="button"
                  className={'button ' + (a.active ? 'secondary' : 'primary')}
                  disabled={busy || (a.active && !a.canDeactivate)}
                  aria-describedby={
                    a.active && !a.canDeactivate ? `school-admin-protected-${a.id}` : undefined
                  }
                  title={a.active && !a.canDeactivate ? '必须至少保留一个启用的管理员' : undefined}
                  onClick={() => {
                    if (
                      window.confirm(
                        (a.active ? '停用' : '启用') + '“' + a.name + '”的学校管理账号？',
                      )
                    )
                      void accountAction(a.id, 'update-account', {
                        id: a.id,
                        schoolId: s.id,
                        active: !a.active,
                      });
                  }}
                >
                  <Power size={16} aria-hidden="true" />
                  {a.active ? '停用管理账号' : '启用管理账号'}
                </button>
              </div>
              {a.active && !a.canDeactivate && (
                <p className="school-admin-protection" id={`school-admin-protected-${a.id}`}>
                  <LockKeyhole size={14} aria-hidden="true" />
                  最后一位启用的管理员，新增或启用其他管理员后才可停用。
                </p>
              )}
              {noticeFor === a.id && feedback.notice && (
                <div className="school-detail-notice">{feedback.notice}</div>
              )}
            </article>
          ))}
          {!s.administrators.length && (
            <div className="school-admin-empty">
              <ShieldCheck size={24} aria-hidden="true" />
              <strong>尚未建立管理账号</strong>
              <p>在下方创建首位管理员，为这所学校开通管理入口。</p>
            </div>
          )}
        </div>
        <div className="school-admin-create">
          <h4>
            <UserRoundPlus size={18} aria-hidden="true" />
            新增学校管理员
          </h4>
          <p>创建后领取临时凭据，新管理员首次登录需改密并验证邮箱。</p>
          <form
            className="school-detail-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const name = new FormData(e.currentTarget).get('name');
              if (await command('create-school-admin', { schoolId: s.id, name })) saved();
            }}
          >
            <label>
              管理员姓名
              <input
                name="name"
                required
                maxLength={100}
                placeholder="填写管理员的姓名"
                autoComplete="off"
              />
            </label>
            <button className="button primary" disabled={busy}>
              <UserRoundPlus size={16} aria-hidden="true" />
              创建学校管理账号
            </button>
          </form>
        </div>
      </section>

      <section className="school-detail-section school-access" aria-label="学校访问状态">
        <div className="school-access-content">
          <div>
            <h3>学校访问状态</h3>
            <p>
              {s.active
                ? '停用将影响本校账号访问，历史资料仍会保留。'
                : '学校已停用，启用后本校有效账号可恢复访问。'}
            </p>
          </div>
          <button
            className={'button ' + (s.active ? 'danger' : 'primary')}
            type="button"
            disabled={busy || (!s.active && !s.canActivate)}
            onClick={() => {
              if (
                window.confirm(
                  '此操作影响“' +
                    s.name +
                    '”的 ' +
                    s._count.users +
                    ' 个账号及后台任务；数据保留。确认继续？',
                )
              )
                void accountAction('school', 'set-school-active', { id: s.id, active: !s.active });
            }}
          >
            <Power size={16} aria-hidden="true" />
            {s.active ? '停用学校' : '启用学校'}
          </button>
        </div>
        {!s.active && !s.canActivate && (
          <p className="school-admin-protection">
            <LockKeyhole size={14} aria-hidden="true" />
            请先创建或启用一位管理员，再启用学校。
          </p>
        )}
        {noticeFor === 'school' && feedback.notice && (
          <div className="school-detail-notice">{feedback.notice}</div>
        )}
      </section>
    </div>
  );
}
