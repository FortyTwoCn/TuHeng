'use client';
import type { AuthRealm, NotificationPage } from '@tuheng/contracts';
import { identityRequest } from '../identity/client';

export const notificationChange = 'tuheng-notification-change';
export async function loadNotifications(
  realm: AuthRealm,
  query: URLSearchParams,
  signal?: AbortSignal,
): Promise<NotificationPage> {
  return identityRequest('/api/notifications?' + query, undefined, realm, signal);
}
export async function markRead(realm: AuthRealm, scope: { ids: string[] } | { through: string }) {
  await identityRequest('/api/notifications', scope, realm);
  window.dispatchEvent(new CustomEvent(notificationChange, { detail: realm }));
}
