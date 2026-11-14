'use client';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { BrandLogo } from '../../components/BrandLogo';
import { LoginProjection } from '../../components/LoginProjection';
export default function Login() {
  const router = useRouter();
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
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
      <section className="login-form">
        <span className="tag">欢迎来到图衡</span>
        <h2>登录教学工作空间</h2>
        <p className="muted">使用学校或管理员分配的账号</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            const f = new FormData(e.currentTarget);
            try {
              const r = await signIn('credentials', {
                email: f.get('email'),
                password: f.get('password'),
                redirect: false,
              });
              if (r?.ok) {
                router.push('/');
                router.refresh();
              } else setError('账号或密码不正确，或账户暂时被锁定。');
            } catch {
              setError('登录服务暂不可用，请稍后重试。');
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            账号邮箱
            <input
              name="email"
              type="email"
              required
              autoComplete="username"
              placeholder="you@university.edu.cn"
            />
          </label>
          <label>
            密码
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              placeholder="输入你的密码"
            />
          </label>
          {error && (
            <div role="alert" className="alert error">
              {error}
            </div>
          )}
          <button className="button primary full" disabled={busy}>
            {busy ? '正在登录…' : '进入图衡'}
            <ArrowRight size={18} />
          </button>
        </form>
        <p className="muted small">需要恢复账号？请联系本校管理员重置密码。</p>
      </section>
    </main>
  );
}
