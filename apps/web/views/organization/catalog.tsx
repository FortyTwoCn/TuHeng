import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Actor } from '@tuheng/domain';
import { PageTitle } from '@tuheng/ui';
import {
  courseList,
  courseDetail,
  offeringList,
  offeringDetail,
  classDetail,
  people,
} from '../../../../packages/infrastructure/src/organization-queries';
import { CommandForm } from '../../components/organization/OrganizationCommands';
import { TermFields } from '../../components/organization/TermFields';
import { TermPeriod, TermSummary } from '../../components/organization/TermPresentation';
import { OrganizationSelect } from '../../components/identity/OrganizationSelect';
import { href, Pagination, SearchForm, type Params } from './navigation';
import {
  OrganizationPanel,
  OrganizationRecord,
  OrganizationStages,
  OrganizationHint,
  OrganizationEmpty,
  RecordHeading,
} from '../../components/organization/OrganizationPresentation';
import { Users, GraduationCap, ChevronRight } from 'lucide-react';
import { ClassRows } from './class-list';
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
        <OrganizationStages stage="courses" />
        <OrganizationPanel title="课程列表" count={list.total}>
          <SearchForm path={base} search={search} label="搜索课程、编号或学期" />
          <RecordHeading title="课程 / 编号" context="开课记录" />
          {list.items.map((c) => (
            <OrganizationRecord
              key={c.id}
              href={href(base + '/' + c.id, scope)}
              kind="course"
              title={c.title}
              subtitle={c.code}
              context={<>{c._count.offerings} 次开课</>}
              archived={c.archived}
              action="查看开课学期"
            />
          ))}
          {!list.total && <OrganizationEmpty>暂无匹配课程。</OrganizationEmpty>}
          <Pagination path={base} search={search} {...list} />
        </OrganizationPanel>
        <OrganizationHint>
          先建立课程，再为课程新增开课学期。每次开课可建立多个教学班。
        </OrganizationHint>
      </>
    );
  }
  const course = await courseDetail(a, schoolId, courseId);
  const crumbs = (
    <nav className="org-breadcrumb" aria-label="教学组织路径">
      <Link href={href(base, scope)}>课程列表</Link>
      <ChevronRight size={14} aria-hidden="true" />
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
          action={
            <div className="row-actions org-heading-actions">
              {!course.archived && (
                <>
                  <CommandForm
                    label="新增开课学期"
                    operation="create-offering"
                    primary
                    data={{ courseId }}
                  >
                    <Field label="学期" name="term" />
                    <TermFields />
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
          }
        />
        <OrganizationStages stage="offerings" coursesHref={href(base, scope)} />
        <OrganizationPanel title="开课学期" count={list.total}>
          <SearchForm path={coursePath} search={search} label="搜索学期" lifecycle />
          <RecordHeading title="学期" context="所属课程" />
          {list.items.map((o) => (
            <OrganizationRecord
              key={o.id}
              href={href(coursePath + '/offerings/' + o.id, scope)}
              kind="offering"
              title={o.term}
              subtitle={<TermPeriod {...o} />}
              context={course.title}
              archived={o.archived || course.archived}
              lifecycleStatus={o.lifecycleStatus}
              action="查看教学班"
            />
          ))}
          {!list.total && <OrganizationEmpty>暂无开课记录。</OrganizationEmpty>}
          <Pagination path={coursePath} search={search} {...list} />
        </OrganizationPanel>
        <OrganizationHint>
          同一课程可在多个学期开课。新学期新增开课记录，历史班级和作业继续保留。
        </OrganizationHint>
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
        action={
          <div className="row-actions org-heading-actions">
            {!course.archived && (
              <>
                {!offering.archived && (
                  <>
                    <NewClass a={a} schoolId={schoolId} offeringId={offeringId} />
                    <CommandForm label="编辑开课" operation="update-offering" data={{ offeringId }}>
                      <Field name="term" label="学期" value={offering.term} />
                      <TermFields
                        startsAt={offering.startsAt.toISOString()}
                        endsAt={offering.endsAt.toISOString()}
                      />
                    </CommandForm>
                    <Link
                      className="button secondary"
                      href={href('/' + area + '/imports', { schoolId, offeringId })}
                    >
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
        }
      />
      <TermSummary {...offering} />
      <OrganizationStages
        stage="classes"
        coursesHref={href(base, scope)}
        offeringsHref={href(coursePath, scope)}
      />
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
      <nav className="org-breadcrumb" aria-label="教学组织路径">
        <Link href={href(path, { schoolId })}>教学班列表</Link>
        {manager && (
          <>
            <ChevronRight size={14} aria-hidden="true" />
            <Link
              href={href(
                '/' + area + '/organization/' + c.offering.courseId + '/offerings/' + c.offeringId,
                { schoolId },
              )}
            >
              {c.offering.course.title} · {c.offering.term}
            </Link>
          </>
        )}
      </nav>
      <PageTitle
        title={c.name}
        description={c.offering.course.title + ' · ' + c.offering.term + (open ? '' : ' · 已归档')}
      />
      <TermSummary {...c} />
      <section className="org-class-management" aria-label="班级管理">
        <div className="org-teachers">
          <GraduationCap size={21} aria-hidden="true" />
          <div>
            <small>授课教师</small>
            <strong>{c.grants.map((g) => g.user.name).join('、') || '暂无授课教师'}</strong>
          </div>
        </div>
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
              <Link
                className="button secondary"
                href={href('/' + area + '/imports', { schoolId, offeringId: c.offeringId })}
              >
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
      </section>
      <OrganizationPanel title="班级成员" count={list.total}>
        <SearchForm path={path + '/' + classId} search={search} label="搜索学生" />
        <div className="org-member-heading" aria-hidden="true">
          <span>学生 / 学号</span>
          <span>成员操作</span>
        </div>
        {list.items.map((s) => (
          <article className="org-member" key={s.id}>
            <div className="org-record-title">
              <span className="org-record-icon">
                <Users size={20} aria-hidden="true" />
              </span>
              <span>
                <strong>{s.name}</strong>
                <small>{s.studentNumber}</small>
              </span>
            </div>
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
        {!list.total && <OrganizationEmpty>暂无匹配学生。</OrganizationEmpty>}
        <Pagination path={path + '/' + classId} search={search} {...list} />
      </OrganizationPanel>
      <OrganizationHint>
        移出本班只解除当前成员关系，保留学生账号、其他班级及历史作业。
      </OrganizationHint>
    </>
  );
}
