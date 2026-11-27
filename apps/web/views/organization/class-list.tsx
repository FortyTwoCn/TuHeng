import Link from 'next/link';
import { ensure, type Actor } from '@tuheng/domain';
import { PageTitle } from '@tuheng/ui';
import {
  classList,
  studentClassDetail,
} from '../../../../packages/infrastructure/src/organization-queries';
import {
  OrganizationEmpty,
  OrganizationPanel,
  OrganizationRecord,
  RecordHeading,
} from '../../components/organization/OrganizationPresentation';
import { TermPeriod, TermSummary } from '../../components/organization/TermPresentation';
import { href, Pagination, SearchForm, type Params } from './navigation';

export async function ClassRows({
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
  const student = a.kind === 'STUDENT';
  return (
    <OrganizationPanel title="教学班列表" count={list.total}>
      <SearchForm path={path} search={search} label="搜索班级、课程或学期" lifecycle />
      <RecordHeading title="教学班 / 课程" context={student ? '学期时间' : '授课教师 / 成员'} />
      {list.items.map((c) => (
        <OrganizationRecord
          href={href('/' + area + '/classes/' + c.id, student ? {} : { schoolId })}
          key={c.id}
          kind="class"
          title={c.name}
          subtitle={
            <>
              {c.offering.course.title} · {c.offering.term}
              {!student && <TermPeriod {...c} />}
            </>
          }
          context={
            student ? (
              <TermPeriod {...c} />
            ) : (
              <>
                <span>{c.grants.map((g) => g.user.name).join('、') || '暂无授课教师'}</span>
                <small>{c._count.enrollments} 位学生</small>
              </>
            )
          }
          archived={c.archived || c.offering.archived || c.offering.course.archived}
          lifecycleStatus={c.lifecycleStatus}
          action="查看班级"
        />
      ))}
      {!list.total && <OrganizationEmpty>暂无匹配教学班。</OrganizationEmpty>}
      <Pagination path={path} search={search} {...list} />
    </OrganizationPanel>
  );
}

export async function StudentClasses({ a, id, search }: { a: Actor; id?: string; search: Params }) {
  if (!id && !a.schoolId)
    return <PageTitle title="我的教学班" description="暂无已加入的教学班。" />;
  ensure(a.schoolId, 'CLASS_NOT_FOUND', 404);
  const path = '/student/classes';
  if (!id)
    return (
      <div className="organization-workspace">
        <PageTitle title="我的教学班" />
        <ClassRows a={a} schoolId={a.schoolId} area="student" search={search} path={path} />
      </div>
    );
  const c = await studentClassDetail(a, a.schoolId, id);
  const archived = c.archived || c.offering.archived || c.offering.course.archived;
  return (
    <div className="organization-workspace">
      <nav className="org-breadcrumb" aria-label="教学组织路径">
        <Link href={path}>教学班列表</Link>
      </nav>
      <PageTitle
        title={c.name}
        description={
          c.offering.course.title + ' · ' + c.offering.term + (archived ? ' · 已归档' : '')
        }
        action={
          <Link className="button secondary" href={href('/student/assignments', { classId: c.id })}>
            查看班级作业
          </Link>
        }
      />
      <TermSummary {...c} />
    </div>
  );
}
