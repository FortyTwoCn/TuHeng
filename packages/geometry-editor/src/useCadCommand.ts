import { useMemo, useRef, type Dispatch } from 'react';
import type { WorkspaceSession, SessionAction } from './session';
import type { GeometryDocument } from '@tuheng/contracts';
import {
  CAD_COMMANDS,
  cadPrompt,
  cadStep,
  startCadSession,
  type CadSession,
  type CadCommandId,
} from '@tuheng/geometry-core';
import type { Appearance } from './CadPreferences';

export type CadInput = Parameters<typeof cadStep>[2];
export type CadId = CadCommandId;
export interface CadController {
  session: CadSession | null;
  send: (...events: CadInput[]) => { next: GeometryDocument; raw?: GeometryDocument } | undefined;
  start: (id: CadId) => void;
  repeat: () => boolean;
}

export function useCadCommand(
  activity: WorkspaceSession['activity'],
  dispatch: Dispatch<SessionAction>,
  doc: GeometryDocument,
  fingerprint: string,
  viewId: string,
  role: 'student' | 'teacher',
  readOnly: boolean,
  selected: string[],
  commit: (next: GeometryDocument, label?: string) => GeometryDocument | undefined,
  report: (message: string) => void,
  appearance: Appearance,
): CadController {
  const session =
    activity.kind === 'cad' &&
    activity.version === fingerprint &&
    !readOnly &&
    activity.command.role === role
      ? activity.command
      : null;
  const current = useMemo(
    () => session && { ...session, baseDocument: doc, appearance },
    [session, doc, appearance],
  );
  const lastCommand = useRef<CadId>(undefined);
  function start(id: CadId) {
    if (readOnly) return;
    try {
      const next = { ...startCadSession(id, doc, viewId, role, selected), appearance };
      dispatch({ type: 'cad', command: next, version: fingerprint });
      report(cadPrompt(next));
      if (id !== 'clear' && id !== 'erase') lastCommand.current = id;
    } catch (error) {
      report(error instanceof Error ? error.message : '无法开始命令');
    }
  }
  function send(...events: CadInput[]) {
    if (!current || readOnly) return;
    try {
      let operation: CadSession | null = current;
      let base = doc;
      let version = fingerprint;
      let edited: { next: GeometryDocument; raw?: GeometryDocument } | undefined;
      for (const event of events) {
        if (!operation) break;
        const result = cadStep(operation, base, event);
        if (result.document) {
          const applied = commit(
            result.document,
            CAD_COMMANDS.find((c) => c.id === current.commandId)?.name,
          );
          if (!applied) return;
          version = JSON.stringify(applied);
          base = applied;
          edited = { next: applied, raw: result.unsnapped };
        }
        operation = result.session;
        report(result.message);
      }
      dispatch(
        operation ? { type: 'cad', command: operation, version } : { type: 'tool', tool: 'select' },
      );
      return edited;
    } catch (error) {
      report(error instanceof Error ? error.message : '输入无效');
    }
  }
  function repeat() {
    if (readOnly || !lastCommand.current) return false;
    start(lastCommand.current);
    return true;
  }
  return { session: current, start, repeat, send };
}
