'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { action } from '../Actions';
import { identityRequest } from './client';
export function PublishAudience({ assignmentId }: { assignmentId: string }) {
  const router = useRouter(),
    [preview, setPreview] = useState<{
      count: number;
      rosterVersion: number;
      people: { studentId: string; name: string; studentNumber: string }[];
    }>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const refresh = () =>
    identityRequest('/api/audience?assignmentId=' + assignmentId)
      .then(setPreview)
      .catch((e) => setError(e.message));
  useEffect(() => {
    identityRequest('/api/audience?assignmentId=' + assignmentId)
      .then(setPreview)
      .catch((e) => setError(e.message));
  }, [assignmentId]);
  return (
    <div className="identity-panel">
      <h3>发布名单预览</h3>
      <p>当前 {preview?.count ?? '—'} 人。发布会固定题目版本、实际接收人和复核分工。</p>
      <details>
        <summary>查看前 30 位接收人</summary>
        {preview?.people.map((p) => (
          <p key={p.studentId}>
            {p.name} · {p.studentNumber}
          </p>
        ))}
      </details>
      <div className="identity-inline">
        <button type="button" onClick={refresh}>
          重新预览名单
        </button>
        <button
          type="button"
          className="button"
          disabled={busy || !preview?.count}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              await action('assignment-publish', {
                id: assignmentId,
                rosterVersion: preview!.rosterVersion,
              });
              router.refresh();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          确认名单并正式发布
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
