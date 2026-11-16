'use client';
import { useState } from 'react';
import type { AuthRealm } from '@tuheng/contracts';
import { identityRequest } from './client';
export function Reauthentication({
  realm = 'STAFF',
  onProof,
}: {
  realm?: AuthRealm;
  onProof: (proof: string) => void;
}) {
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [verified, setVerified] = useState(false);
  return (
    <form
      className="identity-reauth"
      method="post"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        const form = e.currentTarget;
        try {
          const r = await identityRequest('/api/identity/reauthenticate', {
            realm,
            password: new FormData(form).get('password'),
          });
          onProof(r.proof);
          form.reset();
          setVerified(true);
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        验证当前密码（敏感操作授权 10 分钟）
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      <button disabled={busy} className="button secondary">
        验证身份
      </button>
      {verified && <span role="status">已验证</span>}
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
