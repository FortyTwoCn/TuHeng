import { notFound } from 'next/navigation';
import { LoginPanel } from '../../../components/identity/LoginPanel';
export default async function LoginPage({ params }: { params: Promise<{ realm: string }> }) {
  const { realm } = await params;
  if (realm !== 'student' && realm !== 'staff') notFound();
  return <LoginPanel realm={realm === 'student' ? 'STUDENT' : 'STAFF'} />;
}
