import Link from 'next/link';
import {
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
  Megaphone,
} from 'lucide-react';
import type { Actor } from '@tuheng/domain';
import { prisma } from '@tuheng/database';
import { Logout } from './Actions';
import { BrandLogo } from './BrandLogo';
import { MobileNavigation } from './MobileNavigation';
import { AccountAvatar } from './profile/AccountAvatar';
import { NotificationBell } from './notifications/NotificationBell';
import './profile/account.css';
const menus = {
  student: [
    ['dashboard', '学习概览', LayoutDashboard],
    ['assignments', '作业管理', ClipboardList],
    ['selftests', '自测本', BookOpen],
    ['errors', '错题本', BookMarked],
  ],
  teacher: [
    ['dashboard', '教学工作台', LayoutDashboard],
    ['classes', '我的教学班', Users],
    ['imports', '名单导入与交付', BookOpen],
    ['questions', '题库管理', Layers],
    ['assignments', '作业管理', ClipboardList],
    ['reviews', '批改复核', ScanLine],
    ['announcements', '公告管理', Megaphone],
    ['analytics', '基础学情', Activity],
  ],
  school: [
    ['dashboard', '学校概览', LayoutDashboard],
    ['users', '人员管理', Users],
    ['organization', '课程与开课学期', Layers],
    ['classes', '教学班及成员', Layers],
    ['questions', '题库', Layers],
    ['assignments', '校级作业', ClipboardList],
    ['imports', '导入与交付', BookOpen],
    ['announcements', '公告管理', Megaphone],
  ],
  admin: [
    ['dashboard', '管理概览', LayoutDashboard],
    ['schools', '学校管理', BookOpen],
    ['users', '用户管理', Users],
    ['organization', '课程与教学组织', Layers],
    ['classes', '教学班及成员', Users],
    ['imports', '名单导入与交付', BookOpen],
    ['questions', '题库', Layers],
    ['assignments', '学校作业', ClipboardList],
    ['announcements', '公告管理', Megaphone],
    ['models', 'AI 中心', Settings2],
    ['jobs', 'AI 任务管理', Activity],
    ['audit', '操作审计', ShieldCheck],
    ['settings', '系统设置', Settings2],
    ['system', '系统状态', Settings2],
  ],
} as const;
export async function Shell({
  a,
  area,
  current,
  schoolId,
  children,
}: {
  a: Actor;
  area: 'student' | 'teacher' | 'admin' | 'school';
  current: string;
  schoolId?: string;
  children: React.ReactNode;
}) {
  const menu = menus[area];
  const realm = a.realm ?? (area === 'student' ? 'STUDENT' : 'STAFF');
  const account = await prisma.user.findUnique({
    where: { id: a.id },
    select: { avatarAssetId: true },
  });
  const profileHref = `/${area}/profile`;
  const notificationsHref = `/${area}/notifications`;
  const sectionLabel =
    { profile: '用户中心', notifications: '通知中心', announcements: '公告' }[current] ??
    menu.find((m) => m[0] === current)?.[1] ??
    '工作空间';
  const link = (path: string) =>
    '/' +
    area +
    '/' +
    path +
    (schoolId &&
    [
      'users',
      'organization',
      'classes',
      'assignments',
      'imports',
      'delivery',
      'questions',
    ].includes(path)
      ? '?schoolId=' + encodeURIComponent(schoolId)
      : '');
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/">
          <BrandLogo />
          <span>
            图衡<small>TuHeng</small>
          </span>
        </Link>
        <p className="workspace-label">
          {area === 'student'
            ? '学习工作空间'
            : area === 'teacher'
              ? '教师工作空间'
              : area === 'school'
                ? '学校管理空间'
                : '平台管理空间'}
        </p>
        <nav aria-label="主导航">
          {menu.map(([path, label, Icon]) => (
            <Link href={link(path)} className={current === path ? 'active' : ''} key={path}>
              <Icon size={19} />
              <span>{label}</span>
              {current === path && <i />}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="account">
            <Link href={profileHref} className="sidebar-profile" aria-label="用户中心">
              <AccountAvatar name={a.name} realm={realm} version={account?.avatarAssetId} />
              <span>
                <b>{a.name}</b>
                <small>
                  {area === 'student'
                    ? '学生'
                    : area === 'teacher'
                      ? '教师'
                      : area === 'school'
                        ? '学校管理员'
                        : '系统管理员'}
                </small>
              </span>
            </Link>
            <Logout realm={realm} />
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <span>图衡教学平台</span>
            <ChevronRight size={14} />
            <strong>{sectionLabel}</strong>
          </div>
          <div className="topbar-right">
            <span className="term">工程图学 · 教学空间</span>
            <Link className="topbar-switch" href="/login">
              其他身份登录
            </Link>
            <NotificationBell key={realm + ':' + a.id} realm={realm} href={notificationsHref} />
            <Link
              href={profileHref}
              className="topbar-control topbar-profile"
              aria-label="用户中心"
            >
              <AccountAvatar name={a.name} realm={realm} version={account?.avatarAssetId} />
            </Link>
          </div>
        </header>
        <main className="workspace">{children}</main>
      </div>
      <nav className="mobile-nav" aria-label="移动端主导航">
        {menu.slice(0, 4).map(([path, label, Icon]) => (
          <Link className={current === path ? 'active' : ''} href={link(path)} key={path}>
            <Icon size={21} />
            <span>{label}</span>
          </Link>
        ))}
        <MobileNavigation
          items={[
            ...menu.slice(4).map(([path, label]) => ({
              href: link(path),
              label,
              active: current === path,
            })),
            { href: profileHref, label: '用户中心', active: current === 'profile' },
            { href: notificationsHref, label: '通知中心', active: current === 'notifications' },
            { href: '/login', label: '其他身份登录', active: false },
          ]}
          realm={realm}
        />
      </nav>
    </div>
  );
}
