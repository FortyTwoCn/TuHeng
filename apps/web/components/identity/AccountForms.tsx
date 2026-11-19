'use client';
import { useEffect, useRef, useState } from 'react';
import { EmailAddress, type AuthRealm } from '@tuheng/contracts';
import { identityRequest, IdentityRequestError } from './client';
import { SecretInput } from './SecretInput';
import { Reauthentication, type ReauthenticationHandle } from './Reauthentication';
import '../profile/account.css';

export function PasswordForm({ realm, onSaved }: { realm: AuthRealm; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  return (
    <form
      className="account-form"
      method="post"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        const form = event.currentTarget;
        const input = new FormData(form);
        setError('');
        setMessage('');
        if (input.get('password') !== input.get('confirm')) {
          setError('两次输入的新密码不一致。');
          return;
        }
        setBusy(true);
        try {
          await identityRequest('/api/identity/change-password', {
            realm,
            current: input.get('current'),
            password: input.get('password'),
            confirm: input.get('confirm'),
          });
          form.reset();
          setMessage('密码已修改。');
          onSaved();
        } catch (error) {
          setError((error as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <SecretInput label="当前密码" name="current" autoComplete="current-password" required />
      <SecretInput
        label="新密码"
        name="password"
        autoComplete="new-password"
        minLength={12}
        hint="至少 12 个字符，且总计不超过 72 字节。"
        required
      />
      <SecretInput label="确认新密码" name="confirm" autoComplete="new-password" required />
      <button className="button primary" disabled={busy}>
        {busy ? '正在修改…' : '确认修改'}
      </button>
      {message && (
        <p role="status" className="account-success">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
    </form>
  );
}

export function EmailBindingForm({
  realm,
  verified,
  onSaved,
}: {
  realm: AuthRealm;
  verified: boolean;
  onSaved: () => void;
}) {
  const auth = useRef<ReauthenticationHandle>(null);
  const [email, setEmail] = useState('');
  const [challenge, setChallenge] = useState<{ id: string; email: string } | null>(null);
  const [code, setCode] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const purpose = verified ? 'CHANGE_EMAIL' : 'BIND_EMAIL';
  useEffect(() => {
    if (!seconds) return;
    const timer = setTimeout(() => setSeconds((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [seconds]);

  function changeTarget(value: string) {
    if (challenge)
      void identityRequest('/api/identity/cancel-email-code', {
        realm,
        challengeId: challenge.id,
      }).catch(() => {});
    setEmail(value);
    setChallenge(null);
    setCode('');
    setSeconds(0);
    setError('');
    setMessage('');
  }
  async function sendCode() {
    if (busy || seconds > 0) return;
    const parsed = EmailAddress.safeParse(email);
    if (!parsed.success) {
      setError('请输入有效的邮箱地址。');
      return;
    }
    const target = parsed.data;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const proof = verified ? await auth.current?.request() : undefined;
      if (verified && !proof) return;
      const response = await identityRequest('/api/identity/request-code', {
        realm,
        purpose,
        email: target,
        proof,
      });
      setCode('');
      setChallenge({ id: response.challengeId, email: target });
      setSeconds(response.resendInSeconds);
    } catch (error) {
      if (error instanceof IdentityRequestError && error.code === 'RECENT_AUTH_REQUIRED')
        auth.current?.invalidate();
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="account-form">
      {verified && <Reauthentication realm={realm} ref={auth} />}
      <label>
        邮箱
        <input
          type="email"
          value={email}
          autoComplete="email"
          disabled={busy}
          onChange={(e) => changeTarget(e.target.value)}
        />
      </label>
      <button
        type="button"
        className="button secondary"
        disabled={busy || seconds > 0 || !email.trim()}
        onClick={() => void sendCode()}
      >
        {seconds ? `${seconds} 秒后重发` : '发送验证码'}
      </button>
      {challenge && (
        <p role="status" className="muted">
          验证码已发送至 <strong>{challenge.email}</strong>，5 分钟内有效。
        </p>
      )}
      <form
        className="account-form"
        method="post"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy || !challenge) return;
          setBusy(true);
          setError('');
          try {
            await identityRequest('/api/identity/bind-email', {
              realm,
              purpose,
              challengeId: challenge.id,
              email: challenge.email,
              code,
            });
            setChallenge(null);
            setEmail('');
            setCode('');
            setSeconds(0);
            auth.current?.invalidate();
            setMessage(verified ? '绑定邮箱已更换。' : '邮箱已绑定。');
            onSaved();
          } catch (error) {
            setError((error as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          六位验证码
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            disabled={busy || !challenge}
          />
        </label>
        <button className="button primary" disabled={busy || !challenge}>
          {busy ? '处理中…' : '验证并绑定'}
        </button>
      </form>
      {message && (
        <p role="status" className="account-success">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}
