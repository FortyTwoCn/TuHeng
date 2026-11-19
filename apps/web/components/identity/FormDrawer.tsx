'use client';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Dialog } from './Dialog';

export const FormFeedback = createContext<{
  error: string;
  clear: () => void;
  notice?: ReactNode;
}>({ error: '', clear: () => {} });

/** A single editing form owns its draft; reference/secondary operations use their own drawer. */
export function FormDrawer({
  title,
  trigger,
  children,
  busy = false,
  primary = false,
  className,
}: {
  title: string;
  trigger: string;
  busy?: boolean;
  primary?: boolean;
  className?: string;
  children: (saved: () => void) => ReactNode;
}) {
  const feedback = useContext(FormFeedback);
  const [open, setOpen] = useState(false),
    [dirty, setDirty] = useState(false),
    [confirm, setConfirm] = useState(false);
  const owner = useRef<HTMLDivElement>(null),
    form = useRef<HTMLFormElement | null>(null);
  useEffect(() => {
    if (!open) form.current = null;
  }, [open]);
  useEffect(() => {
    if (!open || !dirty) return;
    const before = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', before);
    return () => window.removeEventListener('beforeunload', before);
  }, [open, dirty]);
  function close() {
    setOpen(false);
    setDirty(false);
    setConfirm(false);
  }
  return (
    <>
      <button
        type="button"
        className={'button ' + (primary ? 'primary' : 'secondary')}
        disabled={busy}
        onClick={() => {
          feedback.clear();
          setOpen(true);
        }}
      >
        {trigger}
      </button>
      <Dialog
        open={open}
        title={title}
        drawer
        className={className}
        busy={busy}
        onClose={() => (dirty ? setConfirm(true) : close())}
      >
        <div
          ref={owner}
          data-draft-owner
          onChange={(e) => {
            if (
              !(e.target instanceof HTMLElement) ||
              e.target.closest('[data-draft-owner]') !== owner.current
            )
              return;
            const changed = e.target.closest('form');
            if (changed) {
              form.current = changed;
              setDirty(true);
            }
          }}
        >
          {children(close)}
          {feedback.error && (
            <p role="alert" className="field-error">
              {feedback.error}
            </p>
          )}
        </div>
      </Dialog>
      <Dialog open={confirm} title="未保存的修改" busy={busy} onClose={() => setConfirm(false)}>
        <p>保存后关闭，或丢弃本次尚未保存的输入。已保存的资料不会受影响。</p>
        <div className="dialog-actions">
          <button type="button" className="button secondary" onClick={() => setConfirm(false)}>
            继续编辑
          </button>
          <button type="button" className="button danger" onClick={close}>
            丢弃修改
          </button>
          <button
            type="button"
            className="button primary"
            onClick={() => {
              setConfirm(false);
              requestAnimationFrame(() => form.current?.requestSubmit());
            }}
          >
            保存后关闭
          </button>
        </div>
      </Dialog>
    </>
  );
}
