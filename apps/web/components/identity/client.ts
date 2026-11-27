'use client';
import type { AuthRealm } from '@tuheng/contracts';
const messages: Record<string, string> = {
  SMTP_NOT_CONFIGURED: '邮件服务尚未配置，请联系管理员。',
  SMTP_AUTH_FAILED: 'SMTP 认证失败，请核对所选版本的用户名和授权码。',
  SMTP_CERTIFICATE_INVALID: 'SMTP 证书验证失败，请检查有效期和证书链；系统未关闭校验。',
  SMTP_TLS_OR_CONNECTION_FAILED: 'SMTP 安全连接失败，请核对端口和 TLS 模式。',
  SMTP_CONNECTION_FAILED: '无法连接邮件服务器，请核对主机、端口与网络。',
  SMTP_TIMEOUT: '邮件服务器连接或响应超时，请核对网络后再试。',
  SMTP_SERVER_REJECTED: '邮件服务器拒绝了本次请求，请检查发信权限与收件地址。',
  SMTP_SEND_STATUS_UNKNOWN:
    '无法确认邮件是否已被接收，请先核查收件箱或服务器记录，再决定是否重发。',
  SECRET_REVOKED_OR_EXPIRED: '此版本凭据已撤销或过期，请显式配置新凭据。',
  SMTP_TLS_REQUIRED: '当前部署要求 TLS 或 STARTTLS，请核对连接模式。',
  SMTP_VERSION_NOT_FOUND: '所选邮件版本不存在，请刷新配置。',
  SMTP_SEND_FAILED: '验证码发送失败，请稍后重试。',
  INVALID_OR_EXPIRED_CODE: '验证码不正确、已失效或已使用，请重新获取。',
  RATE_LIMITED: '操作过于频繁，请稍后再试。',
  PASSWORD_CHANGE_REQUIRED: '请先修改初始密码。',
  PASSWORD_MUST_CHANGE: '新密码不能与当前密码相同。',
  PASSWORD_CONFIRMATION_MISMATCH: '两次输入的新密码不一致。',
  INVALID_AVATAR_IMAGE: '请选择有效的静态 JPEG、PNG 或 WebP 图片，像素不超过 1600 万。',
  AVATAR_SIZE_LIMIT: '头像文件最多 5 MB。',
  AVATAR_CHANGED: '头像已在另一处更新，请刷新后重试。',
  ANNOUNCEMENT_SCOPE_FORBIDDEN: '部分人员或班级不在你的公告发布范围内。',
  ANNOUNCEMENT_EMPTY: '请至少选择一位接收人。',
  ANNOUNCEMENT_CHANGED: '公告已更新或发布，请刷新后再操作。',
  ANNOUNCEMENT_AUDIENCE_CHANGED: '接收名单已变化，请重新预览后发布。',
  CURRENT_PASSWORD_INVALID: '当前密码不正确。',
  RECENT_AUTH_REQUIRED: '此操作需要重新验证当前密码。',
  REAUTH_FAILED: '密码验证失败。',
  EMAIL_UNAVAILABLE: '该邮箱在此登录域中不可用。',
  ONBOARDING_REQUIRED: '请先完成账号设置。',
  COURSE_CODE_CONFLICT: '本校已有该课程编号。',
  OFFERING_TERM_CONFLICT: '这门课程已在该学期开课。',
  CLASS_NAME_CONFLICT: '该教师在这次开课中已有同名教学班。',
  LAST_ACTIVE_SCHOOL_ADMIN: '每所学校必须至少保留一个启用的管理员，请先创建或启用其他管理员。',
  SCHOOL_ADMIN_REQUIRED: '请先为该校创建或启用至少一个学校管理员，再启用学校。',
  SCHOOL_NOT_FOUND: '该学校不存在或已被移除，请刷新列表。',
  CATALOG_ARCHIVED: '课程或开课已归档，请先恢复上级记录。',
  INVALID_TERM_RANGE: '请选择开启时间与截止时间，截止时间必须晚于开启时间。',
  CLASS_ARCHIVED: '该班级已归档。',
  GRANT_CHANGED: '授课关系已变化，请刷新后重新选择。',
  HANDOFF_SAME_TEACHER: '请选择不同的接任教师。',
  CATALOG_FORBIDDEN: '管理课程和开课需要学校管理权限。',
  IDENTITY_FORBIDDEN: '当前身份无法修改该学校账号。',
  STUDENT_IDENTITY_CONFLICT: '已有学号对应的姓名或账号状态不一致，请学校管理员核对。',
  SCHOOL_FORBIDDEN: '无权访问该学校。',
  SECRET_KEY_UNAVAILABLE: '服务器加密主密钥尚未配置，请联系部署管理员。',
  OUTBOUND_ADDRESS_FORBIDDEN: '目标地址不在允许的网络范围内。',
  OUTBOUND_PORT_FORBIDDEN: '目标端口未获部署配置授权。',
  CONFIGURATION_CHANGED: '此配置已被其他操作更新，请重新读取后核对草稿。',
  AI_BINDING_NOT_CONFIGURED: '模块尚未启用有效规则。',
  AI_MODEL_DISABLED: '所选模型已停用、归档或不存在。',
  AI_PROVIDER_DISABLED: '供应商已停用、归档或不存在。',
  AI_CREDENTIAL_NOT_CONFIGURED: '供应商未配置有效密钥。',
  AI_CONFIGURATION_INVALID: '配置格式或参数无效，请核对版本。',
  MODEL_OR_PROVIDER_DISABLED: '模型或供应商不可用，不能启用此规则。',
  AI_CAPABILITY_MISMATCH: '声明能力不满足本次输入要求，请核对文本和图像能力。',
  AI_OUTPUT_MODE_UNSUPPORTED: '模型未声明支持所选输出模式。',
  AI_PARAMETER_UNSUPPORTED: '输出 Token 或温度超出模型声明的参数边界。',
  AI_PROTOCOL_OUTPUT_UNSUPPORTED: '所选协议不支持此输出模式。',
};
export const identityMessage = (code: string) => messages[code] ?? code;
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
