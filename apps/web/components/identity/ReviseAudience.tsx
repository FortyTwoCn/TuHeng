'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ReviewerAssignments, TeacherPicker } from './ReviewerAssignments';
import type { AudienceSelection, ReviewerAssignment } from '@tuheng/contracts';
import { AudiencePicker } from './AudiencePicker';
import { identityRequest } from './client';
export function ReviseAudience({
  assignmentId,
  initial,
  revision,
  canAssign,
}: {
  assignmentId: string;
  initial: AudienceSelection & {
    reviewerIds: string[];
    reviewerAssignments?: ReviewerAssignment[];
  };
  revision: number;
  canAssign: boolean;
}) {
  const router = useRouter(),
    [selection, setSelection] = useState<AudienceSelection>(initial),
    [preview, setPreview] = useState<{ count: number; rosterVersion: number }>(),
    [reviewers, setReviewers] = useState(initial.reviewerIds),
    [assignments, setAssignments] = useState(initial.reviewerAssignments ?? []),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <details className="identity-panel">
      <summary>显式修订接收人名单</summary>
      <p>新增人员将收到此作业；移除未作答人员会保留修订记录。已经提交作答的学生不能移除。</p>
      <AudiencePicker value={selection} onChange={setSelection} onPreview={setPreview} />
      {canAssign && (
        <>
          <TeacherPicker schoolId={initial.schoolId} value={reviewers} onChange={setReviewers} />
          <ReviewerAssignments
            schoolId={initial.schoolId}
            value={assignments}
            onChange={setAssignments}
          />
        </>
      )}
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
                reviewerIds: reviewers,
                reviewerAssignments: assignments,
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
