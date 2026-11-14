import { actor } from '../../lib/auth';
import { GeometryWorkspace } from '../../components/GeometryWorkspace';
export default async function GeometryPage() {
  await actor();
  return (
    <main style={{ maxWidth: 1200, margin: '0 auto', padding: 16 }}>
      <h1>几何作图</h1>
      <p>独立作图可导出 JSON 保存，在作业页面中使用编辑器可保存到作业草稿。</p>
      <GeometryWorkspace />
    </main>
  );
}
