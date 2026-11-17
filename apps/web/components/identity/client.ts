'use client';
import type { AuthRealm } from '@tuheng/contracts';
const messages: Record<string, string> = {
  SMTP_NOT_CONFIGURED: '邮件服务尚未配置，请联系管理员。',
  SMTP_SEND_FAILED: '验证码发送失败，请稍后重试。',
  INVALID_OR_EXPIRED_CODE: '验证码不正确、已失效或已使用，请重新获取。',
  RATE_LIMITED: '操作过于频繁，请稍后再试。',
  PASSWORD_CHANGE_REQUIRED: '请先修改初始密码。',
  PASSWORD_MUST_CHANGE: '新密码不能与当前密码相同。',
  CURRENT_PASSWORD_INVALID: '当前密码不正确。',
  RECENT_AUTH_REQUIRED: '此操作需要重新验证当前密码。',
  REAUTH_FAILED: '密码验证失败。',
  EMAIL_UNAVAILABLE: '该邮箱在此登录域中不可用。',
  ONBOARDING_REQUIRED: '请先完成账号设置。',
  SCHOOL_FORBIDDEN: '无权访问该学校。',
  SECRET_KEY_UNAVAILABLE: '服务器加密主密钥尚未配置，请联系部署管理员。',
  OUTBOUND_ADDRESS_FORBIDDEN: '目标地址不在允许的网络范围内。',
  OUTBOUND_PORT_FORBIDDEN: '目标端口未获部署配置授权。',
};
export class IdentityRequestError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'IdentityRequestError';
  }
}
export async function identityRequest(
  path: string,
  data?: unknown,
  realm?: AuthRealm,
  signal?: AbortSignal,
) {
  const response = await fetch(path, {
    signal,
    method: data === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(realm ? { 'x-tuheng-realm': realm } : {}) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const body = await response.json();
  if (!response.ok)
    throw new IdentityRequestError(
      body.error ?? 'REQUEST_FAILED',
      messages[body.error] ?? body.details?.join('；') ?? body.error ?? '操作失败',
    );
  return body.data;
}
export async function realmSignIn(realm: AuthRealm, values: Record<string, string>) {
  const base = `/api/auth/${realm.toLowerCase()}`;
  const { csrfToken } = await (await fetch(base + '/csrf')).json();
  const response = await fetch(base + '/callback/credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      ...values,
      csrfToken,
      callbackUrl: new URL('/', window.location.origin).href,
      json: 'true',
    }),
  });
  const data = await response.json();
  if (
    !response.ok ||
    !data.url ||
    new URL(data.url, window.location.origin).searchParams.has('error')
  )
    throw new Error('账号或凭据不正确，或账号暂不可用。');
}
export async function realmSignOut(realm: AuthRealm) {
  const base = `/api/auth/${realm.toLowerCase()}`;
  const { csrfToken } = await (await fetch(base + '/csrf')).json();
  await fetch(base + '/signout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      csrfToken,
      json: 'true',
      callbackUrl: new URL('/login', window.location.origin).href,
    }),
  });
}
