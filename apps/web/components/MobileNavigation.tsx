'use client';
import { useRef } from 'react';
import Link from 'next/link';
import { MoreHorizontal, X } from 'lucide-react';
import { Logout } from './Actions';

export function MobileNavigation({
  items,
  realm,
}: {
  items: { href: string; label: string; active: boolean }[];
  realm: 'STAFF' | 'STUDENT';
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button
        className="mobile-more"
        aria-label="更多导航"
        aria-haspopup="dialog"
        onClick={() => dialog.current?.showModal()}
      >
        <MoreHorizontal size={21} />
        <span>更多</span>
      </button>
      <dialog ref={dialog} className="mobile-navigation-sheet" aria-label="更多工作空间导航">
        <div className="mobile-navigation-heading">
          <strong>工作空间</strong>
          <button aria-label="关闭导航" onClick={() => dialog.current?.close()}>
            <X size={20} />
          </button>
        </div>
        <nav aria-label="移动端更多导航">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={item.active ? 'page' : undefined}
              onClick={() => dialog.current?.close()}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <Logout realm={realm} />
      </dialog>
    </>
  );
}
