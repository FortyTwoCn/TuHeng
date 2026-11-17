import { notFound, redirect } from 'next/navigation';
import { actor } from '../../../lib/auth';
import { AccountSetup } from '../../../components/identity/AccountSetup';
export default async function Onboarding({ params }: { params: Promise<{ realm: string }> }) {
  const { realm } = await params;
  if (!['student', 'staff'].includes(realm)) notFound();
  const domain = realm === 'student' ? 'STUDENT' : 'STAFF';
  const current = await actor(domain, true).catch(() => redirect('/login/' + realm));
  if (current.kind === 'SITE_ADMIN' && !current.onboarding) redirect('/admin/dashboard');
  return <AccountSetup realm={domain} />;
}
