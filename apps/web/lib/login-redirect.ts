export function loginReturnPath(value: string | null, origin: string): string {
  try {
    const target = new URL(value || '/', origin);
    if (
      target.origin !== origin ||
      target.pathname.startsWith('//') ||
      target.pathname === '/login'
    )
      return '/';
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return '/';
  }
}
