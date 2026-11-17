import Link from 'next/link';
import { PageTitle } from '@tuheng/ui';
import { SMTPSettings } from './SMTPSettings';

export const settingSections = [
  {
    key: 'mail',
    title: '邮件服务',
    description: '验证码与账号通知的发送配置',
    role: 'SITE_ADMIN',
    href: '/admin/settings/mail',
  },
] as const;

export function SystemSettings() {
  return (
    <section className="system-settings">
      <PageTitle
        eyebrow="平台管理"
        title="系统设置"
        description="管理平台级配置。设置变更与历史版本分别保留。"
      />
      <nav className="identity-tabs" aria-label="系统设置分类">
        {settingSections.map((section) => (
          <Link
            key={section.key}
            href={section.href}
            className="button secondary"
            aria-current="page"
          >
            {section.title}
          </Link>
        ))}
      </nav>
      <SMTPSettings />
    </section>
  );
}
