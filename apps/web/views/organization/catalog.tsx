import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Actor } from '@tuheng/domain';
import { PageTitle, Panel } from '@tuheng/ui';
import {
  courseList,
  courseDetail,
  offeringList,
  offeringDetail,
  classList,
  classDetail,
  people,
} from '../../../../packages/infrastructure/src/organization-queries';
import { CommandForm } from '../../components/organization/OrganizationCommands';
import { OrganizationSelect } from '../../components/identity/OrganizationSelect';
import { href, Pagination, SearchForm, type Params } from './navigation';
type Props = { a: Actor; schoolId: string; area: string; search: Params; segments: string[] };
function Field({ label, name, value }: { label: string; name: string; value?: string }) {
  return (
    <label>
      {label}
      <input name={name} defaultValue={value} required maxLength={100} />
    </label>
  );
}
function Archive({
  type,
  operation,
  data,
  archived,
}: {
  type: string;
  operation: string;
  data: Record<string, unknown>;
  archived: boolean;
}) {
  return (
    <CommandForm
      label={(archived ? '恢复' : '归档') + type}
      operation={operation}
      data={{ ...data, archived: !archived }}
      confirm={
        archived
          ? '恢复本层级后，单独归档的下级记录保留原状态。'
          : '归档后暂停新增和发布，既有作业继续执行。'
      }
    />
  );
}
function NewClass({
  a,
  schoolId,
  offeringId,
}: {
  a: Actor;
  schoolId: string;
  offeringId?: string;
}) {
  return (
    <CommandForm
      label="新增教学班"
      operation="create-class"
      primary
      data={{ offeringId, ...(a.kind === 'TEACHER' ? { teacherId: a.id } : {}) }}
    >
      <Field label="班级名称" name="name" />
      {!offeringId && (
        <OrganizationSelect
          schoolId={schoolId}
          name="offeringId"
          kind="offerings"
          label="课程 / 学期"
          required
        />
      )}
      {a.kind !== 'TEACHER' && (
        <OrganizationSelect
          schoolId={schoolId}
          name="teacherId"
          kind="teachers"
          label="负责教师"
          required
        />
      )}
    </CommandForm>
  );
}
export async function Catalog({ a, schoolId, area, search, segments }: Props) {
  const [, courseId, part, offeringId] = segments,
    base = '/' + area + '/organization',
    scope = { schoolId },
    coursePath = base + '/' + courseId;
  if (segments.length > 4 || (part && (part !== 'offerings' || !offeringId))) notFound();
  if (!courseId) {
    const list = await courseList(a, schoolId, search);
    return (
      <>
        <PageTitle
          title="课程与开课学期"
          description="选择课程查看历次开课及所属教学班。"
          action={
            <CommandForm label="新增课程" operation="create-course" primary>
              <Field label="课程名称" name="title" />
              <Field label="本校课程编号" name="code" />
            </CommandForm>
          }
        />
        <Panel>
          <SearchForm path={base} search={search} label="搜索课程、编号或学期" />
          {list.items.map((c) => (
            <Link className="list-item" href={href(base + '/' + c.id, scope)} key={c.id}>
              <strong>{c.title}</strong> {c.code} · {c._count.offerings} 次开课{' '}
              {c.archived ? ' · 已归档' : ''}
            </Link>
          ))}
          {!list.total && <p>暂无匹配课程。</p>}
          <Pagination path={base} search={search} {...list} />
        </Panel>
      </>
    );
  }
  const course = await courseDetail(a, schoolId, courseId);
  const crumbs = (
    <nav className="row-actions" aria-label="教学组织路径">
      <Link href={href(base, scope)}>课程列表</Link> ›{' '}
      <Link href={href(coursePath, scope)}>{course.title}</Link>
    </nav>
  );
  if (!offeringId) {
    const list = await offeringList(a, schoolId, { ...search, courseId });
    return (
      <>
        {crumbs}
        <PageTitle
          title={course.title}
          description={'课程编号 ' + course.code + (course.archived ? ' · 已归档' : '')}
        />
        <div className="row-actions">
          {!course.archived && (
            <>
              <CommandForm
                label="新增开课学期"
                operation="create-offering"
                primary
                data={{ courseId }}
              >
                <Field label="学期" name="term" />
              </CommandForm>
              <CommandForm label="编辑课程" operation="update-course" data={{ courseId }}>
                <Field name="title" label="课程名称" value={course.title} />
                <Field name="code" label="本校课程编号" value={course.code} />
              </CommandForm>
            </>
          )}
          <Archive
            type="课程"
            operation="update-course"
            data={{ courseId }}
            archived={course.archived}
          />
        </div>
        <Panel title="开课学期">
          <SearchForm path={coursePath} search={search} label="搜索学期" />
          {list.items.map((o) => (
            <Link
              className="list-item"
              key={o.id}
              href={href(coursePath + '/offerings/' + o.id, scope)}
            >
              {o.term}
              {o.archived ? ' · 已归档' : ''}
            </Link>
          ))}
          {!list.total && <p>暂无开课记录。</p>}
          <Pagination path={coursePath} search={search} {...list} />
        </Panel>
      </>
    );
  }
  const offering = await offeringDetail(a, schoolId, offeringId, courseId);
  return (
    <>
      {crumbs}
      <PageTitle
        title={course.title + ' · ' + offering.term}
        description={
          course.archived ? '所属课程已归档' : offering.archived ? '本次开课已归档' : '开课详情'
        }
      />
      <div className="row-actions">
        {!course.archived && (
          <>
            {!offering.archived && (
              <>
                <NewClass a={a} schoolId={schoolId} offeringId={offeringId} />
                <CommandForm label="编辑开课" operation="update-offering" data={{ offeringId }}>
                  <Field name="term" label="学期" value={offering.term} />
                </CommandForm>
                <Link href={href('/' + area + '/imports', { schoolId, offeringId })}>
                  导入本期开课名单
                </Link>
              </>
            )}
            <Archive
              type="开课"
              operation="update-offering"
              data={{ offeringId }}
              archived={offering.archived}
            />
          </>
        )}
      </div>
      {await ClassRows({
        a,
        schoolId,
        area,
        search,
        path: coursePath + '/offerings/' + offeringId,
        offeringId,
      })}
    </>
  );
}
async function ClassRows({
  a,
  schoolId,
  area,
  search,
  path,
  offeringId,
}: {
  a: Actor;
  schoolId: string;
  area: string;
  search: Params;
  path: string;
  offeringId?: string;
}) {
  const list = await classList(a, schoolId, { ...search, offeringId });
  return (
    <Panel title="教学班列表">
      <SearchForm path={path} search={search} label="搜索班级、课程或学期" />
      {list.items.map((c) => (
        <Link
          className="list-item"
          href={href('/' + area + '/classes/' + c.id, { schoolId })}
          key={c.id}
        >
          <span>
            <strong>{c.name}</strong>
            <small>
              {c.offering.course.title} · {c.offering.term} ·{' '}
              {c.grants.map((g) => g.user.name).join('、')} · {c._count.enrollments} 位学生
              {c.archived || c.offering.archived || c.offering.course.archived ? ' · 已归档' : ''}
            </small>
          </span>
        </Link>
      ))}
      {!list.total && <p>暂无匹配教学班。</p>}
      <Pagination path={path} search={search} {...list} />
    </Panel>
  );
}
export async function Classes({ a, schoolId, area, search, segments }: Props) {
  if (segments.length > 2) notFound();
  const classId = segments[1],
    path = '/' + area + '/classes';
  if (!classId)
    return (
      <>
        <PageTitle
          title={a.kind === 'TEACHER' ? '我的教学班' : '教学班及成员'}
          description="查看课程、学期、班级成员和授课关系。"
          action={<NewClass a={a} schoolId={schoolId} />}
        />
        {await ClassRows({ a, schoolId, area, search, path })}
      </>
    );
  const c = await classDetail(a, schoolId, classId),
    list = await people(a, schoolId, { ...search, kind: 'STUDENT', classId });
  const parentOpen = !c.offering.archived && !c.offering.course.archived,
    open = parentOpen && !c.archived,
    manager = a.kind !== 'TEACHER';
  return (
    <>
      <nav className="row-actions">
        <Link href={href(path, { schoolId })}>教学班列表</Link>
        {manager && (
          <Link
            href={href(
              '/' + area + '/organization/' + c.offering.courseId + '/offerings/' + c.offeringId,
              { schoolId },
            )}
          >
            {c.offering.course.title} · {c.offering.term}
          </Link>
        )}
      </nav>
      <PageTitle
        title={c.name}
        description={c.offering.course.title + ' · ' + c.offering.term + (open ? '' : ' · 已归档')}
      />
      <Panel title="班级管理">
        <p>授课教师　{c.grants.map((g) => g.user.name).join('、')}</p>
        <div className="row-actions">
          {open && (
            <>
              <CommandForm label="班级改名" operation="update-class" data={{ classId }}>
                <Field label="班级名称" name="name" value={c.name} />
              </CommandForm>
              {manager && (
                <CommandForm label="调整授课教师" operation="update-class" data={{ classId }}>
                  <label>
                    交出授权的教师
                    <select name="fromTeacherId" defaultValue="">
                      <option value="">保留现有教师，增加联合授课</option>
                      {c.grants.map((g) => (
                        <option value={g.userId} key={g.id}>
                          {g.user.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <OrganizationSelect
                    name="teacherId"
                    label="接任教师"
                    schoolId={schoolId}
                    kind="teachers"
                    required
                  />
                  <p>
                    已发布快照作业 {c.snapshots} 份，保留原复核教师。旧版无快照作业 {c.legacy}{' '}
                    份，复核权限随当前授课关系变化。
                  </p>
                </CommandForm>
              )}
              <CommandForm
                label="加入学生"
                operation="upsert-student"
                primary
                data={{ classIds: [classId] }}
              >
                <Field label="学号" name="studentNumber" />
                <Field label="学生姓名" name="name" />
              </CommandForm>
              <Link href={href('/' + area + '/imports', { schoolId, offeringId: c.offeringId })}>
                导入成员
              </Link>
            </>
          )}
          {parentOpen && (
            <Archive
              type="班级"
              operation="update-class"
              data={{ classId }}
              archived={c.archived}
            />
          )}
        </div>
      </Panel>
      <Panel title="班级成员">
        <SearchForm path={path + '/' + classId} search={search} label="搜索学生" />
        {list.items.map((s) => (
          <article className="list-item" key={s.id}>
            <strong>{s.name}</strong> {s.studentNumber}
            <div className="row-actions">
              {open && (
                <>
                  <CommandForm
                    label="移出本班"
                    operation="membership"
                    data={{ classId, studentId: s.id, joined: false }}
                    confirm={'确认移出 ' + s.name + '？其他班级和学校账号保留。'}
                  />
                  <CommandForm
                    label="重置临时密码"
                    operation="reset-password"
                    data={{ id: s.id }}
                    confirm={'为 ' + s.name + ' 生成新临时密码并撤销旧凭据。'}
                  />
                </>
              )}
            </div>
          </article>
        ))}
        {!list.total && <p>暂无匹配学生。</p>}
        <Pagination path={path + '/' + classId} search={search} {...list} />
      </Panel>
    </>
  );
}
