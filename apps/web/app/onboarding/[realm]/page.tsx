import { notFound, redirect } from 'next/navigation';
import { actor } from '../../../lib/auth';
import { AccountSetup } from '../../../components/identity/AccountSetup';
export default async function Onboarding({ params }: { params: Promise<{ realm: string }> }) {
  const { realm } = await params;
  if (!['student', 'staff'].includes(realm)) notFound();
  const domain = realm === 'student' ? 'STUDENT' : 'STAFF';
  try {
    await actor(domain, true);
  } catch {
    redirect('/login/' + realm);
  }
  return <AccountSetup realm={domain} />;
}
