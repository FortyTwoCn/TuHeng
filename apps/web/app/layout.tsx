import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: '图衡 · 智能工程图学教学平台',
  description: '让每一次作图都有据可循。工程图学作业、教师复核与自主练习。',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
