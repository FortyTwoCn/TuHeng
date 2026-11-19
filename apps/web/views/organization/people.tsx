import Link from 'next/link';
import type { Actor } from '@tuheng/domain';
import { Panel, PageTitle } from '@tuheng/ui';
import {
  searchSchools,
  people,
  schoolOverview,
} from '../../../../packages/infrastructure/src/organization-queries';
import {
  CreateAccount,
  PersonActions,
  SchoolActions,
} from '../../components/organization/OrganizationCommands';
import { Pagination, SearchForm, href, type Params } from './navigation';
import {
  OrganizationPanel,
  OrganizationEmpty,
  OrganizationHint,
} from '../../components/organization/OrganizationPresentation';
import { GraduationCap, Users } from 'lucide-react';
export async function Schools({ a, path, search }: { a: Actor; path: string; search: Params }) {
  const list = await searchSchools(a, search);
  return (
    <>
      <PageTitle
        title="学校管理"
        description="学校及其独立的管理账号"
        action={<CreateAccount tab="schools" />}
      />
      <Panel>
        <SearchForm path={path} search={search} label="搜索学校" />
        {list.items.map((s) => (
          <SchoolActions key={s.id} school={s} />
        ))}
        <Pagination path={path} search={search} {...list} />
      </Panel>
    </>
  );
}
export async function People({
  a,
  path,
  search,
  schoolId,
}: {
  a: Actor;
  path: string;
  search: Params;
  schoolId: string;
}) {
  const kind = search.kind === 'STUDENT' ? 'STUDENT' : 'TEACHER',
    list = await people(a, schoolId, { ...search, kind });
  return (
    <>
      <PageTitle
        title={a.kind === 'SITE_ADMIN' ? '用户管理' : '人员管理'}
        description="维护本校账号身份、状态和班级关系。"
        action={<CreateAccount tab={kind === 'TEACHER' ? 'teachers' : 'students'} />}
      />
      <OrganizationPanel title="学校人员" count={list.total}>
        <nav className="org-person-tabs" aria-label="人员类型">
          <Link
            aria-current={kind === 'TEACHER' ? 'page' : undefined}
            href={href(path, { schoolId, kind: 'TEACHER' })}
          >
            <GraduationCap size={18} aria-hidden="true" />
            教师
          </Link>
          <Link
            aria-current={kind === 'STUDENT' ? 'page' : undefined}
            href={href(path, { schoolId, kind: 'STUDENT' })}
          >
            <Users size={18} aria-hidden="true" />
            学生
          </Link>
        </nav>
        <SearchForm
          path={path}
          search={{ ...search, kind }}
          label={'搜索' + (kind === 'TEACHER' ? '教师' : '学生')}
        />
        <div className="org-person-heading" aria-hidden="true">
          <span>姓名 / 登录 ID</span>
          <span>教学班</span>
          <span>账号状态</span>
          <span>操作</span>
        </div>
        {list.items.map((p) => (
          <PersonActions key={p.id} person={p} />
        ))}
        {!list.total && <OrganizationEmpty>暂无匹配账号。</OrganizationEmpty>}
        <Pagination path={path} search={{ ...search, kind }} {...list} />
      </OrganizationPanel>
      <OrganizationHint>
        这里维护学校级账号资料。班级成员的加入、移出和授课安排请前往教学班详情。
      </OrganizationHint>
    </>
  );
}
export async function SchoolDashboard({ a, schoolId }: { a: Actor; schoolId: string }) {
  const v = await schoolOverview(a, schoolId);
  return (
    <>
      <PageTitle title="学校概览" description={v.school.name + ' · ' + v.school.code} />
      <div className="stats">
        {(
          [
            ['在职教师', v.teachers, '/school/users'],
            ['在籍学生', v.students, '/school/users?kind=STUDENT'],
            ['在用课程', v.courses, '/school/organization'],
            ['在用开课', v.offerings, '/school/organization'],
            ['在用教学班', v.classes, '/school/classes'],
          ] as const
        ).map(([label, count, url]) => (
          <Link className="panel" key={label} href={url}>
            <h3>{label}</h3>
            <strong>{count}</strong>
          </Link>
        ))}
      </div>
    </>
  );
}
