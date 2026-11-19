'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Bell, ChevronDown, LockKeyhole, Mail } from 'lucide-react';
import {
  NotificationCategory,
  notificationCategoryLabels,
  type NotificationPreferences,
} from '@tuheng/contracts';
import type { OwnProfile } from '../../../../packages/infrastructure/src/profile';
import { identityRequest } from '../identity/client';
import { EmailBindingForm, PasswordForm } from '../identity/AccountForms';

export function ProfileSettings({ profile }: { profile: OwnProfile }) {
  const router = useRouter();
  const [prefs, setPrefs] = useState(profile.preferences);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const refresh = () => router.refresh();
  return (
    <>
      <section
        className="panel profile-panel"
        id="account-security"
        aria-labelledby="security-title"
      >
        <div className="profile-section-heading">
          <span className="account-section-icon">
            <LockKeyhole size={20} aria-hidden="true" />
          </span>
          <h2 id="security-title">账号安全</h2>
        </div>
        <details className="profile-setting" id="email-binding">
          <summary>
            <span>
              <strong>{profile.emailVerified ? '更换邮箱' : '绑定邮箱'}</strong>
              <small>{profile.emailVerified ? profile.emailHint : '当前邮箱未验证'}</small>
            </span>
            <ChevronDown size={18} aria-hidden="true" />
          </summary>
          {profile.emailVerified && <p className="muted">新邮箱验证成功后才会替换当前绑定。</p>}
          {!profile.smtpConfigured && <p className="muted">邮件服务暂不可用，可稍后请求验证码。</p>}
          <EmailBindingForm
            realm={profile.realm}
            verified={profile.emailVerified}
            onSaved={refresh}
          />
        </details>
        <details className="profile-setting">
          <summary>
            <span>
              <strong>修改密码</strong>
              <small>使用当前密码确认身份</small>
            </span>
            <ChevronDown size={18} aria-hidden="true" />
          </summary>
          <PasswordForm realm={profile.realm} onSaved={refresh} />
        </details>
      </section>
      <section
        className="panel profile-panel"
        id="notification-settings"
        aria-labelledby="preferences-title"
      >
        <div className="profile-section-heading">
          <span className="account-section-icon">
            <Bell size={20} aria-hidden="true" />
          </span>
          <div>
            <h2 id="preferences-title">通知设置</h2>
            <p className="muted">站内通知已启用。</p>
          </div>
        </div>
        <form
          className="account-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setMessage('');
            setError('');
            try {
              const result: NotificationPreferences = await identityRequest(
                '/api/profile',
                prefs,
                profile.realm,
              );
              setPrefs(result);
              setMessage('通知设置已保存。');
            } catch (error) {
              setError((error as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="notification-switch">
            <span>
              <Mail size={18} aria-hidden="true" />
              <strong>接收教学邮件</strong>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={prefs.emailEnabled}
              disabled={busy}
              onChange={(e) => setPrefs({ ...prefs, emailEnabled: e.target.checked })}
            />
          </label>
          {!profile.emailVerified && (
            <p className="muted">请先绑定并验证邮箱，才能接收教学邮件。</p>
          )}
          {!profile.smtpConfigured && (
            <p className="muted">邮件服务暂不可用，通知仍会显示在站内。</p>
          )}
          <fieldset className="notification-preferences" disabled={busy || !prefs.emailEnabled}>
            <legend>邮件分类</legend>
            {NotificationCategory.options.map((category) => (
              <label className="check" key={category}>
                <input
                  type="checkbox"
                  checked={prefs.categories[category]}
                  onChange={(e) =>
                    setPrefs({
                      ...prefs,
                      categories: { ...prefs.categories, [category]: e.target.checked },
                    })
                  }
                />
                {notificationCategoryLabels[category]}
              </label>
            ))}
          </fieldset>
          <p className="muted small">
            教学邮件设置只影响之后的通知。验证码及账号安全邮件按需发送。
          </p>
          <button className="button primary" disabled={busy}>
            {busy ? '正在保存…' : '保存通知设置'}
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
      </section>
    </>
  );
}
