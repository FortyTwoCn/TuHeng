import { afterEach, expect, it, vi } from 'vitest';
import { checkOrigin } from '../../apps/web/lib/http';
import { allowedAppOrigins, appAuthRedirect } from '../../apps/web/lib/app-origins';

afterEach(() => vi.unstubAllEnvs());
it('accepts an explicitly configured LAN origin and keeps canonical localhost working', () => {
  vi.stubEnv('NEXTAUTH_URL', 'http://localhost:3000');
  vi.stubEnv('APP_ALLOWED_ORIGINS', 'http://192.168.0.35:3000');
  for (const origin of ['http://localhost:3000', 'http://192.168.0.35:3000']) {
    expect(() =>
      checkOrigin(new Request(origin + '/api/actions/saveDraft', { headers: { origin } })),
    ).not.toThrow();
  }
});

it('does not infer trusted origins from request or forwarded headers', () => {
  vi.stubEnv('NEXTAUTH_URL', 'http://localhost:3000');
  vi.stubEnv('APP_ALLOWED_ORIGINS', '');
  expect(() =>
    checkOrigin(
      new Request('http://evil.invalid/api/actions/saveDraft', {
        headers: {
          origin: 'http://evil.invalid',
          host: 'evil.invalid',
          'x-forwarded-host': 'evil.invalid',
        },
      }),
    ),
  ).toThrow('INVALID_ORIGIN');
  expect(() => checkOrigin(new Request('http://localhost:3000/api/actions/saveDraft'))).toThrow(
    'INVALID_ORIGIN',
  );
});

it('keeps login/logout on configured LAN aliases without permitting open redirects', () => {
  vi.stubEnv('NEXTAUTH_URL', 'http://localhost:3000');
  vi.stubEnv('APP_ALLOWED_ORIGINS', 'http://192.168.0.35:3000, https://tuheng.example.test');
  const base = 'http://localhost:3000';
  expect(appAuthRedirect('http://192.168.0.35:3000/login', base)).toBe(
    'http://192.168.0.35:3000/login',
  );
  expect(appAuthRedirect('/geometry?view=V', base)).toBe(base + '/geometry?view=V');
  for (const url of [
    'https://evil.invalid',
    '//evil.invalid',
    '/\\evil.invalid',
    'javascript:alert(1)',
    'http://192.168.0.35:3001/login',
    'http://user:password@192.168.0.35:3000/login',
  ]) {
    expect(appAuthRedirect(url, base)).toBe(base);
  }
});

it('normalizes and deduplicates explicit aliases', () => {
  vi.stubEnv('NEXTAUTH_URL', 'http://localhost:3000');
  vi.stubEnv('APP_ALLOWED_ORIGINS', ' http://192.168.0.35:3000/ , http://192.168.0.35:3000, ');
  expect(allowedAppOrigins()).toEqual(['http://localhost:3000', 'http://192.168.0.35:3000']);
});

it.each([
  '*',
  'http://*.example.test',
  'http://user:secret@example.test',
  'http://example.test/path',
  'javascript:alert(1)',
])('fails closed for invalid origin configuration %s', (value) => {
  vi.stubEnv('NEXTAUTH_URL', 'http://localhost:3000');
  vi.stubEnv('APP_ALLOWED_ORIGINS', value);
  expect(allowedAppOrigins).toThrow('Invalid APP_ALLOWED_ORIGINS configuration');
});
it.each([
  'https://evil.invalid',
  'http://192.168.0.35:3001',
  'null',
  'http://192.168.0.35.evil.invalid:3000',
])('refuses untrusted origin %s', (origin) => {
  vi.stubEnv('NEXTAUTH_URL', 'http://localhost:3000');
  vi.stubEnv('APP_ALLOWED_ORIGINS', 'http://192.168.0.35:3000');
  expect(() =>
    checkOrigin(
      new Request('http://192.168.0.35:3000/api/actions/saveDraft', { headers: { origin } }),
    ),
  ).toThrow('INVALID_ORIGIN');
});
