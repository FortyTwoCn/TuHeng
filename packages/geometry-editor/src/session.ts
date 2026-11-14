import type { Tool } from './types';
import type { GeometryTargetRef } from '@tuheng/contracts';
import type { ConstructionSpec } from '@tuheng/geometry-core';
export type EditorPanel = 'settings' | 'file' | 'properties' | 'axis' | null;
export type ConstructionSession = {
  mode: 'create' | 'adjust';
  spec: ConstructionSpec;
  reference?: GeometryTargetRef;
  targetId?: string;
  keep: boolean;
  phase: 'reference' | 'position' | 'target' | 'confirm';
};
export interface EditorSession {
  tool: Tool;
  selected: string[];
  panel: EditorPanel;
  construction: ConstructionSession | null;
  active: string;
  expanded: boolean;
}
export type SessionAction =
  | { type: 'patch'; patch: Partial<EditorSession> }
  | { type: 'tool'; tool: Tool }
  | { type: 'select'; ids: string[] };
export function sessionReducer(state: EditorSession, action: SessionAction): EditorSession {
  if (action.type === 'patch') return { ...state, ...action.patch };
  if (action.type === 'select') return { ...state, selected: action.ids };
  return { ...state, tool: action.tool, construction: null, panel: null };
}
