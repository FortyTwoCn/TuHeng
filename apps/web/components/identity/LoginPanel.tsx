'use client';
import { useEffect, useRef, useState } from 'react';
import type { AuthRealm } from '@tuheng/contracts';
import { identityRequest, realmSignIn } from './client';
import { SchoolCombobox } from './SchoolCombobox';
import { SecretInput } from './SecretInput';
import { loginDestination } from './auth-navigation';

type LoginMethod = 'ID' | 'EMAIL' | 'CODE' | 'RECOVER';
export function LoginPanel({
  realm,
  onBusyChange,
}: {
  realm: AuthRealm;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [mode, setMode] = useState<LoginMethod>('ID');
  const [school, setSchool] = useState('');
  const [email, setEmail] = useState(''),
    [challenge, setChallenge] = useState(''),
    [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!seconds) return;
    const timer = setTimeout(() => setSeconds((v) => Math.max(0, v - 1)), 1000);
    return () => clearTimeout(timer);
  }, [seconds]);
  function working(value: boolean) {
    if (mounted.current) {
      setBusy(value);
      onBusyChange?.(value);
    }
  }
  function changeMethod(value: LoginMethod) {
    setMode(value);
    setSchool('');
    setError('');
    setNotice('');
    setChallenge('');
    setSeconds(0);
    setEmail('');
  }
  const codeMode = mode === 'CODE' || mode === 'RECOVER';
  const methods =
    realm === 'STAFF' ? (['ID', 'CODE'] as const) : (['ID', 'EMAIL', 'CODE'] as const);
  return (
    <>
      <div className="identity-tabs login-method-tabs" aria-label="登录方式">
        {methods.map((value) => (
          <button
            key={value}
            type="button"
            disabled={busy}
            aria-pressed={mode === value}
            onClick={() => changeMethod(value)}
          >
            {value === 'ID'
              ? realm === 'STUDENT'
                ? '学号'
                : '账号密码'
              : value === 'EMAIL'
                ? '邮箱密码'
                : '邮箱验证码'}
          </button>
        ))}
      </div>
      {mode === 'RECOVER' && <h3>通过已绑定邮箱找回密码</h3>}
      <form
        key={realm + ':' + mode}
        className="login-fields"
        method="post"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          const f = new FormData(e.currentTarget);
          if (mode === 'ID' && realm === 'STUDENT' && !school) {
            setError('请先搜索并选择学校。');
            return;
          }
          if (mode === 'RECOVER' && f.get('password') !== f.get('confirm')) {
            setError('两次输入的新密码不一致。');
            return;
          }
          working(true);
          setError('');
          try {
            if (mode === 'RECOVER') {
              await identityRequest('/api/identity/recover-password', {
                realm,
                challengeId: challenge,
                code: f.get('code'),
                password: f.get('password'),
              });
              if (!mounted.current) return;
              changeMethod(realm === 'STAFF' ? 'ID' : 'EMAIL');
              setNotice('密码已更新，请使用新密码登录。');
              return;
            }
            await realmSignIn(realm, {
              method: codeMode ? 'CODE' : 'PASSWORD',
              identifier: String(mode === 'ID' ? f.get('identifier') : email),
              schoolId: mode === 'ID' ? school : '',
              password: String(f.get('password') ?? ''),
              challengeId: challenge,
              ...(codeMode ? { code: String(f.get('code') ?? '') } : {}),
            });
            if (!mounted.current) return;
            const status = await identityRequest('/api/identity/status?realm=' + realm);
            if (!mounted.current) return;
            const callback = new URLSearchParams(location.search).get('callbackUrl');
            const next = loginDestination(status.kind, callback);
            window.location.assign(
              status.onboarding
                ? `/onboarding/${realm.toLowerCase()}` +
                    (callback ? '?' + new URLSearchParams({ callbackUrl: next }) : '')
                : next,
            );
          } catch (e) {
            if (mounted.current) setError((e as Error).message);
          } finally {
            working(false);
          }
        }}
      >
        {mode === 'ID' && realm === 'STUDENT' && (
          <SchoolCombobox value={school} onChange={setSchool} />
        )}
        {mode === 'ID' ? (
          <label>
            {realm === 'STUDENT' ? '学号' : '登录 ID / 已绑定邮箱'}
            <input
              type="text"
              name="identifier"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              placeholder={realm === 'STAFF' ? '输入登录 ID 或已绑定邮箱' : undefined}
              required
              maxLength={254}
            />
          </label>
        ) : (
          <label>
            已绑定邮箱
            <input
              type="email"
              name="email"
              autoComplete="username"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setChallenge('');
              }}
              required
            />
          </label>
        )}
        {codeMode && (
          <div className="login-code-field">
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
            <button
              type="button"
              className="button secondary"
              disabled={busy || seconds > 0 || !email}
              onClick={async () => {
                working(true);
                setError('');
                setNotice('');
                try {
                  const r = await identityRequest('/api/identity/request-code', {
                    realm,
                    purpose: mode === 'RECOVER' ? 'RESET_PASSWORD' : 'LOGIN',
                    email,
                  });
                  if (!mounted.current) return;
                  setChallenge(r.challengeId);
                  setSeconds(r.resendInSeconds);
                  setNotice('若邮箱绑定了此身份的有效账号，将收到验证码。');
                } catch (e) {
                  if (mounted.current) setError((e as Error).message);
                } finally {
                  working(false);
                }
              }}
            >
              {seconds ? `${seconds} 秒后重发` : '获取验证码'}
            </button>
          </div>
        )}
        {mode !== 'CODE' && (
          <SecretInput
            label={mode === 'RECOVER' ? '新密码' : '密码'}
            name="password"
            required
            minLength={mode === 'RECOVER' ? 12 : undefined}
            autoComplete={mode === 'RECOVER' ? 'new-password' : 'current-password'}
            hint={
              mode === 'RECOVER'
                ? '至少 12 个字符；中文等字符占用多个字节，总计不超过 72 字节。'
                : undefined
            }
          />
        )}
        {mode === 'RECOVER' && (
          <SecretInput label="确认新密码" name="confirm" required autoComplete="new-password" />
        )}
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="login-notice">
            {notice}
          </p>
        )}
        <button className="button primary login-submit" disabled={busy || (codeMode && !challenge)}>
          {busy ? '处理中…' : mode === 'RECOVER' ? '更新密码' : '登录'}
        </button>
        <button
          type="button"
          className="login-recover"
          disabled={busy}
          onClick={() => changeMethod(mode === 'RECOVER' ? 'ID' : 'RECOVER')}
        >
          {mode === 'RECOVER' ? '返回登录' : '忘记密码'}
        </button>
      </form>
    </>
  );
}
