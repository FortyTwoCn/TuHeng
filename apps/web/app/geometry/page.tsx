import { actor } from '../../lib/auth';
import { GeometryWorkspace } from '../../components/GeometryWorkspace';
import { redirect } from 'next/navigation';
import { DomainError } from '@tuheng/domain';
export default async function GeometryPage() {
  try {
    const a = await actor(undefined, true);
    if (a.onboarding) redirect(`/onboarding/${a.realm?.toLowerCase()}`);
  } catch (error) {
    if (error instanceof DomainError && error.status === 401)
      redirect('/login?callbackUrl=%2Fgeometry');
    throw error;
  }
  return (
    <main style={{ maxWidth: 1200, margin: '0 auto', padding: 16 }}>
      <h1>几何作图</h1>
      <p>独立作图可导出 JSON 保存，在作业页面中使用编辑器可保存到作业草稿。</p>
      <GeometryWorkspace />
    </main>
  );
}
