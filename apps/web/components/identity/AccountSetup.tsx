'use client';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { AccountKind, AuthRealm } from '@tuheng/contracts';
import { identityRequest, realmSignOut } from './client';
import { loginDestination } from './auth-navigation';
import { EmailBindingForm, PasswordForm } from './AccountForms';

type Status = {
  kind: AccountKind;
  name: string;
  mustChangePassword: boolean;
  emailVerified: boolean;
  emailBindingRequired: boolean;
  onboarding: boolean;
};
export function AccountSetup({ realm, callback }: { realm: AuthRealm; callback?: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>();
  const [error, setError] = useState('');
  const refresh = useCallback(() => {
    void identityRequest('/api/identity/status?realm=' + realm)
      .then(setStatus)
      .catch((e) => setError(e.message));
  }, [realm]);
  useEffect(refresh, [refresh]);
  useEffect(() => {
    if (status?.kind === 'SITE_ADMIN' && !status.onboarding)
      router.replace(loginDestination(status.kind, callback));
  }, [router, status?.kind, status?.onboarding, callback]);
  const siteAdmin = status?.kind === 'SITE_ADMIN';
  return (
    <main className="identity-entry wide">
      <h1>首次账号设置</h1>
      <p>
        {status?.name} · {realm === 'STUDENT' ? '学生' : '教师与管理'}身份
      </p>
      {status && (
        <ol className="identity-steps">
          <li>{status.mustChangePassword ? '① 修改初始密码' : '✓ 密码已更新'}</li>
          {!siteAdmin && (
            <li>
              {status.emailVerified
                ? '✓ 邮箱已验证'
                : status.emailBindingRequired
                  ? '② 验证绑定邮箱'
                  : '② 绑定邮箱（可选）'}
            </li>
          )}
          <li>{siteAdmin ? '②' : '③'} 进入工作空间</li>
        </ol>
      )}
      {status?.mustChangePassword && (
        <section className="identity-panel">
          <h2>修改密码</h2>
          <PasswordForm realm={realm} onSaved={refresh} />
        </section>
      )}
      {status && !status.mustChangePassword && !siteAdmin && !status.emailVerified && (
        <section className="identity-panel">
          <h2>验证邮箱</h2>
          {!status.emailBindingRequired && <p>绑定后可使用邮箱登录和找回密码。</p>}
          <EmailBindingForm realm={realm} verified={false} onSaved={refresh} />
        </section>
      )}
      {status && !status.onboarding && (
        <a className="button primary" href={loginDestination(status.kind, callback)}>
          {realm === 'STUDENT' && !status.emailVerified
            ? '暂不绑定邮箱，进入学习空间'
            : '进入工作空间'}
        </a>
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
