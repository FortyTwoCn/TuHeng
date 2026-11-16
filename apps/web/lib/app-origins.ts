/** Explicit application aliases; never infer trust from Host or forwarded headers. */
export function allowedAppOrigins() {
  const canonical = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
  const aliases = (process.env.APP_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return [
    ...new Set(
      [canonical, ...aliases].map((value, index) => {
        try {
          const url = new URL(value);
          if (
            !['http:', 'https:'].includes(url.protocol) ||
            url.username ||
            url.password ||
            url.hostname.includes('*') ||
            url.search ||
            url.hash ||
            (index > 0 && url.pathname !== '/')
          )
            throw new Error();
          return url.origin;
        } catch {
          throw new Error(
            `Invalid ${index === 0 ? 'NEXTAUTH_URL' : 'APP_ALLOWED_ORIGINS'} configuration`,
          );
        }
      }),
    ),
  ];
}

export function appAuthRedirect(url: string, baseUrl: string) {
  const fallback = new URL(baseUrl).origin;
  try {
    const target = new URL(url, fallback);
    if (url.startsWith('//') || url.includes('\\') || target.username || target.password)
      return fallback;
    return allowedAppOrigins().includes(target.origin) ? target.href : fallback;
  } catch {
    return fallback;
  }
}
