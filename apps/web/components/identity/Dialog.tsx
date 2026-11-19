'use client';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

/** Native modal focus handling is shared by sensitive prompts and detail drawers. */
export function Dialog({
  open,
  title,
  onClose,
  busy = false,
  drawer = false,
  className = '',
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  busy?: boolean;
  drawer?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (!open || !element) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.showModal();
    return () => {
      element.close();
      trigger?.focus({ preventScroll: true });
    };
  }, [open]);
  if (!open) return null;
  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      className={'ui-dialog' + (drawer ? ' ui-drawer' : '') + (className ? ' ' + className : '')}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header className="ui-dialog-heading">
        <h2 id={titleId}>{title}</h2>
        <button
          type="button"
          className="icon-button"
          disabled={busy}
          aria-label="关闭对话框"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </header>
      <div className="ui-dialog-body">{children}</div>
    </dialog>
  );
}
