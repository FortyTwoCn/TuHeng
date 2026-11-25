import { useEffect, useRef, useState } from 'react';
import { Check, CornerDownLeft, SlidersHorizontal, X } from 'lucide-react';
import { CAD_COMMANDS } from '@tuheng/geometry-core';
import { EditorPopover } from './EditorPopover';
import { WorkspaceAction } from './WorkspaceAction';
import type { CadController } from './useCadCommand';

/** 参数和精确坐标均作为事件交给活动会话，校验与提交由命令负责。 */
export function CommandParameters({ cad, viewName }: { cad: CadController; viewName: string }) {
  const [input, setInput] = useState('');
  const session = cad.session;
  const command = CAD_COMMANDS.find((c) => c.id === session?.commandId);
  if (!session || !command) return null;
  const submitCoordinate = () => {
    if (!input.trim()) return;
    cad.send({ type: 'input', value: input });
    setInput('');
  };
  return (
    <EditorPopover
      label="精确输入与参数"
      buttonClass="cad-action cad-parameter-trigger"
      panelClass="cad-parameter-menu"
      trigger={
        <>
          <SlidersHorizontal size={16} />
          <span>参数</span>
        </>
      }
    >
      <h4>{command.name}参数</h4>
      <div className="cad-coordinate-form">
        <label>
          {viewName} 局部坐标 · mm
          <input
            autoComplete="off"
            aria-label="精确输入"
            placeholder="100,50 / @20,0 / @30<45"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              e.stopPropagation();
              if (!e.nativeEvent.isComposing) submitCoordinate();
            }}
          />
        </label>
        <button type="button" data-keep-open disabled={!input.trim()} onClick={submitCoordinate}>
          <CornerDownLeft size={14} /> 输入
        </button>
        <div className="cad-symbol-keys" aria-label="坐标符号">
          {['@', ',', '<', '-', '.'].map((symbol) => (
            <button
              type="button"
              key={symbol}
              data-keep-open
              onClick={() => setInput((v) => v + symbol)}
            >
              {symbol}
            </button>
          ))}
        </div>
      </div>
      {command.fields.length > 0 && (
        <div className="cad-parameters">
          {command.fields.map((field) => (
            <label key={field.key}>
              {field.label}
              {field.options ? (
                <select
                  value={session.parameters[field.key] ?? field.defaultValue}
                  onChange={(e) =>
                    cad.send({ type: 'parameters', values: { [field.key]: e.target.value } })
                  }
                >
                  {field.options.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
              ) : (
                <input
                  value={session.parameters[field.key] ?? field.defaultValue}
                  onChange={(e) =>
                    cad.send({ type: 'parameters', values: { [field.key]: e.target.value } })
                  }
                />
              )}
            </label>
          ))}
        </div>
      )}
    </EditorPopover>
  );
}
export function CommandSetup({ cad }: { cad: CadController }) {
  // 文字和多边形先确认创建参数。提交设置后，将焦点交回已进入取点阶段的画布。
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus({ preventScroll: true });
  }, []);
  const session = cad.session!;
  const text = session.commandId === 'text';
  const key = text ? 'content' : 'sides';
  const set = (key: string, value: string) =>
    cad.send({ type: 'parameters', values: { [key]: value } });
  function finish(type: 'confirm' | 'cancel') {
    const field = input.current;
    const canvas = field
      ?.closest('.geometry-editor')
      ?.querySelector<SVGSVGElement>('.geo-view > svg');
    cad.send({ type });
    requestAnimationFrame(() => {
      if (field && !field.isConnected) canvas?.focus({ preventScroll: true });
    });
  }
  return (
    <div
      className="cad-command-setup"
      role="group"
      aria-label={text ? '文字设置' : '多边形设置'}
      onKeyDown={(event) => {
        if (
          event.nativeEvent.isComposing ||
          (event.key !== 'Escape' &&
            !(event.key === 'Enter' && event.target instanceof HTMLInputElement))
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        finish(event.key === 'Escape' ? 'cancel' : 'confirm');
      }}
    >
      <label className="cad-setup-primary">
        {text ? '文字内容' : '边数'}
        <input
          ref={input}
          value={session.parameters[key]}
          onChange={(event) => set(key, event.target.value)}
          inputMode={text ? 'text' : 'numeric'}
          maxLength={text ? 400 : undefined}
          placeholder={text ? '例如 A—A 剖切面' : '3–256'}
          autoComplete="off"
        />
      </label>
      {text ? (
        <label>
          字高 (mm)
          <input
            inputMode="decimal"
            value={session.parameters.size}
            onChange={(event) => set('size', event.target.value)}
          />
        </label>
      ) : (
        <label>
          外接方式
          <select
            value={session.parameters.mode}
            onChange={(event) => set('mode', event.target.value)}
          >
            <option>内接于圆</option>
            <option>外切于圆</option>
          </select>
        </label>
      )}
      <div className="cad-steps">
        <WorkspaceAction label="取消" icon={X} onClick={() => finish('cancel')} />
        <button type="button" className="cad-action cad-accept" onClick={() => finish('confirm')}>
          <Check size={17} aria-hidden="true" />
          {text ? '定位文字' : '确定边数'}
        </button>
      </div>
    </div>
  );
}
