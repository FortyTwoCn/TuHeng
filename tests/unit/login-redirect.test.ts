import { describe, expect, it } from 'vitest';
import { loginReturnPath } from '../../apps/web/lib/login-redirect';

describe('login return navigation', () => {
  it('preserves internal destinations and defaults to the role-aware home page', () => {
    expect(loginReturnPath(null, 'http://localhost:3000')).toBe('/');
    expect(loginReturnPath('/geometry?view=V#canvas', 'http://localhost:3000')).toBe(
      '/geometry?view=V#canvas',
    );
    expect(loginReturnPath('http://localhost:3000/geometry', 'http://localhost:3000')).toBe(
      '/geometry',
    );
  });
  it.each([
    'https://example.invalid/geometry',
    '//example.invalid/geometry',
    '/\\example.invalid/geometry',
    'http://localhost:3000//example.invalid/geometry',
    'javascript:alert(1)',
    'http://',
    '/login?callbackUrl=/geometry',
  ])('rejects unsafe or looping destinations: %s', (value) => {
    expect(loginReturnPath(value, 'http://localhost:3000')).toBe('/');
  });
});
