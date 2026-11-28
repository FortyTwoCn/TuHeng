'use client';
import { createId } from '@tuheng/contracts';
import { useId, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ClipboardList, Save, Send } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Uploader, type UploadedAsset } from './Uploader';
import { action } from './Actions';
import type { GeometryDocument } from '@tuheng/contracts';
import { GeometryEditor } from '@tuheng/geometry-editor';
export function SubmissionEditor({
  itemId,
  selfTestItemId,
  reviewEntryId,
  initial = [],
  problemGeometry,
  draftGeometry,
  assignmentTask,
  children,
}: {
  itemId?: string;
  selfTestItemId?: string;
  reviewEntryId?: string;
  initial?: UploadedAsset[];
  problemGeometry?: GeometryDocument | null;
  draftGeometry?: GeometryDocument | null;
  assignmentTask?: {
    number: number;
    count: number;
    title: string;
    content: string;
    maxPoints: string;
    attempts: number;
    maxAttempts: number;
    hasDraft: boolean;
  };
  children?: ReactNode;
}) {
  const router = useRouter();
  const [assets, setAssets] = useState(initial),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const key = useRef<string | null>(null);
  const taskPanelId = useId();
  const [taskOpen, setTaskOpen] = useState(false);
  const taskToggle = useRef<HTMLButtonElement>(null);
  const changes = useRef(0);
  const [draftState, setDraftState] = useState<'new' | 'saved' | 'edited'>(
    assignmentTask?.hasDraft ? 'saved' : 'new',
  );
  function edited() {
    changes.current++;
    key.current = null;
    setDraftState('edited');
    setMessage('');
  }
  const [geometry, setGeometry] = useState<GeometryDocument | undefined>(
    draftGeometry ?? problemGeometry ?? undefined,
  );
  const uploader = (
    <Uploader
      value={assets}
      onChange={(next) => {
        edited();
        setAssets(next);
      }}
      realm="STUDENT"
      target={
        itemId
          ? { kind: 'ASSIGNMENT_ANSWER', itemId }
          : reviewEntryId
            ? { kind: 'REVIEW_ANSWER', entryId: reviewEntryId }
            : { kind: 'SELFTEST_ANSWER', itemId: selfTestItemId! }
      }
    />
  );
  const actions = (
    <>
      <div className="button-row submission-actions">
        {itemId && (
          <button
            className="button secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const revision = changes.current;
              try {
                await action('draft', { itemId, assetIds: assets.map((a) => a.id), geometry });
                if (changes.current === revision) {
                  setDraftState('saved');
                  setMessage('草稿已保存，可稍后继续。');
                } else {
                  setMessage('先前草稿已保存，当前还有新修改。');
                }
                router.refresh();
              } catch (e) {
                setMessage((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {assignmentTask && <Save size={16} aria-hidden="true" />}
            保存草稿
          </button>
        )}
        <button
          className="button primary"
          disabled={
            (!assets.length &&
              !geometry?.entities.some(
                (e) => geometry.layers.find((l) => l.id === e.layerId)?.role !== 'PROBLEM_STEM',
              )) ||
            busy
          }
          onClick={async () => {
            if (!window.confirm('正式提交后将保存为独立作答版本，是否提交？')) return;
            setBusy(true);
            if (!key.current) key.current = createId();
            try {
              const result = await action('submit', {
                itemId,
                selfTestItemId,
                reviewEntryId,
                assetIds: assets.map((a) => a.id),
                idempotencyKey: key.current,
                geometry,
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
          {assignmentTask && <Send size={16} aria-hidden="true" />}
          {busy ? '处理中…' : '正式提交并排队批改'}
        </button>
      </div>
      {message && (
        <p role="status" className="alert">
          {message}
        </p>
      )}
    </>
  );
  return (
    <div className={assignmentTask ? 'submission-editor cad-assignment' : 'submission-editor'}>
      {geometry && (
        <div className="cad-answer-sheet">
          <GeometryEditor
            value={geometry}
            problemDocument={problemGeometry ?? undefined}
            referenceDocument={problemGeometry}
            referenceTitle="题目参考图纸"
            onChange={(next) => {
              edited();
              setGeometry(next);
            }}
            role="student"
            documentName="作答图纸"
          />
        </div>
      )}
      {assignmentTask ? (
        <>
          <button
            className="cad-task-toggle button secondary"
            type="button"
            ref={taskToggle}
            aria-expanded={taskOpen}
            aria-controls={taskPanelId}
            onClick={() => setTaskOpen(!taskOpen)}
          >
            <ClipboardList size={17} aria-hidden="true" />{' '}
            {taskOpen ? '收起题目与提交' : '查看题目与提交'}
          </button>
          <aside
            aria-label="本题作答"
            className="cad-task-panel"
            id={taskPanelId}
            data-open={taskOpen}
            onKeyDown={(event) => {
              if (taskOpen && event.key === 'Escape' && taskToggle.current?.offsetWidth) {
                event.stopPropagation();
                setTaskOpen(false);
                taskToggle.current.focus();
              }
            }}
          >
            <header className="cad-task-heading">
              <span>
                <ClipboardList size={17} aria-hidden="true" /> 第 {assignmentTask.number} /{' '}
                {assignmentTask.count} 题
              </span>
              <span>{assignmentTask.maxPoints} 分</span>
            </header>
            <h2>{assignmentTask.title}</h2>
            <p className="cad-task-requirement">{assignmentTask.content}</p>
            {children}
            <details className="cad-task-extra">
              <summary>
                补充作答图片{assets.length > 0 && `（${assets.length}）`}{' '}
                <ChevronDown size={15} aria-hidden="true" />
              </summary>
              {uploader}
            </details>
            <div className="cad-task-submit">
              <dl>
                <div>
                  <dt>草稿</dt>
                  <dd>
                    {draftState === 'edited'
                      ? '有未保存修改'
                      : draftState === 'saved'
                        ? '已保存'
                        : '未保存'}
                  </dd>
                </div>
                <div>
                  <dt>正式提交</dt>
                  <dd>
                    {assignmentTask.attempts} / {assignmentTask.maxAttempts} 次
                  </dd>
                </div>
              </dl>
              {actions}
            </div>
          </aside>
        </>
      ) : (
        <>
          {uploader}
          {actions}
          <p className="muted small">提交时间由服务器记录。关闭页面不会取消已创建的批改任务。</p>
        </>
      )}
    </div>
  );
}
