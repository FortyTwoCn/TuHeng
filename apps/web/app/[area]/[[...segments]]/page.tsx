import { redirect, notFound } from 'next/navigation';
import { actor } from '../../../lib/auth';
import { OrganizationConsole } from '../../../components/identity/OrganizationConsole';
import { AccountSetup } from '../../../components/identity/AccountSetup';
import { SystemSettings } from '../../../components/identity/SystemSettings';
import { Shell } from '../../../components/Shell';
import { requireRole, DomainError, type Actor } from '@tuheng/domain';
import { Panel } from '@tuheng/ui';
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
  if (area === 'admin' && ['settings', 'mail'].includes(segments[0]))
    return { title: '系统设置 · 邮件服务 · 图衡' };
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
  let a;
  try {
    a = await actor(area === 'student' ? 'STUDENT' : 'STAFF', true);
    if (a.onboarding) redirect(`/onboarding/${area === 'student' ? 'student' : 'staff'}`);
  } catch (e) {
    if (e instanceof Error && e.message === 'NEXT_REDIRECT') throw e;
    redirect(`/login/${area === 'student' ? 'student' : 'staff'}`);
  }
  const section = segments[0];
  let view: React.ReactNode;
  try {
    view = await workspaceView(a, area, segments, search);
  } catch (e) {
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
  let view: React.ReactNode;
  if (section === 'security')
    view = <AccountSetup realm={area === 'student' ? 'STUDENT' : 'STAFF'} security />;
  else if (area === 'school') {
    requireRole(a, 'SCHOOL_ADMIN');
    if (section === 'assignments')
      view =
        segments[1] === 'new'
          ? await NewAssignment({ a })
          : segments[1]
            ? await AssignmentDetails({ a, id: segments[1] })
            : await AssignmentList({ a, area, search });
    else if (section === 'questions') view = await QuestionsView({ a, segments });
    else
      view = (
        <OrganizationConsole
          identity={{ id: a.id, kind: a.kind!, schoolId: a.schoolId }}
          initial={
            section === 'teachers'
              ? 'teachers'
              : section === 'classes'
                ? 'classes'
                : section === 'imports'
                  ? 'imports'
                  : section === 'delivery'
                    ? 'delivery'
                    : 'students'
          }
        />
      );
  } else if (area === 'student') {
    requireRole(a, 'STUDENT');
    if (section === 'dashboard') view = await StudentDashboard({ a });
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
    else if (['classes', 'students', 'imports', 'delivery'].includes(section))
      view = (
        <OrganizationConsole
          identity={{ id: a.id, kind: a.kind!, schoolId: a.schoolId }}
          initial={section}
        />
      );
    else if (section === 'analytics') view = await AnalyticsView({ a });
    else notFound();
  } else {
    requireRole(a, 'ADMIN', 'PLATFORM_OPERATOR');
    if (section === 'dashboard') view = await AdminDashboard({ a });
    else if (['users', 'organization', 'imports', 'delivery'].includes(section))
      view = (
        <OrganizationConsole
          identity={{ id: a.id, kind: a.kind!, schoolId: a.schoolId }}
          initial={
            section === 'organization' ? 'schools' : section === 'users' ? 'teachers' : section
          }
        />
      );
    else if (section === 'mail' || (section === 'settings' && !segments[1]))
      redirect('/admin/settings/mail');
    else if (section === 'settings' && segments[1] === 'mail') view = <SystemSettings />;
    else if (section === 'assignments')
      view =
        segments[1] === 'new'
          ? await NewAssignment({ a })
          : segments[1]
            ? await AssignmentDetails({ a, id: segments[1] })
            : await AssignmentList({ a, area: 'admin', search });
    else if (section === 'questions') view = await QuestionsView({ a, segments });
    else if (section === 'models') view = await ModelsView({ a, search });
    else if (section === 'jobs') view = await JobsView({ a, search });
    else if (section === 'audit') view = await AuditView({ a });
    else if (section === 'system') view = await SystemView({ a });
    else notFound();
  }

  return view;
}
