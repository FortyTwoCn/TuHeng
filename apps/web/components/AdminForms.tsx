'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Role } from '@tuheng/contracts';
import { action } from './Actions';
export function UserCreate() {
  const [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [roles, setRoles] = useState<string[]>(['STUDENT']);
  const router = useRouter();
  return (
    <form
      className="panel"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const f = new FormData(e.currentTarget);
        try {
          await action('user-create', {
            name: f.get('name'),
            email: f.get('email'),
            password: f.get('password'),
            roles,
          });
          setMessage('用户已创建');
          router.refresh();
        } catch (e) {
          setMessage((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>创建用户</h2>
      <div className="form-grid">
        <label>
          姓名
          <input name="name" required />
        </label>
        <label>
          邮箱
          <input name="email" type="email" required />
        </label>
        <label>
          初始密码
          <input
            name="password"
            type="password"
            minLength={12}
            required
            autoComplete="new-password"
          />
        </label>
      </div>
      <div className="check-row">
        {Role.options.map((r) => (
          <label key={r}>
            <input
              type="checkbox"
              checked={roles.includes(r)}
              onChange={(e) =>
                setRoles(e.target.checked ? [...roles, r] : roles.filter((v) => v !== r))
              }
            />
            {r}
          </label>
        ))}
      </div>
      <button className="button primary" disabled={busy || !roles.length}>
        创建账号
      </button>
      <p role="status">{message}</p>
    </form>
  );
}
export function UserManage({ id, roles }: { id: string; roles: string[] }) {
  const [newRoles, setRoles] = useState(roles),
    [password, setPassword] = useState(''),
    [message, setMessage] = useState('');
  const router = useRouter();
  return (
    <details>
      <summary>角色与密码恢复</summary>
      <div className="check-row">
        {Role.options.map((r) => (
          <label key={r}>
            <input
              type="checkbox"
              checked={newRoles.includes(r)}
              onChange={(e) =>
                setRoles(e.target.checked ? [...newRoles, r] : newRoles.filter((v) => v !== r))
              }
            />
            {r}
          </label>
        ))}
      </div>
      <input
        type="password"
        placeholder="重置密码（至少12位，可留空）"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <button
        className="button secondary"
        onClick={async () => {
          try {
            await action('user-update', { id, roles: newRoles, ...(password ? { password } : {}) });
            setPassword('');
            setMessage('已更新，旧会话已撤销');
            router.refresh();
          } catch (e) {
            setMessage((e as Error).message);
          }
        }}
      >
        保存权限与密码
      </button>
      <p role="status">{message}</p>
    </details>
  );
}
export function OrganizationForm({
  courses,
  offerings,
  classes,
  users,
}: {
  courses: { id: string; title: string }[];
  offerings: { id: string; term: string }[];
  classes: { id: string; name: string }[];
  users: { id: string; name: string }[];
}) {
  const [kind, setKind] = useState('course'),
    [message, setMessage] = useState('');
  const router = useRouter();
  return (
    <form
      className="panel"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        try {
          await action('organization', Object.fromEntries(f));
          router.refresh();
          setMessage('已保存');
        } catch (e) {
          setMessage((e as Error).message);
        }
      }}
    >
      <h2>维护课程与教学组织</h2>
      <label>
        操作类型
        <select name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
          {[
            ['course', '创建课程'],
            ['offering', '创建开课实例 / 学期'],
            ['class', '创建教学班'],
            ['enrollment', '学生选课'],
            ['grant', '教师 / 助教授权'],
          ].map(([k, t]) => (
            <option key={k} value={k}>
              {t}
            </option>
          ))}
        </select>
      </label>
      {kind === 'course' ? (
        <>
          <label>
            课程名称
            <input name="title" required />
          </label>
          <label>
            课程代码
            <input name="code" required />
          </label>
        </>
      ) : kind === 'offering' ? (
        <>
          <label>
            课程
            <select name="courseId">
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            学期
            <input name="term" placeholder="2026 秋季" required />
          </label>
        </>
      ) : kind === 'class' ? (
        <>
          <label>
            开课实例
            <select name="offeringId">
              {offerings.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.term} · {o.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
          <label>
            教学班名称
            <input name="name" required />
          </label>
        </>
      ) : (
        <>
          <label>
            用户
            <select name="userId">
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            班级
            <select name="classId">
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      <button className="button primary">保存组织关系</button>
      <p role="status">{message}</p>
    </form>
  );
}
export function ImportUsers() {
  const [csv, setCsv] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <div className="panel">
      <h2>基础名单导入</h2>
      <p className="muted small">
        每行：邮箱,姓名,初始密码,角色。支持不含逗号的基础 CSV，逐行显示真实结果，重复记录不会覆盖。
      </p>
      <textarea
        aria-label="用户导入 CSV"
        value={csv}
        onChange={(e) => setCsv(e.target.value)}
        placeholder="student@example.edu.cn,张同学,至少12位初始密码,STUDENT"
      />
      <button
        className="button secondary"
        disabled={busy || !csv}
        onClick={async () => {
          setBusy(true);
          const lines = csv.trim().split(/\r?\n/);
          let ok = 0;
          const errors: string[] = [];
          for (const [i, line] of lines.entries()) {
            const [email, name, password, role] = line.split(',').map((s) => s.trim());
            try {
              await action('user-create', { email, name, password, roles: [role || 'STUDENT'] });
              ok++;
            } catch (e) {
              errors.push(`第${i + 1}行：${(e as Error).message}`);
            }
          }
          setMessage(`成功${ok}条。${errors.join('；')}`);
          setBusy(false);
          router.refresh();
        }}
      >
        导入用户
      </button>
      <p role="status">{message}</p>
    </div>
  );
}
export function RosterImport({ classId }: { classId: string }) {
  const [csv, setCsv] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <section className="panel">
      <h2>基础班级名单导入</h2>
      <p className="muted small">
        每行填写一个已有学生账号邮箱。缺少账号时请先由管理员创建；整批校验通过后保存，重复选课自动忽略。
      </p>
      <textarea
        aria-label="班级学生邮箱名单"
        value={csv}
        onChange={(e) => setCsv(e.target.value)}
      />
      <button
        className="button secondary"
        disabled={!csv || busy}
        onClick={async () => {
          setBusy(true);
          try {
            const r = await action('roster-import', {
              classId,
              emails: csv
                .trim()
                .split(/\r?\n/)
                .map((s) => s.trim())
                .filter(Boolean),
            });
            setMessage(`新增${r.added}条选课关系`);
            router.refresh();
          } catch (e) {
            setMessage((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        校验并导入名单
      </button>
      <p role="status">{message}</p>
    </section>
  );
}
