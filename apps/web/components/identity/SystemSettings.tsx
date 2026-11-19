import Link from 'next/link';
import { PageTitle } from '@tuheng/ui';
import { SMTPSettings } from './SMTPSettings';
import { SiteSettings } from './SiteSettings';
import { TeachingMailSummary } from './TeachingMailSummary';

export const settingSections = [
  {
    key: 'site',
    title: '网站信息',
    description: '页面底部的备案信息',
    role: 'SITE_ADMIN',
    href: '/admin/settings/site',
  },
  {
    key: 'mail',
    title: '邮件服务',
    description: '验证码、账号安全与教学通知的发送配置',
    role: 'SITE_ADMIN',
    href: '/admin/settings/mail',
  },
] as const;

export function SystemSettings({ section = 'site' }: { section?: 'site' | 'mail' }) {
  return (
    <section className="system-settings">
      <PageTitle
        eyebrow="平台管理"
        title="系统设置"
        description="管理平台级配置。设置变更与历史版本分别保留。"
      />
      <nav className="identity-tabs" aria-label="系统设置分类">
        {settingSections.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            className="button secondary"
            aria-current={section === item.key ? 'page' : undefined}
          >
            {item.title}
          </Link>
        ))}
      </nav>
      {section === 'site' ? (
        <SiteSettings />
      ) : (
        <>
          <SMTPSettings />
          <TeachingMailSummary />
        </>
      )}
    </section>
  );
}
