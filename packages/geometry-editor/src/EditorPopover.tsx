'use client';
import { useId, useRef, useState, useEffect, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { autoUpdate, computePosition, offset, flip, shift } from '@floating-ui/dom';
export function EditorPopover({
  label,
  children,
  trigger,
  buttonClass,
  panelClass,
  triggerRef,
}: {
  label: string;
  children: ReactNode;
  trigger?: ReactNode;
  buttonClass?: string;
  panelClass?: string;
  triggerRef?: RefObject<HTMLButtonElement | null>;
}) {
  const id = useId();
  const ownButton = useRef<HTMLButtonElement>(null);
  const button = triggerRef ?? ownButton;
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false),
    [host, setHost] = useState<HTMLElement | null>(null);
  function openPopover() {
    setHost(button.current?.closest<HTMLElement>('.geometry-editor') ?? null);
    setOpen(true);
  }
  useEffect(() => {
    const a = button.current,
      b = panel.current;
    if (!open || !a || !b) return;
    const focusTarget =
      b.querySelector<HTMLElement>('[data-initial-focus]') ??
      b.querySelector<HTMLButtonElement>('button:not(:disabled)');
    focusTarget?.focus();
    const cleanup = autoUpdate(a, b, () => {
      void computePosition(a, b, {
        strategy: 'fixed',
        placement: 'bottom-start',
        middleware: [offset(6), flip(), shift({ padding: 8 })],
      }).then((p) => Object.assign(b.style, { left: `${p.x}px`, top: `${p.y}px` }));
    });
    const outside = (e: PointerEvent) => {
      if (!b.contains(e.target as Node) && !a.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => {
      cleanup();
      document.removeEventListener('pointerdown', outside);
    };
  }, [open, button]);
  return (
    <>
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-label={label}
        aria-controls={open ? id : undefined}
        aria-haspopup="dialog"
        className={buttonClass}
        title={label}
        onClick={() => (open ? setOpen(false) : openPopover())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            e.stopPropagation();
            openPopover();
          }
          if (open && e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          }
        }}
      >
        {trigger ?? label}{' '}
        <span className="cad-menu-arrow" aria-hidden>
          ⌄
        </span>
      </button>
      {open &&
        host &&
        createPortal(
          <div
            ref={panel}
            id={id}
            className={`geo-popover${panelClass ? ' ' + panelClass : ''}`}
            role="dialog"
            aria-label={`${label}菜单`}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                setOpen(false);
                button.current?.focus();
              }
              if (
                e.target instanceof HTMLButtonElement &&
                ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)
              ) {
                const buttons = [
                  ...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
                ];
                const index = buttons.indexOf(e.target);
                if (index >= 0) {
                  e.preventDefault();
                  e.stopPropagation();
                  const next =
                    e.key === 'Home'
                      ? 0
                      : e.key === 'End'
                        ? buttons.length - 1
                        : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) %
                          buttons.length;
                  buttons[next]?.focus();
                }
              }
            }}
            onClick={(e) => {
              const b = (e.target as Element).closest('button');
              if (
                b &&
                !b.hasAttribute('data-keep-open') &&
                (b.hasAttribute('data-command') ||
                  (!b.hasAttribute('aria-expanded') && !b.hasAttribute('aria-pressed')))
              )
                setOpen(false);
            }}
          >
            {children}
          </div>,
          host,
        )}
    </>
  );
}
