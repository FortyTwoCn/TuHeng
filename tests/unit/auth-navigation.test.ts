import { describe, expect, it } from 'vitest';
import {
  loginDestination,
  loginEntryUrl,
  safeReturnPath,
} from '../../apps/web/components/identity/auth-navigation';

describe('unified login return paths', () => {
  it('keeps geometry and same-role routes, falling back for another role', () => {
    expect(loginDestination('STUDENT', '/geometry?mode=vhw')).toBe('/geometry?mode=vhw');
    expect(loginDestination('TEACHER', '/teacher/classes?page=2')).toBe('/teacher/classes?page=2');
    expect(loginDestination('STUDENT', '/admin/dashboard')).toBe('/student/dashboard');
    expect(loginDestination('SITE_ADMIN', '/student/dashboard')).toBe('/admin/dashboard');
  });
  it.each([
    'https://evil.invalid',
    '//evil.invalid',
    '/\\evil.invalid',
    '/login',
    '/admin/../../login',
    '/geometry\n',
    '/geometryx',
    '/%2f%2fevil.invalid',
  ])('rejects unsafe or unsupported return path %j', (path) => {
    expect(safeReturnPath(path)).toBeUndefined();
  });
  it('preserves a validated callback through a legacy entry', () => {
    expect(loginEntryUrl('STAFF', '/geometry')).toBe('/login?realm=staff&callbackUrl=%2Fgeometry');
    expect(loginEntryUrl('STUDENT', '//evil.invalid')).toBe('/login?realm=student');
  });
});
