'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AudienceSelection } from '@tuheng/contracts';
import { AudiencePicker } from './AudiencePicker';
import { identityRequest } from './client';
export function ReviseAudience({
  assignmentId,
  initial,
  revision,
}: {
  assignmentId: string;
  initial: AudienceSelection & { reviewerIds: string[] };
  revision: number;
}) {
  const router = useRouter(),
    [selection, setSelection] = useState<AudienceSelection>(initial),
    [preview, setPreview] = useState<{ count: number; rosterVersion: number }>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <details className="identity-panel">
      <summary>显式修订接收人名单</summary>
      <p>新增人员将收到此作业；移除未作答人员会保留修订记录。已经提交作答的学生不能移除。</p>
      <AudiencePicker value={selection} onChange={setSelection} onPreview={setPreview} />
      <button
        className="button"
        type="button"
        disabled={busy || !preview}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            await identityRequest(
              '/api/audience',
              {
                operation: 'REVISE',
                id: assignmentId,
                selection,
                revision,
                rosterVersion: preview!.rosterVersion,
                reviewerIds: initial.reviewerIds,
              },
              'STAFF',
            );
            router.refresh();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        确认名单修订（{preview?.count ?? 0} 人）
      </button>
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
