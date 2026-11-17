import type { AccountKind, AuthRealm } from '@tuheng/contracts';

const areas: Record<AccountKind, string> = {
  STUDENT: 'student',
  TEACHER: 'teacher',
  SCHOOL_ADMIN: 'school',
  SITE_ADMIN: 'admin',
};
export function safeReturnPath(value?: string | null, kind?: AccountKind) {
  if (
    !value ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    /[\\\s\u0000-\u001f]/.test(value)
  )
    return undefined;
  const url = new URL(value, 'https://tuheng.invalid');
  if (url.origin !== 'https://tuheng.invalid') return undefined;
  if (/^\/geometry(?:\/|$)/.test(url.pathname)) return url.pathname + url.search + url.hash;
  const match = url.pathname.match(/^\/(student|teacher|school|admin)\//);
  if (!match || (kind && match[1] !== areas[kind])) return undefined;
  return url.pathname + url.search + url.hash;
}
export function loginEntryUrl(realm: AuthRealm, callback?: string) {
  const params = new URLSearchParams({ realm: realm.toLowerCase() });
  const safe = safeReturnPath(callback);
  if (safe) params.set('callbackUrl', safe);
  return '/login?' + params;
}
export function loginDestination(kind: AccountKind, callback?: string | null) {
  return safeReturnPath(callback, kind) ?? `/${areas[kind]}/dashboard`;
}
