import Link from 'next/link';
import {
  BookOpen,
  Building2,
  CalendarDays,
  ChevronRight,
  GraduationCap,
  Info,
  SearchX,
  Users,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { School } from '../identity/organization-types';

/** Presentation only: callers supply authorized records, links and commands. */
export function OrganizationPanel({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section className="org-panel">
      <header className="org-panel-heading">
        <h2>{title}</h2>
        {count !== undefined && <span className="org-count">{count} 条记录</span>}
      </header>
      {children}
    </section>
  );
}

export function OrganizationStages({
  stage,
  coursesHref,
  offeringsHref,
}: {
  stage: 'courses' | 'offerings' | 'classes';
  coursesHref?: string;
  offeringsHref?: string;
}) {
  return (
    <nav className="org-stages" aria-label="课程层级">
      {(
        [
          ['courses', '课程', BookOpen, coursesHref],
          ['offerings', '开课学期', CalendarDays, offeringsHref],
          ['classes', '教学班', Users, undefined],
        ] as const
      ).map(([id, label, Icon, url], index) => (
        <div key={id} data-current={id === stage}>
          {index > 0 && (
            <ChevronRight className="org-stage-separator" size={15} aria-hidden="true" />
          )}
          {url && id !== stage ? (
            <Link href={url}>
              <Icon size={17} aria-hidden="true" />
              {label}
            </Link>
          ) : (
            <span aria-current={id === stage ? 'step' : undefined}>
              <Icon size={17} aria-hidden="true" />
              {label}
            </span>
          )}
        </div>
      ))}
    </nav>
  );
}

export function RecordHeading({ title, context }: { title: string; context: string }) {
  return (
    <div className="org-record-heading" aria-hidden="true">
      <span>{title}</span>
      <span>{context}</span>
      <span>状态</span>
      <span>操作</span>
    </div>
  );
}

export function OrganizationRecord({
  href,
  title,
  subtitle,
  context,
  archived,
  action,
  kind,
}: {
  href: string;
  title: string;
  subtitle?: ReactNode;
  context: ReactNode;
  archived: boolean;
  action: string;
  kind: 'course' | 'offering' | 'class';
}) {
  const Icon = kind === 'course' ? BookOpen : kind === 'offering' ? CalendarDays : Users;
  return (
    <Link href={href} className="org-record">
      <span className="org-record-title">
        <span className="org-record-icon">
          <Icon size={21} aria-hidden="true" />
        </span>
        <span>
          <strong>{title}</strong>
          {subtitle && <small>{subtitle}</small>}
        </span>
      </span>
      <span className="org-record-context">{context}</span>
      <span className={'org-status' + (archived ? ' is-archived' : '')}>
        {archived ? '已归档' : '可用'}
      </span>
      <span className="org-record-action">
        {action}
        <ChevronRight size={16} aria-hidden="true" />
      </span>
    </Link>
  );
}

export function OrganizationHint({ children }: { children: ReactNode }) {
  return (
    <p className="org-hint">
      <Info size={17} aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

export function OrganizationEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="org-empty">
      <SearchX size={28} aria-hidden="true" />
      <p>{children}</p>
    </div>
  );
}

export function SchoolChoice({
  school,
  href,
  action,
}: {
  school: Pick<School, 'name' | 'code' | 'active' | 'counts'>;
  href: string;
  action: string;
}) {
  const content = (
    <>
      <div className="org-school-card-top">
        <span className="org-school-icon">
          <Building2 size={24} aria-hidden="true" />
        </span>
        <span className={'org-status' + (school.active ? '' : ' is-archived')}>
          {school.active ? '已启用' : '已停用'}
        </span>
      </div>
      <h3>{school.name}</h3>
      <p className="org-school-number">
        学校编号 <span>{school.code}</span>
      </p>
      <div className="org-school-people">
        <span>
          <GraduationCap size={16} aria-hidden="true" />
          教师账号<strong>{school.counts.teachers}</strong>
        </span>
        <span>
          <Users size={16} aria-hidden="true" />
          学生账号<strong>{school.counts.students}</strong>
        </span>
      </div>
      <span className="org-school-card-action">
        {school.active ? (
          <>
            {action}
            <ChevronRight size={18} aria-hidden="true" />
          </>
        ) : (
          '请先在学校管理中启用此学校'
        )}
      </span>
    </>
  );
  return school.active ? (
    <Link className="org-school-card" href={href}>
      {content}
    </Link>
  ) : (
    <article className="org-school-card" data-disabled="true" aria-label={school.name}>
      {content}
    </article>
  );
}
