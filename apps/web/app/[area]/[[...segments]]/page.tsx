import { redirect, notFound } from 'next/navigation';
import { actor } from '../../../lib/auth';
import { organizationWorkspace } from '../../../views/organization/workspace';
import { ChooseSchool } from '../../../views/organization/navigation';
import { StudentClasses } from '../../../views/organization/class-list';
import { loginEntryUrl } from '../../../components/identity/auth-navigation';
import { SystemSettings } from '../../../components/identity/SystemSettings';
import { Shell } from '../../../components/Shell';
import { requireRole, DomainError, type Actor } from '@tuheng/domain';
import { Panel, PageTitle } from '@tuheng/ui';
import { ProfileView } from '../../../views/profile';
import { AnnouncementsView } from '../../../views/announcements';
import { NotificationCenter } from '../../../components/notifications/NotificationCenter';
import { StudentDashboard, AssignmentList, SelfTests, ErrorBook } from '../../../views/student';
import { AssignmentDetails } from '../../../views/assignment';
import { ResultView } from '../../../views/result';
import {
  TeacherDashboard,
  QuestionsView,
  NewAssignment,
  ReviewsView,
  AnalyticsView,
} from '../../../views/teacher';
import { AdminDashboard, ModelsView, JobsView, AuditView, SystemView } from '../../../views/admin';
export const dynamic = 'force-dynamic';
export async function generateMetadata({
  params,
}: {
  params: Promise<{ area: string; segments?: string[] }>;
}) {
  const { area, segments = [] } = await params;
  const name = (
    { profile: '用户中心', notifications: '通知中心', announcements: '公告' } as Record<
      string,
      string
    >
  )[segments[0]];
  if (name) return { title: name + ' · 图衡' };
  if (area === 'admin' && ['settings', 'mail'].includes(segments[0]))
    return {
      title: `系统设置 · ${segments[0] === 'mail' || segments[1] === 'mail' ? '邮件服务' : '网站信息'} · 图衡`,
    };
  return { title: '图衡 · 智能工程图学教学平台' };
}
export default async function Workspace({
  params,
  searchParams,
}: {
  params: Promise<{ area: string; segments?: string[] }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { area, segments = ['dashboard'] } = await params;
  const search = await searchParams;
  if (!['student', 'teacher', 'admin', 'school'].includes(area)) notFound();
  const realm = area === 'student' ? 'STUDENT' : 'STAFF';
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(search))
    if (typeof value === 'string') query.set(key, value);
  const returnTo =
    `/${area}/${segments.map(encodeURIComponent).join('/')}` + (query.size ? '?' + query : '');
  const a = await actor(realm, true).catch((e) => {
    if (e instanceof DomainError) redirect(loginEntryUrl(realm, returnTo));
    throw e;
  });
  if (a.onboarding)
    redirect(
      `/onboarding/${realm.toLowerCase()}?` + new URLSearchParams({ callbackUrl: returnTo }),
    );
  const section = segments[0];
  let view: React.ReactNode;
  try {
    view = await workspaceView(a, area, segments, search);
  } catch (e) {
    if (e instanceof DomainError && e.status === 404) notFound();
    if (e instanceof DomainError)
      view = (
        <Panel title="无法访问此内容">
          <p>
            {e.status === 403
              ? '你没有此资源的操作权限。'
              : e.status === 404
                ? '未找到此记录。'
                : e.code}
          </p>
          <a href="/" className="button secondary">
            返回工作空间
          </a>
        </Panel>
      );
    else throw e;
  }
  return (
    <Shell
      a={a}
      area={area as 'student' | 'teacher' | 'admin' | 'school'}
      schoolId={area === 'admin' ? search.schoolId : undefined}
      current={section === 'results' ? 'assignments' : section}
    >
      {view}
    </Shell>
  );
}

