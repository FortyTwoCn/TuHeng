import { notFound, redirect } from 'next/navigation';
import { loginEntryUrl } from '../../../components/identity/auth-navigation';
export default async function LegacyLoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ realm: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { realm } = await params;
  if (realm !== 'student' && realm !== 'staff') notFound();
  const { callbackUrl } = await searchParams;
  redirect(
    loginEntryUrl(
      realm === 'student' ? 'STUDENT' : 'STAFF',
      typeof callbackUrl === 'string' ? callbackUrl : undefined,
    ),
  );
}
