import { notFound, redirect } from 'next/navigation';
import { actor } from '../../../lib/auth';
import { AccountSetup } from '../../../components/identity/AccountSetup';
import {
  loginDestination,
  loginEntryUrl,
  safeReturnPath,
} from '../../../components/identity/auth-navigation';
export default async function Onboarding({
  params,
  searchParams,
}: {
  params: Promise<{ realm: string }>;
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { realm } = await params;
  if (!['student', 'staff'].includes(realm)) notFound();
  const domain = realm === 'student' ? 'STUDENT' : 'STAFF';
  const callback = safeReturnPath((await searchParams).callbackUrl);
  const current = await actor(domain, true).catch(() => redirect(loginEntryUrl(domain, callback)));
  if (current.kind === 'SITE_ADMIN' && !current.onboarding)
    redirect(loginDestination(current.kind, callback));
  return <AccountSetup realm={domain} callback={callback} />;
}
