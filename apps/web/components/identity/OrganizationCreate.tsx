'use client';
import { FormDrawer } from './FormDrawer';
import { OrganizationSelect } from './OrganizationSelect';
import type { Offering, OrganizationCommand, OrganizationIdentity } from './organization-types';

export function OrganizationCreate({
  tab,
  schoolId,
  identity,
  offerings,
  busy,
  command,
}: {
  tab: string;
  schoolId: string;
  identity: OrganizationIdentity;
  offerings: Offering[];
  busy: boolean;
  command: OrganizationCommand;
}) {
  const teacher = identity.kind === 'TEACHER';
  const submit = async (
    e: React.FormEvent<HTMLFormElement>,
    operation: string,
    saved: () => void,
    map?: (data: Record<string, FormDataEntryValue>) => Record<string, unknown>,
  ) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget));
    if (await command(operation, map ? map(data) : data)) saved();
  };
  if (tab === 'schools' && identity.kind === 'SITE_ADMIN')
    return (
      <FormDrawer trigger="新增学校和管理账号" title="新增学校和管理账号" busy={busy} primary>
        {(saved) => (
          <form
            className="identity-dialog-form"
            onSubmit={(e) => submit(e, 'create-school', saved)}
          >
            <p className="muted">创建后生成独立学校管理账号，初始凭据通过限时交付单独领取。</p>
            <label>
              学校名称
              <input name="name" required maxLength={100} />
            </label>
            <label>
              学校管理员姓名
              <input name="administratorName" required maxLength={100} />
            </label>
            <button className="button primary" disabled={busy}>
              创建学校并生成独立凭据
            </button>
          </form>
        )}
      </FormDrawer>
    );
  if (!schoolId) return null;
  if (tab === 'teachers')
    return (
      <FormDrawer trigger="新增教师" title="新增教师" busy={busy} primary>
        {(saved) => (
          <form
            className="identity-dialog-form"
            onSubmit={(e) => submit(e, 'create-teacher', saved)}
          >
            <label>
              教师姓名
              <input name="name" required maxLength={100} />
            </label>
            <button className="button primary" disabled={busy}>
              创建并生成初始凭据
            </button>
          </form>
        )}
      </FormDrawer>
    );
  if (tab === 'students')
    return (
      <FormDrawer
        trigger="新增学生 / 加入班级"
        title="新增学生 / 复用已有学号加入班级"
        busy={busy}
        primary
      >
        {(saved) => (
          <form
            className="identity-dialog-form"
            onSubmit={(e) =>
              submit(e, 'upsert-student', saved, (d) => ({
                name: d.name,
                studentNumber: d.studentNumber,
                classIds: d.classId ? [d.classId] : [],
              }))
            }
          >
            <label>
              学号（保留前导零）
              <input name="studentNumber" required maxLength={100} inputMode="text" />
            </label>
            <label>
              学生姓名
              <input name="name" required maxLength={100} />
            </label>
            <OrganizationSelect
              schoolId={schoolId}
              kind="classes"
              name="classId"
              label="加入班级"
              required={teacher}
              empty={teacher ? '请选择授权班级' : '暂不分班'}
            />
            <button className="button primary" disabled={busy}>
              保存学生与班级关系
            </button>
          </form>
        )}
      </FormDrawer>
    );
  if (tab !== 'classes') return null;
  return (
    <div className="row-actions">
      <FormDrawer trigger="新增课程 / 开课学期" title="新增课程 / 开课学期" busy={busy}>
        {(saved) => (
          <form
            className="identity-dialog-form"
            onSubmit={(e) => submit(e, 'create-course', saved)}
          >
            <label>
              课程名称
              <input name="title" required maxLength={100} />
            </label>
            <label>
              本校课程编号
              <input name="code" required maxLength={100} />
            </label>
            <label>
              学期
              <input name="term" required placeholder="例如 2026 秋季" maxLength={100} />
            </label>
            <button className="button primary" disabled={busy}>
              创建课程与开课实例
            </button>
          </form>
        )}
      </FormDrawer>
      <FormDrawer trigger="新增班级" title="新增班级" busy={busy} primary>
        {(saved) => (
          <form
            className="identity-dialog-form"
            onSubmit={(e) =>
              submit(e, 'create-class', saved, (data) => ({
                ...data,
                ...(teacher ? { teacherId: identity.id } : {}),
              }))
            }
          >
            <label>
              班级名称
              <input name="name" required maxLength={100} />
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
            {!offerings.length && <p className="muted">请先新增本校课程与开课学期。</p>}
            {!teacher && (
              <OrganizationSelect
                schoolId={schoolId}
                kind="teachers"
                name="teacherId"
                label="负责教师"
                required
              />
            )}
            <button className="button primary" disabled={busy || !offerings.length}>
              保存班级
            </button>
          </form>
        )}
      </FormDrawer>
    </div>
  );
}
