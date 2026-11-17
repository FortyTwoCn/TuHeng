'use client';
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { LockKeyhole, ShieldCheck } from 'lucide-react';
import type { AuthRealm } from '@tuheng/contracts';
import { identityRequest } from './client';
import { Dialog } from './Dialog';
import { SecretInput } from './SecretInput';

export type ReauthenticationHandle = {
  request: () => Promise<string | null>;
  invalidate: () => void;
};
export function Reauthentication({
  realm = 'STAFF',
  onProof,
  ref,
}: {
  realm?: AuthRealm;
  onProof?: (proof: string) => void;
  ref?: Ref<ReauthenticationHandle>;
}) {
  const [open, setOpen] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [expiresAt, setExpiresAt] = useState(0);
  const authorization = useRef({ proof: '', until: 0 });
  const pending = useRef<{
    promise: Promise<string | null>;
    resolve: (value: string | null) => void;
  } | null>(null);
  const notify = useRef(onProof);
  useEffect(() => {
    notify.current = onProof;
  }, [onProof]);
  useEffect(
    () => () => {
      pending.current?.resolve(null);
    },
    [],
  );
  useEffect(() => {
    if (!expiresAt) return;
    const timer = setTimeout(
      () => {
        authorization.current = { proof: '', until: 0 };
        setExpiresAt(0);
        notify.current?.('');
      },
      Math.max(0, expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [expiresAt]);
  function close() {
    pending.current?.resolve(null);
    pending.current = null;
    setOpen(false);
    setError('');
  }
  function request() {
    if (authorization.current.proof && authorization.current.until > Date.now())
      return Promise.resolve(authorization.current.proof);
    if (pending.current) return pending.current.promise;
    let resolve!: (value: string | null) => void;
    const promise = new Promise<string | null>((done) => {
      resolve = done;
    });
    pending.current = { promise, resolve };
    setError('');
    setOpen(true);
    return promise;
  }
  useImperativeHandle(ref, () => ({
    request,
    invalidate: () => {
      authorization.current = { proof: '', until: 0 };
      setExpiresAt(0);
      notify.current?.('');
    },
  }));
  return (
    <>
      <div className="identity-reauth">
        {expiresAt ? <ShieldCheck size={17} /> : <LockKeyhole size={17} />}
        <span role="status">
          {expiresAt
            ? '敏感操作已验证至 ' +
              new Date(expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : '敏感操作已锁定'}
        </span>
        {!expiresAt && (
          <button type="button" onClick={() => void request()}>
            验证身份
          </button>
        )}
      </div>
      <Dialog open={open} title="验证身份" busy={busy} onClose={close}>
        <p className="muted">输入当前密码，授权本次会话的敏感操作。授权有效期由服务器控制。</p>
        <form
          method="post"
          className="identity-dialog-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            const form = e.currentTarget;
            setBusy(true);
            setError('');
            try {
              const result = await identityRequest('/api/identity/reauthenticate', {
                realm,
                password: new FormData(form).get('password'),
              });
              const until = Date.now() + result.expiresInSeconds * 1000;
              authorization.current = { proof: result.proof, until };
              setExpiresAt(until);
              notify.current?.(result.proof);
              form.reset();
              setOpen(false);
              pending.current?.resolve(result.proof);
              pending.current = null;
            } catch (e) {
              form.reset();
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <SecretInput
            label="当前密码"
            name="password"
            autoComplete="current-password"
            required
            autoFocus
          />
          {error && (
            <p role="alert" className="field-error">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button type="button" className="button secondary" disabled={busy} onClick={close}>
              取消
            </button>
            <button className="button primary" disabled={busy}>
              {busy ? '正在验证…' : '验证并继续'}
            </button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
