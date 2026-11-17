import { UnifiedLogin } from '../../components/identity/UnifiedLogin';
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { realm } = await searchParams;
  return <UnifiedLogin initialRealm={realm === 'staff' ? 'STAFF' : 'STUDENT'} />;
}
