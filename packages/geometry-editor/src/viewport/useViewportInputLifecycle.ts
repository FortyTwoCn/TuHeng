import { useEffect, useEffectEvent, type RefObject } from 'react';
import { textEntry } from '../commands';
import type { Gesture } from '../selection-gesture';
import type { ViewportProps } from './viewport-types';

// 原生捕获处理释放、失焦和输入法边界，快捷键仍由所属编辑器处理。
export function useViewportInputLifecycle({
  props,
  svg,
  gesture,
  altHeld,
  skippedPick,
  cad,
  operationPending,
  cancel,
  cancelProjection,
  altRefresh,
  refreshCurrentSnap,
}: {
  props: ViewportProps;
  svg: RefObject<SVGSVGElement | null>;
  gesture: RefObject<Gesture | null>;
  altHeld: RefObject<boolean>;
  skippedPick: string | null;
  cad: ViewportProps['cad']['session'];
  operationPending: boolean;
  cancel: () => void;
  cancelProjection: () => void;
  altRefresh: (pressed: boolean) => void;
  refreshCurrentSnap: () => void;
}) {
  const altChanged = useEffectEvent((pressed: boolean) => {
    altRefresh(pressed);
  });
  const snapSettingsChanged = useEffectEvent(refreshCurrentSnap);
  useEffect(() => {
    snapSettingsChanged();
  }, [
    props.ortho,
    props.tracking,
    props.objectSnap,
    props.objectTypes,
    props.snapping,
    props.gridSnap,
    props.axesSnap,
    props.skipSnap,
    skippedPick,
  ]);
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const key = (e: KeyboardEvent) => {
      if (e.type === 'keyup' && e.key === 'Alt' && altHeld.current) {
        altChanged(false);
        return;
      }
      if (
        !el.closest('.geometry-editor')?.contains(document.activeElement) ||
        e.isComposing ||
        textEntry(e.target) ||
        (e.target instanceof Element &&
          !!e.target.closest('.geo-popover,.geo-floating-inspector,.geo-panel,.geo-reference-pane'))
      )
        return;
      if (e.key === 'Alt' && !e.ctrlKey && !e.metaKey && !e.repeat) {
        e.preventDefault();
        altChanged(e.type === 'keydown');
        return;
      }
      if (e.key === 'Escape') {
        if (!gesture.current && !operationPending) return;
        if (cad) {
          cancel();
          return;
        } // The editor's single command handler cancels the session.
        e.preventDefault();
        e.stopPropagation();
        cancel();
        cancelProjection();
      }
    };
    const blur = () => {
      cancel();
    };
    const owner = el.closest('.geometry-editor')!;
    owner.addEventListener('keydown', key as EventListener, true);
    owner.addEventListener('keyup', key as EventListener);
    window.addEventListener('blur', blur);
    const hidden = () => {
      if (document.hidden) blur();
    };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('orientationchange', blur);
    return () => {
      owner.removeEventListener('keydown', key as EventListener, true);
      owner.removeEventListener('keyup', key as EventListener);
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('orientationchange', blur);
    };
  }, [cancel, cancelProjection, operationPending, cad, gesture, svg, altHeld]);
}
