import type { PenStrokeStyle } from '@tuheng/geometry-core';
import { useState } from 'react';
import type { GeometryDocument } from '@tuheng/contracts';
import type { Tool } from './types';
import { commandRegistry, commandUnavailable, type CommandId } from './commands';
import { EditorPopover } from './EditorPopover';
const penNames: Record<PenStrokeStyle, string> = {
  visible: '实线',
  hidden: '虚线',
  construction: '辅助线',
};
export function ToolPicker({
  tool,
  penStyle,
  setPenStyle,
  run,
  readOnly,
  compact = false,
  editorType,
}: {
  tool: Tool;
  penStyle: PenStrokeStyle;
  setPenStyle: (style: PenStrokeStyle) => void;
  run: (id: CommandId) => void;
  readOnly: boolean;
  compact?: boolean;
  editorType: GeometryDocument['editorType'];
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
    const reason = commandUnavailable(entry, readOnly, editorType);
    return (
      <button
        key={id}
        data-command={id}
        aria-label={id === 'pen' ? '电子笔' : undefined}
        type="button"
        disabled={!!reason}
        title={reason}
        aria-pressed={entry.kind === 'tool' ? tool === id : undefined}
        onClick={() => invoke(id)}
      >
        {entry.name}
        {id === 'pen' ? ` · ${penNames[penStyle]}` : ''}
      </button>
    );
  };
  const penStyles = (Object.keys(penNames) as PenStrokeStyle[]).map((style) => (
    <button
      key={style}
      type="button"
      data-command={`pen-${style}`}
      disabled={readOnly}
      aria-pressed={tool === 'pen' && penStyle === style}
      onClick={() => {
        setPenStyle(style);
        invoke('pen');
      }}
    >
      {penNames[style]}笔迹
    </button>
  ));
  if (compact)
    return (
      <>
        {button('select')}
        <EditorPopover label="绘图">
          {commandRegistry
            .filter(
              (e) => ['draw', 'line', 'round', 'select'].includes(e.group) && e.id !== 'select',
            )
            .map((e) => button(e.id))}
          {penStyles}
        </EditorPopover>
        <EditorPopover label="构造">
          {commandRegistry
            .filter((e) => e.group === 'construct' || e.group === 'relation' || e.id === 'line')
            .map((e) => button(e.id))}
        </EditorPopover>
      </>
    );
  return (
    <>
      {button('select')}
      {button('point')}
      {(['line', 'round'] as const).map((group) => (
        <span
          className="geo-split"
          role="group"
          aria-label={group === 'line' ? '线' : '圆与圆弧'}
          key={group}
        >
          {button(last[group])}
          <EditorPopover arrowOnly label={group === 'line' ? '线工具' : '圆与圆弧'}>
            {commandRegistry.filter((e) => e.group === group).map((e) => button(e.id))}
          </EditorPopover>
        </span>
      ))}
      <span className="geo-split" role="group" aria-label="电子笔">
        {button('pen')}
        <EditorPopover arrowOnly label="电子笔线型">
          {penStyles}
        </EditorPopover>
      </span>
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
