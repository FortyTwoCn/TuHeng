'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Uploader, type UploadedAsset } from './Uploader';
import { action } from './Actions';
export function SubmissionEditor({
  itemId,
  selfTestItemId,
  reviewEntryId,
  initial = [],
}: {
  itemId?: string;
  selfTestItemId?: string;
  reviewEntryId?: string;
  initial?: UploadedAsset[];
}) {
  const router = useRouter();
  const [assets, setAssets] = useState(initial),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const key = useRef<string | null>(null);
  return (
    <div className="submission-editor">
      <Uploader value={assets} onChange={setAssets} />
      <div className="button-row">
        {itemId && (
          <button
            className="button secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await action('draft', { itemId, assetIds: assets.map((a) => a.id) });
                setMessage('草稿已保存，可稍后继续。');
                router.refresh();
              } catch (e) {
                setMessage((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            保存草稿
          </button>
        )}
        <button
          className="button primary"
          disabled={!assets.length || busy}
          onClick={async () => {
            if (!window.confirm('正式提交后将保存为独立作答版本，是否提交？')) return;
            setBusy(true);
            if (!key.current) key.current = crypto.randomUUID();
            try {
              const result = await action('submit', {
                itemId,
                selfTestItemId,
                reviewEntryId,
                assetIds: assets.map((a) => a.id),
                idempotencyKey: key.current,
              });
              router.push(`/student/results/${result.id}`);
              router.refresh();
            } catch (e) {
              setMessage((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? '处理中…' : '正式提交并排队批改'}
        </button>
      </div>
      {message && (
        <p role="status" className="alert">
          {message}
        </p>
      )}
      <p className="muted small">提交时间由服务器记录。关闭页面不会取消已创建的批改任务。</p>
    </div>
  );
}
