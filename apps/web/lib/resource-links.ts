import type { AuthRealm } from '@tuheng/contracts';

export function assetHref(id: string, realm: AuthRealm) {
  return `/api/assets/${encodeURIComponent(id)}?realm=${realm}`;
}
export function avatarHref(version: string, realm: AuthRealm, size: 'small' | 'large') {
  return '/api/profile/avatar?' + new URLSearchParams({ realm, version, size });
}
