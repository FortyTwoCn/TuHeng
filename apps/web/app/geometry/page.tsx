import { actor } from '../../lib/auth';
import { GeometryWorkspace } from '../../components/GeometryWorkspace';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { AuthRealm } from '@tuheng/contracts';
import { DomainError } from '@tuheng/domain';
export default async function GeometryPage({
  searchParams,
}: {
  searchParams: Promise<{ realm?: string }>;
}) {
  const { realm } = await searchParams;
  const explicit = AuthRealm.safeParse(realm?.toUpperCase());
  let chooseRealm = false;
  try {
    const a = await actor(explicit.success ? explicit.data : undefined, true);
    if (a.onboarding) redirect(`/onboarding/${a.realm?.toLowerCase()}`);
  } catch (error) {
    if (error instanceof DomainError && error.code === 'SELECT_AUTH_REALM') chooseRealm = true;
    else if (error instanceof DomainError && error.status === 401)
      redirect(
        '/login?callbackUrl=' +
          encodeURIComponent(explicit.success ? '/geometry?realm=' + explicit.data : '/geometry'),
      );
    else throw error;
  }
  if (chooseRealm)
    return (
      <main className="identity-entry">
        <h1>选择作图身份</h1>
        <p>当前浏览器同时登录了两个身份，请选择本次使用的身份。</p>
        <div className="identity-inline">
          <Link className="button" href="/geometry?realm=STUDENT">
            学生作图
          </Link>
          <Link className="button" href="/geometry?realm=STAFF">
            教师与管理作图
          </Link>
        </div>
      </main>
    );
  return (
    <main className="cad-standalone" aria-label="独立几何作图">
      <GeometryWorkspace />
    </main>
  );
}
