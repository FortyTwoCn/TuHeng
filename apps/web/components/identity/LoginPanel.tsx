'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { AuthRealm } from '@tuheng/contracts';
import { BrandLogo } from '../BrandLogo';
import { LoginProjection } from '../LoginProjection';
import { identityRequest, realmSignIn } from './client';
export function LoginPanel({ realm }: { realm: AuthRealm }) {
  const [mode, setMode] = useState<'ID' | 'EMAIL' | 'CODE' | 'RECOVER'>('ID');
  const [schools, setSchools] = useState<{ id: string; name: string; code: string }[]>([]);
  const [school, setSchool] = useState(''),
    [query, setQuery] = useState(''),
    [page, setPage] = useState(0),
    [more, setMore] = useState(false);
  const [email, setEmail] = useState(''),
    [challenge, setChallenge] = useState(''),
    [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/schools?q=${encodeURIComponent(query)}&page=${page}`, { signal: abort.signal })
        .then((r) => r.json())
        .then((r) => {
          setSchools(r.schools);
          setMore(r.hasMore);
        })
        .catch(() => {});
    }, 150);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [query, page]);
  useEffect(() => {
    if (!seconds) return;
    const timer = setTimeout(() => setSeconds((v) => v - 1), 1000);
    return () => clearTimeout(timer);
  }, [seconds]);
  const codeMode = mode === 'CODE' || mode === 'RECOVER';
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
        <Link href="/login">← 选择登录身份</Link>
        <h1>{realm === 'STUDENT' ? '学生登录' : '教师与管理登录'}</h1>
        <div className="identity-tabs" aria-label="登录方式">
          {(['ID', 'EMAIL', 'CODE'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              onClick={() => {
                setMode(value);
                setError('');
                setChallenge('');
              }}
            >
              {value === 'ID'
                ? realm === 'STUDENT'
                  ? '学号'
                  : '登录 ID'
                : value === 'EMAIL'
                  ? '邮箱密码'
                  : '邮箱验证码'}
            </button>
          ))}
        </div>
        <form
          method="post"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            const f = new FormData(e.currentTarget);
            try {
              if (mode === 'RECOVER') {
                await identityRequest('/api/identity/recover-password', {
                  realm,
                  challengeId: challenge,
                  code: f.get('code'),
                  password: f.get('password'),
                });
                setNotice('密码已更新，请重新登录；首次设置仍需完成。');
                setMode('EMAIL');
                return;
              }
              await realmSignIn(realm, {
                method: codeMode ? 'CODE' : 'PASSWORD',
                identifier: String(mode === 'ID' ? f.get('identifier') : email),
                schoolId: school,
                password: String(f.get('password') ?? ''),
                challengeId: challenge,
                code: String(f.get('code') ?? ''),
              });
              const status = await identityRequest('/api/identity/status?realm=' + realm);
              const fallback =
                status.kind === 'STUDENT'
                  ? '/student/dashboard'
                  : status.kind === 'TEACHER'
                    ? '/teacher/dashboard'
                    : status.kind === 'SCHOOL_ADMIN'
                      ? '/school/dashboard'
                      : '/admin/dashboard';
              const requested = new URLSearchParams(window.location.search).get('callbackUrl');
              const safeReturn =
                requested &&
                /^\/(geometry(?:[/?]|$)|student\/|teacher\/|school\/|admin\/)/.test(requested) &&
                !requested.includes('\\')
                  ? requested
                  : fallback;
              window.location.assign(
                status.onboarding ? `/onboarding/${realm.toLowerCase()}` : safeReturn,
              );
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {mode === 'ID' && realm === 'STUDENT' && (
            <>
              <label>
                搜索学校
                <input
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPage(0);
                  }}
                  placeholder="学校名称或学校编号"
                />
              </label>
              <label>
                学校
                <select value={school} required onChange={(e) => setSchool(e.target.value)}>
                  <option value="">请选择学校</option>
                  {schools.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}（{s.code}）
                    </option>
                  ))}
                </select>
              </label>
              <div className="identity-inline">
                <button type="button" disabled={!page} onClick={() => setPage((p) => p - 1)}>
                  上一页
                </button>
                <button type="button" disabled={!more} onClick={() => setPage((p) => p + 1)}>
                  下一页
                </button>
              </div>
            </>
          )}
          {mode === 'ID' ? (
            <label>
              {realm === 'STUDENT' ? '学号' : '登录 ID / 已绑定邮箱'}
              <input name="identifier" autoComplete="username" required maxLength={254} />
            </label>
          ) : (
            <label>
              已绑定邮箱
              <input
                type="email"
                name="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
          )}
          {codeMode && (
            <>
              <div className="identity-inline">
                <button
                  type="button"
                  disabled={busy || seconds > 0 || !email}
                  onClick={async () => {
                    setBusy(true);
                    setError('');
                    try {
                      const r = await identityRequest('/api/identity/request-code', {
                        realm,
                        purpose: mode === 'RECOVER' ? 'RESET_PASSWORD' : 'LOGIN',
                        email,
                      });
                      setChallenge(r.challengeId);
                      setSeconds(r.resendInSeconds);
                      setNotice('若邮箱绑定了此身份的有效账号，将收到验证码。');
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {seconds ? `${seconds} 秒后重发` : '获取验证码'}
                </button>
              </div>
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
            </>
          )}
          {mode !== 'CODE' && (
            <label>
              {mode === 'RECOVER' ? '新密码（至少 12 字符，最多 72 UTF-8 字节）' : '密码'}
              <input
                name="password"
                type="password"
                required
                autoComplete={mode === 'RECOVER' ? 'new-password' : 'current-password'}
              />
            </label>
          )}
          {error && (
            <p role="alert" className="field-error">
              {error}
            </p>
          )}
          {notice && <p role="status">{notice}</p>}
          <button className="button" disabled={busy || (codeMode && !challenge)}>
            {busy ? '处理中…' : mode === 'RECOVER' ? '更新密码' : '登录'}
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              setMode('RECOVER');
              setChallenge('');
            }}
          >
            忘记密码
          </button>
        </form>
      </section>
    </main>
  );
}
