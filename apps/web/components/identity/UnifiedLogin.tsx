'use client';
import { useEffect, useState } from 'react';
import type { AuthRealm } from '@tuheng/contracts';
import { GraduationCap, Users } from 'lucide-react';
import { BrandLogo } from '../BrandLogo';
import { LoginProjection } from '../LoginProjection';
import { LoginPanel } from './LoginPanel';
import { loginEntryUrl } from './auth-navigation';

export function UnifiedLogin({ initialRealm }: { initialRealm: AuthRealm }) {
  const [realm, setRealm] = useState(initialRealm);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const update = () =>
      setRealm(new URLSearchParams(location.search).get('realm') === 'staff' ? 'STAFF' : 'STUDENT');
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, []);
  return (
    <main className="login">
      <div className="login-art">
        <div className="brand">
          <BrandLogo />
          <b>
            图衡 <small>TuHeng</small>
          </b>
        </div>
        <p className="eyebrow">ENGINEERING GRAPHICS · LEARNING WITH EVIDENCE</p>
        <h1>
          一笔一线，
          <br />
          构建空间思维。
        </h1>
        <p>
          从作图、反馈到再一次练习，
          <br />
          让每一步学习都有清晰的方向。
        </p>
        <LoginProjection />
      </div>
      <section className="login-form" aria-label="图衡登录">
        <div className="login-mobile-brand">
          <BrandLogo />
          <strong>
            图衡 <small>TuHeng</small>
          </strong>
        </div>
        <h2>欢迎来到图衡</h2>
        <p className="muted">从这里开始你的工程图学学习与教学。</p>
        <div className="login-realm-tabs" aria-label="登录身份">
          {(['STUDENT', 'STAFF'] as const).map((kind) => (
            <button
              type="button"
              disabled={busy}
              key={kind}
              aria-pressed={realm === kind}
              onClick={() => {
                if (realm === kind) return;
                setRealm(kind);
                history.replaceState(
                  null,
                  '',
                  loginEntryUrl(
                    kind,
                    new URLSearchParams(location.search).get('callbackUrl') ?? undefined,
                  ),
                );
              }}
            >
              {kind === 'STUDENT' ? <GraduationCap size={19} /> : <Users size={19} />}
              {kind === 'STUDENT' ? '学生登录' : '教师与管理'}
            </button>
          ))}
        </div>
        <LoginPanel key={realm} realm={realm} onBusyChange={setBusy} />
      </section>
    </main>
  );
}
