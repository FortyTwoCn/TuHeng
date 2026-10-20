import { redirect, notFound } from 'next/navigation';
import { actor } from '../../../lib/auth';
import { Shell } from '../../../components/Shell';
import { requireRole, DomainError } from '@tuheng/domain';
import { Panel } from '@tuheng/ui';
import { StudentDashboard, AssignmentList, SelfTests, ErrorBook } from '../../../views/student';
import { AssignmentDetails } from '../../../views/assignment';
import { ResultView } from '../../../views/result';
import {
  TeacherDashboard,
  QuestionsView,
  NewAssignment,
  ReviewsView,
  ClassesView,
  AnalyticsView,
} from '../../../views/teacher';
import {
  AdminDashboard,
  UsersView,
  OrganizationView,
  ModelsView,
  JobsView,
  AuditView,
  SystemView,
} from '../../../views/admin';
export const dynamic = 'force-dynamic';
export default async function Workspace({
  params,
  searchParams,
}: {
  params: Promise<{ area: string; segments?: string[] }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { area, segments = ['dashboard'] } = await params;
  const search = await searchParams;
  if (!['student', 'teacher', 'admin'].includes(area)) notFound();
  let a;
  try {
    a = await actor();
  } catch {
    redirect('/login');
  }
  const section = segments[0];
  let view: React.ReactNode;
  try {
    if (area === 'student') {
      requireRole(a, 'STUDENT');
      if (section === 'dashboard') view = await StudentDashboard({ a });
      else if (section === 'assignments')
        view = segments[1]
          ? await AssignmentDetails({ a, id: segments[1] })
          : await AssignmentList({ a, area, search });
      else if (section === 'results' && segments[1])
        view = await ResultView({ a, id: segments[1] });
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
      else if (section === 'classes') view = await ClassesView({ a, segments });
      else if (section === 'analytics') view = await AnalyticsView({ a });
      else notFound();
    } else {
      requireRole(a, 'ADMIN', 'PLATFORM_OPERATOR');
      if (section === 'dashboard') view = await AdminDashboard({ a });
      else if (section === 'users') view = await UsersView({ a, search });
      else if (section === 'organization') view = await OrganizationView({ a });
      else if (section === 'models') view = await ModelsView({ a });
      else if (section === 'jobs') view = await JobsView({ a, search });
      else if (section === 'audit') view = await AuditView({ a });
      else if (section === 'system') view = await SystemView({ a });
      else notFound();
    }
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
      area={area as 'student' | 'teacher' | 'admin'}
      current={section === 'results' ? 'assignments' : section}
    >
      {view}
    </Shell>
  );
}
