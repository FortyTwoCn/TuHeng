import type { Metadata } from 'next';
import './globals.css';
import '../components/identity/organization.css';
import '../components/identity/configuration.css';
import '../components/identity/jobs.css';
export const metadata: Metadata = {
  title: '图衡 · 智能工程图学教学平台',
  description: '让每一次作图都有据可循。工程图学作业、教师复核与自主练习。',
  icons: { icon: { url: '/brand/tuheng-logo.svg', type: 'image/svg+xml', sizes: 'any' } },
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