async function workspaceView(
  a: Actor,
  area: string,
  segments: string[],
  search: Record<string, string | undefined>,
): Promise<React.ReactNode> {
  requireRole(
    a,
    area === 'student'
      ? 'STUDENT'
      : area === 'teacher'
        ? 'TEACHER'
        : area === 'school'
          ? 'SCHOOL_ADMIN'
          : 'ADMIN',
  );
  const section = segments[0];
  const expectedKind =
    area === 'school'
      ? 'SCHOOL_ADMIN'
      : area === 'teacher'
        ? 'TEACHER'
        : area === 'admin'
          ? 'SITE_ADMIN'
          : 'STUDENT';
  if (a.kind !== expectedKind) throw new DomainError('FORBIDDEN', 403);
  if (
    ![
      'selftests',
      'errors',
      'reviews',
      'results',
      'classes',
      'assignments',
      'questions',
      'organization',
      'settings',
      'announcements',
    ].includes(section) &&
    segments.length > 1
  )
    notFound();
  if (
    [
      'reviews',
      'results',
      'assignments',
      'questions',
      'settings',
      'classes',
      'announcements',
    ].includes(section) &&
    segments.length > 2
  )
    notFound();
  const organizations =
    area === 'admin'
      ? ['schools', 'users', 'organization', 'classes', 'imports', 'delivery']
      : area === 'school'
        ? [
            'dashboard',
            'users',
            'teachers',
            'students',
            'organization',
            'classes',
            'imports',
            'delivery',
          ]
        : area === 'teacher'
          ? ['classes', 'students', 'imports', 'delivery']
          : [];
  if (organizations.includes(section)) return organizationWorkspace(a, area, segments, search);
  if (section === 'profile') return <ProfileView actor={a} />;
  if (section === 'notifications')
    return (
      <>
        <PageTitle title="通知中心" description="查看作业提醒、成绩动态和公告。" />
        <NotificationCenter realm={area === 'student' ? 'STUDENT' : 'STAFF'} />
      </>
    );
  if (section === 'announcements')
    return AnnouncementsView({ a, area, segment: segments[1], cursor: search.before });
  if (area === 'admin' && section === 'questions' && search.choose)
    return ChooseSchool({ a, path: '/admin/questions', title: '学校题库', search });
  if (area === 'admin' && section === 'assignments' && (!search.schoolId || search.choose))
    return ChooseSchool({ a, path: '/admin/' + segments.join('/'), title: '学校作业', search });
  let view: React.ReactNode;
  if (area === 'school') {
    requireRole(a, 'SCHOOL_ADMIN');
    if (section === 'assignments')
      view =
        segments[1] === 'new'
          ? await NewAssignment({ a })
          : segments[1]
            ? await AssignmentDetails({ a, id: segments[1] })
            : await AssignmentList({ a, area, search });
    else if (section === 'questions') view = await QuestionsView({ a, segments });
    else notFound();
  } else if (area === 'student') {
    requireRole(a, 'STUDENT');
    if (section === 'dashboard') view = await StudentDashboard({ a });
    else if (section === 'classes') view = await StudentClasses({ a, id: segments[1], search });
    else if (section === 'assignments')
      view = segments[1]
        ? await AssignmentDetails({ a, id: segments[1] })
        : await AssignmentList({ a, area, search });
    else if (section === 'results' && segments[1]) view = await ResultView({ a, id: segments[1] });
    else if (section === 'selftests') view = await SelfTests({ a, segments });
    else if (section === 'errors') view = await ErrorBook({ a, segments });
    else notFound();
  } else if (area === 'teacher') {
    requireRole(a, 'TEACHER', 'TEACHING_ASSISTANT');
    if (section === 'dashboard') view = await TeacherDashboard({ a });
    else if (section === 'questions') view = await QuestionsView({ a, segments });
    else if (section === 'assignments')
      view =
        segments[1] === 'new'
          ? await NewAssignment({ a })
          : segments[1]
            ? await AssignmentDetails({ a, id: segments[1] })
            : await AssignmentList({ a, area, search });
    else if (section === 'reviews')
      view = segments[1] ? await ResultView({ a, id: segments[1] }) : await ReviewsView({ a });
    else if (section === 'analytics') view = await AnalyticsView({ a });
    else notFound();
  } else {
    requireRole(a, 'ADMIN', 'PLATFORM_OPERATOR');
    if (section === 'dashboard') view = await AdminDashboard({ a });
    else if (section === 'mail') redirect('/admin/settings/mail');
    else if (section === 'settings' && !segments[1]) redirect('/admin/settings/site');
    else if (section === 'settings' && ['site', 'mail'].includes(segments[1]))
      view = <SystemSettings section={segments[1] === 'mail' ? 'mail' : 'site'} />;
    else if (section === 'assignments')
      view =
        segments[1] === 'new'
          ? await NewAssignment({ a, selectedSchool: search.schoolId })
          : segments[1]
            ? await AssignmentDetails({ a, id: segments[1], selectedSchool: search.schoolId })
            : await AssignmentList({ a, area: 'admin', search });
    else if (section === 'questions')
      view = await QuestionsView({ a, segments, selectedSchool: search.schoolId });
    else if (section === 'models') view = await ModelsView({ a, search });
    else if (section === 'jobs') view = await JobsView({ a, search });
    else if (section === 'audit') view = await AuditView({ a });
    else if (section === 'system') view = await SystemView({ a });
    else notFound();
  }

  return view;
}
