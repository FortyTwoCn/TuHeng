import type { GeometryDocument } from '@tuheng/contracts';
import { editable, resolveReference, targetFromKey } from '@tuheng/geometry-core';
import type { Tool } from './types';
export type CommandId =
  | Tool
  | 'construct-parallel'
  | 'construct-perpendicular'
  | 'relation-parallel'
  | 'relation-perpendicular'
  | 'new-axis';
export type CommandEntry = {
  id: CommandId;
  name: string;
  group: 'draw' | 'line' | 'round' | 'construct' | 'relation' | 'select';
  kind: 'tool' | 'command';
  requiresEdit: boolean;
  appliesTo: 'any' | 'line-reference' | 'editable-line';
};
export const commandRegistry: CommandEntry[] = [
  {
    id: 'select',
    name: '选择',
    group: 'draw',
    kind: 'tool',
    requiresEdit: false,
    appliesTo: 'any',
  },
  { id: 'point', name: '点', group: 'draw', kind: 'tool', requiresEdit: true, appliesTo: 'any' },
  {
    id: 'segment',
    name: '实线',
    group: 'line',
    kind: 'tool',
    requiresEdit: true,
    appliesTo: 'any',
  },
  { id: 'curve', name: '曲线', group: 'line', kind: 'tool', requiresEdit: true, appliesTo: 'any' },
  { id: 'hidden', name: '虚线', group: 'line', kind: 'tool', requiresEdit: true, appliesTo: 'any' },
  { id: 'line', name: '辅助线', group: 'line', kind: 'tool', requiresEdit: true, appliesTo: 'any' },
  { id: 'circle', name: '圆', group: 'round', kind: 'tool', requiresEdit: true, appliesTo: 'any' },
  { id: 'arc', name: '圆弧', group: 'round', kind: 'tool', requiresEdit: true, appliesTo: 'any' },
  { id: 'pen', name: '电子笔', group: 'draw', kind: 'tool', requiresEdit: true, appliesTo: 'any' },
  {
    id: 'construct-parallel',
    name: '平行线',
    group: 'construct',
    kind: 'command',
    requiresEdit: true,
    appliesTo: 'line-reference',
  },
  {
    id: 'construct-perpendicular',
    name: '垂直线',
    group: 'construct',
    kind: 'command',
    requiresEdit: true,
    appliesTo: 'line-reference',
  },
  {
    id: 'new-axis',
    name: '新增投影轴',
    group: 'construct',
    kind: 'command',
    requiresEdit: true,
    appliesTo: 'any',
  },
  {
    id: 'connect',
    name: '连接两点',
    group: 'relation',
    kind: 'tool',
    requiresEdit: true,
    appliesTo: 'any',
  },
  {
    id: 'relation-parallel',
    name: '调整为平行',
    group: 'relation',
    kind: 'command',
    requiresEdit: true,
    appliesTo: 'editable-line',
  },
  {
    id: 'relation-perpendicular',
    name: '调整为垂直',
    group: 'relation',
    kind: 'command',
    requiresEdit: true,
    appliesTo: 'editable-line',
  },
  {
    id: 'projection',
    name: '投影关联',
    group: 'relation',
    kind: 'tool',
    requiresEdit: true,
    appliesTo: 'any',
  },
  {
    id: 'box',
    name: '框选（两次点击）',
    group: 'select',
    kind: 'tool',
    requiresEdit: false,
    appliesTo: 'any',
  },
  { id: 'pan', name: '平移', group: 'select', kind: 'tool', requiresEdit: false, appliesTo: 'any' },
];
export function commandUnavailable(
  entry: CommandEntry,
  readOnly: boolean,
  editorType: GeometryDocument['editorType'],
): string | undefined {
  if (readOnly && entry.requiresEdit) return '当前文档只读';
  if (entry.id === 'new-axis' && editorType !== 'VHW_PROJECTION' && editorType !== 'THREE_VIEW')
    return '换面轴用于 VHW 或三视图展开图';
}
export function contextCommandAvailable(
  entry: CommandEntry,
  doc: GeometryDocument,
  selected: string[],
  role: 'student' | 'teacher',
  readOnly: boolean,
) {
  if (commandUnavailable(entry, readOnly, doc.editorType)) return false;
  if (entry.appliesTo === 'any') return true;
  const ref = targetFromKey(selected[0] ?? '');
  if (
    !selected.length ||
    (ref.kind === 'entity' &&
      !doc.entities.some(
        (e) => e.id === ref.entityId && (e.kind === 'segment' || e.kind === 'line'),
      )) ||
    ref.kind === 'origin'
  )
    return false;
  if (entry.appliesTo === 'line-reference') return selected.length === 1;
  const target = doc.entities.find((e) => e.id === selected[1]);
  if (
    selected.length !== 2 ||
    !target ||
    !['line', 'segment'].includes(target.kind) ||
    !editable(doc, target, role)
  )
    return false;
  const r = resolveReference(doc, ref);
  return (
    !r.viewId ||
    r.viewId === target.viewId ||
    (ref.kind === 'entity' && doc.entities.find((e) => e.id === ref.entityId)?.scope === 'SHEET')
  );
}
export function textEntry(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    !!target.closest('input,textarea,select,[contenteditable=true]')
  );
}
