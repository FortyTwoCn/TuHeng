import { useRef, useEffect, type ReactNode } from 'react';
import { textEntry } from './commands';
export function EditorToolbar({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const buttons = (el: HTMLElement) =>
    [...el.querySelectorAll<HTMLButtonElement>('button')].filter(
      (b) => !b.disabled && b.getClientRects().length,
    );
  useEffect(() => {
    const el = ref.current!;
    const sync = () => {
      const list = buttons(el),
        current =
          list.find((b) => b === document.activeElement) ??
          list.find((b) => b.tabIndex === 0) ??
          list[0];
      list.forEach((b) => {
        b.tabIndex = b === current ? 0 : -1;
      });
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(el, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled'],
    });
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className="geo-main-toolbar"
      role="toolbar"
      aria-label="几何工具"
      onFocusCapture={(e) => {
        const target=e.target;
        if (target instanceof HTMLButtonElement)
          buttons(e.currentTarget).forEach((b) => {
            b.tabIndex = b === target ? 0 : -1;
          });
      }}
      onKeyDown={(e) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key) || textEntry(e.target))
          return;
        const list = buttons(e.currentTarget),
          i = list.indexOf(e.target as HTMLButtonElement);
        if (i < 0) return;
        e.preventDefault();
        list[
          e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? list.length - 1
              : (i + (e.key === 'ArrowRight' ? 1 : -1) + list.length) % list.length
        ].focus();
      }}
    >
      {children}
    </div>
  );
}
