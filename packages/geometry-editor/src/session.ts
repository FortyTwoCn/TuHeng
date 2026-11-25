import type { CadSession } from '@tuheng/geometry-core';
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

type Activity =
  | { kind: 'tool'; tool: Tool }
  | { kind: 'cad'; command: CadSession; version: string }
  | { kind: 'construction'; command: ConstructionSession }
  | { kind: 'axis' };

export interface WorkspaceSession {
  activity: Activity;
  selected: string[];
  panel: Exclude<EditorPanel, 'axis'>;
  active: string;
  expanded: boolean;
}
// 从唯一活动命令派生视口状态。绘图、构造、选取投影轴和选择工具互斥。
export function viewportSession(state: WorkspaceSession) {
  const { activity } = state;
  return {
    ...state,
    selected: activity.kind === 'cad' ? activity.command.ids : state.selected,
    tool: activity.kind === 'tool' ? activity.tool : ('select' as const),
    construction: activity.kind === 'construction' ? activity.command : null,
    panel: activity.kind === 'axis' ? ('axis' as const) : state.panel,
  };
}
export type EditorSession = ReturnType<typeof viewportSession>;
type ViewPatch = Partial<
  Pick<EditorSession, 'selected' | 'panel' | 'construction' | 'active' | 'expanded' | 'tool'>
>;
export type SessionAction =
  | { type: 'patch'; patch: ViewPatch }
  | { type: 'tool'; tool: Tool }
  | { type: 'cad'; command: CadSession; version: string }
  | { type: 'select'; ids: string[] };
export function sessionReducer(state: WorkspaceSession, action: SessionAction): WorkspaceSession {
  if (action.type === 'cad')
    return {
      ...state,
      selected: [],
      panel: null,
      activity: { kind: 'cad', command: action.command, version: action.version },
    };
  if (action.type === 'tool')
    return { ...state, panel: null, activity: { kind: 'tool', tool: action.tool } };
  if (action.type === 'select') {
    return state.selected.length === action.ids.length &&
      state.selected.every((id, i) => id === action.ids[i])
      ? state
      : { ...state, selected: action.ids };
  }
  const { panel, construction, tool, ...other } = action.patch;
  let activity = state.activity;
  if (construction) activity = { kind: 'construction', command: construction };
  else if (panel === 'axis') activity = { kind: 'axis' };
  else if (tool) activity = { kind: 'tool', tool };
  else if (
    (construction === null && activity.kind === 'construction') ||
    (panel !== undefined && activity.kind === 'axis')
  )
    activity = { kind: 'tool', tool: 'select' };
  return {
    ...state,
    ...other,
    panel: panel === 'axis' ? null : panel === undefined ? state.panel : panel,
    activity,
  };
}
