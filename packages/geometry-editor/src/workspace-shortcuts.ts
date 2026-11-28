import type { KeyboardEvent } from 'react';
import { CAD_COMMANDS } from '@tuheng/geometry-core';
import { textEntry } from './commands';
import type { EditorSession, SessionAction } from './session';
import type { useEditorCommands } from './useEditorCommands';
import type { useConstructionPlayback } from './modules/animation/construction-playback';

export function workspaceShortcuts({
  playback,
  animation,
  exitTeaching,
  session,
  dispatch,
  commands,
  selected,
  select,
  undo,
  redo,
  toggle,
}: {
  playback: boolean;
  animation: ReturnType<typeof useConstructionPlayback>;
  exitTeaching: () => void;
  session: EditorSession;
  dispatch: (action: SessionAction) => void;
  commands: ReturnType<typeof useEditorCommands>;
  selected: string[];
  select: (ids: string[]) => void;
  undo: () => void;
  redo: () => void;
  toggle: (key: 'objectSnap' | 'ortho' | 'tracking') => void;
}) {
  const { panel } = session;
  const { cad, startCad, deleteSelection } = commands;
  return (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.nativeEvent.isComposing || textEntry(e.target) || e.defaultPrevented) return;
    if (playback) {
      if (e.target === e.currentTarget || e.target instanceof SVGSVGElement) {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          animation.jump(animation.index + (e.key === 'ArrowLeft' ? -1 : 1));
        }
        if (e.code === 'Space' && !e.repeat) {
          e.preventDefault();
          animation.togglePlay();
        }
        if (e.key === 'Escape') exitTeaching();
      }
      return;
    }
    if (
      (e.target === e.currentTarget || e.target instanceof SVGSVGElement) &&
      !panel &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      !e.shiftKey &&
      (e.key === 'F3' || e.key === 'F8' || e.key === 'F11')
    ) {
      e.preventDefault();
      if (!e.repeat) toggle(e.key === 'F3' ? 'objectSnap' : e.key === 'F8' ? 'ortho' : 'tracking');
      return;
    }
    if (
      cad.session &&
      (e.key === 'Escape' || (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)))
    ) {
      e.preventDefault();
      if (e.key === 'Escape' && e.repeat) return;
      cad.send({ type: e.key === 'Escape' ? 'cancel' : 'confirm' });
      return;
    }
    if (
      !cad.session &&
      !panel &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      (e.target === e.currentTarget || e.target instanceof SVGSVGElement) &&
      /^[a-z]$/i.test(e.key)
    ) {
      const cmd = CAD_COMMANDS.find((c) => c.aliases.includes(e.key.toLowerCase()));
      if (cmd) {
        e.preventDefault();
        startCad(cmd.id);
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
    }
    if (!cad.session && (e.key === 'Delete' || e.key === 'Backspace')) {
      e.preventDefault();
      deleteSelection();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      if (panel) dispatch({ type: 'patch', patch: { panel: null } });
      else if (session.construction) dispatch({ type: 'patch', patch: { construction: null } });
      else if (selected.length) select([]);
      else dispatch({ type: 'tool', tool: 'select' });
    }
  };
}
