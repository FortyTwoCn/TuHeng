'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Dialog } from './Dialog';

/** One visible configuration form owns a draft; saving is acknowledged by its actual command. */
export function useDraftNavigation(busy = false) {
  const [dirty, setDirty] = useState(false),
    [confirm, setConfirm] = useState(false);
  const form = useRef<HTMLFormElement | null>(null),
    pending = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    const follow = (event: MouseEvent) => {
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        !(event.target instanceof Element)
      )
        return;
      const link = event.target.closest<HTMLAnchorElement>('a[href]');
      if (!link || link.target === '_blank' || link.hasAttribute('download')) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin || url.href === window.location.href) return;
      event.preventDefault();
      event.stopPropagation();
      if (busy) return;
      pending.current = () => setTimeout(() => window.location.assign(url.href), 0);
      setConfirm(true);
    };
    document.addEventListener('click', follow, true);
    return () => {
      window.removeEventListener('beforeunload', warn);
      document.removeEventListener('click', follow, true);
    };
  }, [dirty, busy]);
  function changed(e: FormEvent<HTMLElement>) {
    if (!(e.target instanceof HTMLElement)) return;
    const editing = e.target.closest<HTMLFormElement>('form[data-config-form]');
    if (editing) {
      form.current = editing;
      setDirty(true);
    }
  }
  function navigate(action: () => void) {
    if (busy) return;
    if (!dirty) {
      action();
      return;
    }
    pending.current = action;
    setConfirm(true);
  }
  function saved(action?: () => void) {
    setDirty(false);
    setConfirm(false);
    const next = pending.current ?? action;
    pending.current = null;
    next?.();
  }
  function keep() {
    pending.current = null;
    setConfirm(false);
  }
  const dialog = (
    <Dialog open={confirm} title="未保存的配置" busy={busy} onClose={keep}>
      <p>当前配置尚未保存。切换后会丢弃本次输入；已生效版本不受影响。</p>
      <div className="dialog-actions">
        <button type="button" onClick={keep}>
          继续编辑
        </button>
        <button type="button" className="button danger" onClick={() => saved()}>
          丢弃修改并切换
        </button>
        <button
          type="button"
          className="button primary"
          onClick={() => {
            setConfirm(false);
            requestAnimationFrame(() => form.current?.requestSubmit());
          }}
        >
          保存后切换
        </button>
      </div>
    </Dialog>
  );
  return { dirty, changed, navigate, saved, keep, dialog };
}
