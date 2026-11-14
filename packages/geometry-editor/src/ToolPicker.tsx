import { useState } from 'react';
import type { Tool } from './types';
import { commandRegistry, type CommandId } from './commands';
import { EditorPopover } from './EditorPopover';
export function ToolPicker({
  tool,
  run,
  readOnly,
  compact=false,
}: {
  tool: Tool;
  run: (id: CommandId) => void;
  readOnly: boolean;
  compact?: boolean;
}) {
  const [last, setLast] = useState({ line: 'segment' as CommandId, round: 'circle' as CommandId });
  const invoke = (id: CommandId) => {
    const entry = commandRegistry.find((e) => e.id === id)!;
    if (entry.group === 'line' || entry.group === 'round')
      setLast((v) => ({ ...v, [entry.group]: id }));
    run(id);
  };
  const button = (id: CommandId) => {
    const entry = commandRegistry.find((e) => e.id === id)!;
    return (
      <button
        key={id}
        data-command={id}
        type="button"
        disabled={readOnly && entry.requiresEdit}
        aria-pressed={entry.kind === 'tool' ? tool === id : undefined}
        onClick={() => invoke(id)}
      >
        {entry.name}
      </button>
    );
  };
  if(compact)return <>{button('select')}<EditorPopover label="绘图">{commandRegistry.filter(e=>['draw','line','round','select'].includes(e.group)&&e.id!=='select').map(e=>button(e.id))}</EditorPopover><EditorPopover label="构造">{commandRegistry.filter(e=>e.group==='construct'||e.group==='relation'||e.id==='line').map(e=>button(e.id))}</EditorPopover></>;
  return (
    <>
      {button('select')}
      {button('point')}
      {(['line', 'round'] as const).map((group) => (
        <span className="geo-split" key={group}>
          {button(last[group])}
          <EditorPopover label={group === 'line' ? '线工具' : '圆与圆弧'}>
            {commandRegistry.filter((e) => e.group === group).map((e) => button(e.id))}
          </EditorPopover>
        </span>
      ))}
      {button('pen')}
      <EditorPopover label="构造">
        {commandRegistry
          .filter((e) => e.group === 'construct' || e.id === 'line')
          .map((e) => button(e.id))}
      </EditorPopover>
      <EditorPopover label="关系">
        {commandRegistry.filter((e) => e.group === 'relation').map((e) => button(e.id))}
      </EditorPopover>
      <EditorPopover label="选择与平移">
        {commandRegistry.filter((e) => e.group === 'select').map((e) => button(e.id))}
      </EditorPopover>
    </>
  );
}
