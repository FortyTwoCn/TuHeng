'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { action } from './Actions';
export function BatchPublish({ decisions }: { decisions: { id: string; label: string }[] }) {
  const [ids, setIds] = useState<string[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const router = useRouter();
  if (!decisions.length) return null;
  return (
    <section className="panel">
      <h2>批量发布已确认成绩</h2>
      <p className="muted small">仅列出最新教师确认且未发布的结果。AI 建议不会自动发布。</p>
      {decisions.map((d) => (
        <label className="check" key={d.id}>
          <input
            type="checkbox"
            checked={ids.includes(d.id)}
            onChange={(e) =>
              setIds(e.target.checked ? [...ids, d.id] : ids.filter((id) => id !== d.id))
            }
          />
          {d.label}
        </label>
      ))}
      <button
        className="button primary"
        disabled={!ids.length || busy}
        onClick={async () => {
          if (!window.confirm(`发布所选${ids.length}份教师确认成绩？`)) return;
          setBusy(true);
          try {
            await action('grades-publish-batch', { ids });
            router.refresh();
            setIds([]);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        发布所选成绩
      </button>
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
    </section>
  );
}
