'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';
const messages: Record<string, string> = {
  BLOCKED_CONFIG: '视觉模型尚未配置',
  FORBIDDEN: '没有此操作权限',
  DEADLINE_PASSED: '已超过截止时间',
  NOT_STARTED: '作业尚未开始',
  ATTEMPT_LIMIT: '已达到允许的提交次数',
  QUESTION_NOT_CONFIRMED: '请先确认题目及参考答案',
  BODY_TOO_LARGE: '文件超过大小限制',
  SESSION_REVOKED: '登录已失效，请重新登录',
  UNAUTHENTICATED: '请先登录',
  DUPLICATE_RECORD: '记录已存在，请刷新查看',
  CRITERIA_MISMATCH: '评分项必须完整且唯一',
  DEDUCTION_CAP: '扣分超过细则上限',
  SCORE_OUT_OF_RANGE: '分数超出范围',
  SELFTEST_QUOTA: '今日自测调用已达到限额',
};
export async function action(name: string, data: unknown) {
  const r = await fetch(`/api/actions/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const p = await r.json();
  if (!r.ok) throw new Error(messages[p.error] ?? p.details?.join('；') ?? p.error ?? '操作失败');
  return p.data;
}
export function ActionButton({
  name,
  data,
  children,
  confirm,
  href,
  className = 'button secondary',
}: {
  name: string;
  data: unknown;
  children: React.ReactNode;
  confirm?: string;
  href?: string;
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <span className="action-wrap">
      <button
        className={className}
        disabled={busy}
        onClick={async () => {
          if (confirm && !window.confirm(confirm)) return;
          setBusy(true);
          setError('');
          try {
            await action(name, data);
            if (href) router.push(href);
            router.refresh();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? '处理中…' : children}
      </button>
      {error && (
        <small className="field-error" role="alert">
          {error}
        </small>
      )}
    </span>
  );
}
export function TextAction({
  name,
  field,
  data,
  label,
  placeholder,
}: {
  name: string;
  field: string;
  data: Record<string, unknown>;
  label: string;
  placeholder: string;
}) {
  const [text, setText] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <form
      className="text-action"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await action(name, { ...data, [field]: text });
          setText('');
          setError('');
          router.refresh();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        {placeholder}
        <textarea
          required
          minLength={field === 'title' ? 1 : 5}
          maxLength={4000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
        />
      </label>
      <button className="button secondary" disabled={busy}>
        {label}
      </button>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
export function Logout() {
  return (
    <button className="logout" onClick={() => signOut({ callbackUrl: '/login' })}>
      退出登录
    </button>
  );
}
export function ExportButton({ classId }: { classId: string }) {
  const [error, setError] = useState('');
  return (
    <>
      <button
        className="button secondary"
        onClick={async () => {
          try {
            const r = await fetch('/api/actions/export', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ classId }),
            });
            if (!r.ok) throw new Error('导出失败');
            const u = URL.createObjectURL(await r.blob());
            const a = document.createElement('a');
            a.href = u;
            a.download = '图衡-成绩与提交记录.csv';
            a.click();
            URL.revokeObjectURL(u);
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        导出成绩 CSV
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
export function ModelTest() {
  const [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <>
      <button
        className="button secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await action('model-test', {});
            setMessage('连接成功，服务已接受视觉请求。');
          } catch (e) {
            setMessage((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        测试视觉连接
      </button>
      <p role="status">{message}</p>
    </>
  );
}
