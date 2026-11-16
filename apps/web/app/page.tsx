import { redirect } from 'next/navigation';
import { actor } from '../lib/auth';
import { hasRole } from '@tuheng/domain';
export default async function Home() {
  let a;
  try {
    a = await actor(undefined, true);
  } catch {
    redirect('/login');
  }
  if (a.onboarding) redirect(`/onboarding/${a.realm?.toLowerCase()}`);
  if (a.kind === 'SCHOOL_ADMIN') redirect('/school/dashboard');
  redirect(
    hasRole(a, 'TEACHER', 'TEACHING_ASSISTANT')
      ? '/teacher/dashboard'
      : hasRole(a, 'ADMIN', 'PLATFORM_OPERATOR')
        ? '/admin/dashboard'
        : '/student/dashboard',
  );
}
