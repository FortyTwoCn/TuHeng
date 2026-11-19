'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Users, Send } from 'lucide-react';
import type { AnnouncementInput } from '@tuheng/contracts';
import { Dialog } from '../identity/Dialog';
import { identityRequest } from '../identity/client';
import { AnnouncementAudiencePicker } from './AnnouncementAudiencePicker';

type DraftRef = { id: string; revision: number };
type Preview = { count: number; teachers: number; fingerprint: string };
export function AnnouncementEditor({
  initial,
  existing,
  area,
  actorKind,
  scopeName,
}: {
  initial: AnnouncementInput;
  existing?: DraftRef;
  area: string;
  actorKind: 'SITE_ADMIN' | 'SCHOOL_ADMIN' | 'TEACHER';
  scopeName?: string;
}) {
  const router = useRouter();
  const saved = useRef({ existing, snapshot: JSON.stringify(initial) });
  const [draft, setDraft] = useState(initial);
  const [preview, setPreview] = useState<Preview>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const allowedToSave =
    !!draft.title.trim() &&
    !!draft.body.trim() &&
    (draft.audience.scope.kind === 'PLATFORM' || !!draft.audience.scope.schoolId);
  function update(next: AnnouncementInput) {
    setDraft(next);
    setPreview(undefined);
    setMessage('');
    setError('');
  }
  async function save() {
    const snapshot = JSON.stringify(draft);
    if (saved.current.existing && saved.current.snapshot === snapshot)
      return saved.current.existing;
    const result: DraftRef = await identityRequest(
      '/api/announcements',
      {
        operation: 'save',
        input: draft,
        previous: saved.current.existing,
      },
      'STAFF',
    );
    saved.current = { existing: result, snapshot };
    return result;
  }
  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await work();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="announcement-editor"
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          const result = await save();
          router.replace(`/${area}/announcements/${result.id}`);
          setMessage('草稿已保存。');
        });
      }}
    >
      <fieldset disabled={busy} className="announcement-edit-fields">
        <section className="panel profile-panel" aria-label="公告内容">
          <h2>公告内容</h2>
          <label>
            标题
            <input
              required
              maxLength={160}
              value={draft.title}
              onChange={(e) => update({ ...draft, title: e.target.value })}
            />
          </label>
          <label>
            正文
            <textarea
              required
              rows={7}
              maxLength={12000}
              value={draft.body}
              onChange={(e) => update({ ...draft, body: e.target.value })}
            />
          </label>
        </section>
        <section className="panel profile-panel" aria-label="接收范围">
          <div className="profile-section-heading">
            <span className="account-section-icon">
              <Users size={20} aria-hidden="true" />
            </span>
            <div>
              <h2>接收范围</h2>
              <p className="muted">发布前核对人数，发布后保留当时名单。</p>
            </div>
          </div>
          <AnnouncementAudiencePicker
            value={draft.audience}
            actorKind={actorKind}
            scopeName={
              JSON.stringify(draft.audience.scope) === JSON.stringify(initial.audience.scope)
                ? scopeName
                : undefined
            }
            onChange={(audience) => update({ ...draft, audience })}
          />
        </section>
      </fieldset>
      {message && (
        <p role="status" className="account-success">
          {message}
        </p>
      )}
      {error && !preview && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
      <div className="button-row announcement-editor-actions">
        <button className="button secondary" disabled={busy || !allowedToSave}>
          保存草稿
        </button>
        <button
          type="button"
          className="button primary"
          disabled={busy || !allowedToSave}
          onClick={() =>
            void run(async () => {
              const data: Preview = await identityRequest(
                '/api/announcements',
                { operation: 'preview', input: draft },
                'STAFF',
              );
              setPreview(data);
            })
          }
        >
          <Users size={17} aria-hidden="true" /> 预览接收人
        </button>
      </div>
      <Dialog
        open={!!preview}
        title="确认发布公告"
        onClose={() => setPreview(undefined)}
        busy={busy}
      >
        <h3>{draft.title}</h3>
        <p>
          共 <strong>{preview?.count ?? 0}</strong> 位接收人，其中教师 {preview?.teachers ?? 0}{' '}
          位，学生 {(preview?.count ?? 0) - (preview?.teachers ?? 0)} 位。
        </p>
        <p className="muted">
          {draft.audience.scope.kind === 'PLATFORM'
            ? '范围为全平台。'
            : '范围为已选学校及你的授权人员。'}{' '}
          教学邮件按各人设置发送。
        </p>
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => {
              setPreview(undefined);
              setError('');
            }}
          >
            返回编辑
          </button>
          <button
            type="button"
            className="button primary"
            disabled={busy || !preview?.count}
            onClick={() =>
              void run(async () => {
                const result = await save();
                await identityRequest(
                  '/api/announcements',
                  { operation: 'publish', ...result, fingerprint: preview!.fingerprint },
                  'STAFF',
                );
                setPreview(undefined);
                router.push(`/${area}/announcements/${result.id}`);
                router.refresh();
              })
            }
          >
            <Send size={16} aria-hidden="true" /> {busy ? '正在发布…' : '确认发布'}
          </button>
        </div>
      </Dialog>
    </form>
  );
}
