'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { AuthRealm } from '@tuheng/contracts';
import { identityRequest, IdentityRequestError, realmSignOut } from './client';
import { SecretInput } from './SecretInput';
import { Reauthentication, type ReauthenticationHandle } from './Reauthentication';
type Status = {
  kind: string;
  realm: AuthRealm;
  name: string;
  mustChangePassword: boolean;
  emailVerified: boolean;
  emailBindingRequired: boolean;
  emailHint?: string;
  onboarding: boolean;
};
export function AccountSetup({
  realm,
  security = false,
}: {
  realm: AuthRealm;
  security?: boolean;
}) {
  const auth = useRef<ReauthenticationHandle>(null);
  const router = useRouter();
  const [status, setStatus] = useState<Status>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [email, setEmail] = useState(''),
    [challenge, setChallenge] = useState(''),
    [seconds, setSeconds] = useState(0);
  const refresh = () => identityRequest('/api/identity/status?realm=' + realm).then(setStatus);
  useEffect(() => {
    identityRequest('/api/identity/status?realm=' + realm)
      .then(setStatus)
      .catch((e) => setError(e.message));
  }, [realm]);
  useEffect(() => {
    if (!security && status?.kind === 'SITE_ADMIN' && !status.onboarding)
      router.replace('/admin/dashboard');
  }, [router, security, status?.kind, status?.onboarding]);
  useEffect(() => {
    if (!seconds) return;
    const id = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [seconds]);
  async function act(path: string, data: object) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const changingEmail = path === 'request-code' && status?.emailVerified;
      const proof = changingEmail ? await auth.current?.request() : undefined;
      if (changingEmail && !proof) return;
      const r = await identityRequest('/api/identity/' + path, {
        ...data,
        realm,
        ...(proof ? { proof } : {}),
      });
      await refresh();
      return r;
    } catch (e) {
      if (e instanceof IdentityRequestError && e.code === 'RECENT_AUTH_REQUIRED') {
        auth.current?.invalidate();
        void auth.current?.request();
      }
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="identity-entry wide">
      <h1>{security ? '账号安全' : '首次账号设置'}</h1>
      <p>
        {status?.name} · {realm === 'STUDENT' ? '学生' : '教师与管理'}身份
      </p>
      {!security && status && (
        <ol className="identity-steps">
          <li>{status?.mustChangePassword ? '① 修改初始密码' : '✓ 密码已更新'}</li>
          {status.kind !== 'SITE_ADMIN' && (
            <li>
              {status.emailVerified
                ? '✓ 邮箱已验证'
                : status.emailBindingRequired
                  ? '② 验证绑定邮箱'
                  : '② 绑定邮箱（可选）'}
            </li>
          )}
          <li>{status.kind === 'SITE_ADMIN' ? '②' : '③'} 进入工作空间</li>
        </ol>
      )}
      {(security || status?.mustChangePassword) && (
        <section className="identity-panel">
          <h2>修改密码</h2>
          <form
            method="post"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const f = new FormData(form);
              if (f.get('password') !== f.get('confirm')) {
                setError('两次输入的新密码不一致。');
                return;
              }
              const result = await act('change-password', {
                current: f.get('current'),
                password: f.get('password'),
              });
              if (result) form.reset();
            }}
          >
            <SecretInput label="当前密码" name="current" autoComplete="current-password" required />
            <SecretInput
              label="新密码"
              name="password"
              autoComplete="new-password"
              minLength={12}
              required
              hint="至少 12 个字符；中文等字符占用多个字节，总计不超过 72 字节。"
            />
            <SecretInput label="确认新密码" name="confirm" autoComplete="new-password" required />
            <button className="button primary" disabled={busy}>
              确认修改
            </button>
          </form>
        </section>
      )}
      {status && !status.mustChangePassword && (
        <>
          {(security || status.kind !== 'SITE_ADMIN') && (!status.emailVerified || security) && (
            <section className="identity-panel">
              <h2>{status.emailVerified ? '更换绑定邮箱' : '验证邮箱'}</h2>
              {!status.emailBindingRequired && <p>邮箱绑定为可选项，可用于邮箱登录和找回密码。</p>}
              {status.emailHint && <p>当前绑定：{status.emailHint}</p>}
              {status.emailVerified && <Reauthentication key={realm} realm={realm} ref={auth} />}
              <label>
                邮箱
                <input
                  type="email"
                  value={email}
                  autoComplete="email"
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <button
                className="button secondary"
                disabled={busy || !!seconds || !email}
                onClick={async () => {
                  const r = await act('request-code', {
                    email,
                    purpose: status.emailVerified ? 'CHANGE_EMAIL' : 'BIND_EMAIL',
                  });
                  if (r) {
                    setChallenge(r.challengeId);
                    setSeconds(r.resendInSeconds);
                  }
                }}
              >
                {seconds ? `${seconds} 秒后重发` : '发送验证码'}
              </button>
              <form
                method="post"
                onSubmit={async (e) => {
                  e.preventDefault();
                  await act('bind-email', {
                    purpose: status.emailVerified ? 'CHANGE_EMAIL' : 'BIND_EMAIL',
                    challengeId: challenge,
                    code: new FormData(e.currentTarget).get('code'),
                  });
                }}
              >
                <label>
                  六位验证码
                  <input
                    name="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    required
                  />
                </label>
                <button className="button" disabled={busy || !challenge}>
                  验证并绑定
                </button>
              </form>
            </section>
          )}
          {!status.onboarding && (
            <a
              className="button"
              href={
                status.kind === 'STUDENT'
                  ? '/student/dashboard'
                  : status.kind === 'TEACHER'
                    ? '/teacher/dashboard'
                    : status.kind === 'SCHOOL_ADMIN'
                      ? '/school/dashboard'
                      : '/admin/dashboard'
              }
            >
              {realm === 'STUDENT' && !status.emailVerified
                ? '暂不绑定邮箱，进入学习空间'
                : '进入工作空间'}
            </a>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
      <div className="identity-inline">
        <button
          onClick={async () => {
            await realmSignOut(realm);
            router.push('/login');
            router.refresh();
          }}
        >
          退出当前身份
        </button>
        <button
          onClick={async () => {
            await realmSignOut('STAFF');
            await realmSignOut('STUDENT');
            router.push('/login');
            router.refresh();
          }}
        >
          退出所有身份
        </button>
      </div>
    </main>
  );
}
