import { redirect } from 'next/navigation';
import { actor } from '../lib/auth';
import { hasRole } from '@tuheng/domain';
export default async function Home() {
  let a;
  try {
    a = await actor();
  } catch {
    redirect('/login');
  }
  redirect(
    hasRole(a, 'TEACHER', 'TEACHING_ASSISTANT')
      ? '/teacher/dashboard'
      : hasRole(a, 'ADMIN', 'PLATFORM_OPERATOR')
        ? '/admin/dashboard'
        : '/student/dashboard',
  );
}
