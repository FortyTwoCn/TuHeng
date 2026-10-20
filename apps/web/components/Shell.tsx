import Link from 'next/link';
import {
  Compass,
  LayoutDashboard,
  ClipboardList,
  BookOpen,
  BookMarked,
  Users,
  Layers,
  ScanLine,
  Settings2,
  Activity,
  ShieldCheck,
  ChevronRight,
} from 'lucide-react';
import type { Actor } from '@tuheng/domain';
import { hasRole } from '@tuheng/domain';
import { Logout } from './Actions';
const menus = {
  student: [
    ['dashboard', '学习概览', LayoutDashboard],
    ['assignments', '作业管理', ClipboardList],
    ['selftests', '自测本', BookOpen],
    ['errors', '错题本', BookMarked],
  ],
  teacher: [
    ['dashboard', '教学工作台', LayoutDashboard],
    ['classes', '教学班', Users],
    ['questions', '题库管理', Layers],
    ['assignments', '作业管理', ClipboardList],
    ['reviews', '批改复核', ScanLine],
    ['analytics', '基础学情', Activity],
  ],
  admin: [
    ['dashboard', '管理概览', LayoutDashboard],
    ['users', '用户管理', Users],
    ['organization', '课程与教学组织', Layers],
    ['models', 'AI 模型配置', Settings2],
    ['jobs', 'AI 任务管理', Activity],
    ['audit', '操作审计', ShieldCheck],
    ['system', '系统状态', Settings2],
  ],
} as const;
export function Shell({
  a,
  area,
  current,
  children,
}: {
  a: Actor;
  area: 'student' | 'teacher' | 'admin';
  current: string;
  children: React.ReactNode;
}) {
  const menu = menus[area];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/">
          <span className="brand-mark">
            <Compass size={27} />
          </span>
          <span>
            图衡<small>TuHeng</small>
          </span>
        </Link>
        <p className="workspace-label">
          {area === 'student'
            ? '学习工作空间'
            : area === 'teacher'
              ? '教师工作空间'
              : '平台管理空间'}
        </p>
        <nav aria-label="主导航">
          {menu.map(([path, label, Icon]) => (
            <Link href={`/${area}/${path}`} className={current === path ? 'active' : ''} key={path}>
              <Icon size={19} />
              <span>{label}</span>
              {current === path && <i />}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="assistant-note">
            <span>◇</span>
            <strong>有据可循的学习反馈</strong>
            <p>AI 辅助分析，教师确认成绩。每一次修改都保留记录。</p>
          </div>
          <div className="account">
            <span className="avatar">{a.name.slice(0, 1)}</span>
            <span>
              <b>{a.name}</b>
              <small>
                {area === 'student' ? '学生' : area === 'teacher' ? '教师' : '系统管理员'}
              </small>
            </span>
            <Logout />
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <span>图衡教学平台</span>
            <ChevronRight size={14} />
            <strong>{menu.find((m) => m[0] === current)?.[1] ?? '工作空间'}</strong>
          </div>
          <div className="topbar-right">
            <span className="term">工程图学 · 教学空间</span>
            <details className="role-switch">
              <summary>切换身份</summary>
              <div>
                {hasRole(a, 'STUDENT') && <Link href="/student/dashboard">学生空间</Link>}
                {hasRole(a, 'TEACHER', 'TEACHING_ASSISTANT') && (
                  <Link href="/teacher/dashboard">教师空间</Link>
                )}
                {hasRole(a, 'ADMIN', 'PLATFORM_OPERATOR') && (
                  <Link href="/admin/dashboard">管理空间</Link>
                )}
              </div>
            </details>
            <span className="avatar small-avatar">{a.name.slice(0, 1)}</span>
          </div>
        </header>
        <main className="workspace">
          {children}
          <footer>
            图衡 TuHeng <span>以几何理解为本，以作答证据为据。</span>
          </footer>
        </main>
      </div>
      <nav className="mobile-nav" aria-label="移动端主导航">
        {menu.slice(0, area === 'student' ? 4 : 5).map(([path, label, Icon]) => (
          <Link className={current === path ? 'active' : ''} href={`/${area}/${path}`} key={path}>
            <Icon size={21} />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
