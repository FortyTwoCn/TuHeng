import { useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from 'react';
import type { Vec2 } from '@tuheng/contracts';
import { formatCadAngle } from '@tuheng/geometry-core';
import './dynamic-line.css';

export type LineFields = { length?: string; angle?: string };
export type DynamicInputHandle = { start: (text?: string) => void };

function MeasurementField({
  label,
  value,
  suffix,
  inputRef,
  pin,
  change,
  commit,
  cancel,
  next,
}: {
  label: string;
  value: string;
  suffix: string;
  inputRef: Ref<HTMLInputElement>;
  pin: () => void;
  change: (text: string) => void;
  commit: () => void;
  cancel: () => void;
  next?: () => void;
}) {
  return (
    <label>
      <span>{label}</span>
      <input
        ref={inputRef}
        aria-label={'动态' + label}
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onFocus={(e) => {
          pin();
          e.target.select();
        }}
        onChange={(e) => change(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === 'Tab' && !next) return;
          if (!['Enter', 'Escape', 'Tab'].includes(e.key)) return;
          e.preventDefault();
          e.stopPropagation();
          if (e.key === 'Enter') commit();
          else if (e.key === 'Escape') cancel();
          else next?.();
        }}
      />
      <small>{suffix}</small>
    </label>
  );
}

export function DynamicLineInput({
  anchor,
  from,
  size,
  length,
  angle,
  fields,
  change,
  commit,
  cancel,
  handle,
  error,
  measure = 'line',
  confirmLabel = '确认本段',
}: {
  anchor: Vec2;
  from?: Vec2;
  size: { width: number; height: number };
  length: number;
  angle: number;
  fields: LineFields;
  change: (fields: LineFields) => void;
  commit: () => void;
  cancel: () => void;
  handle: Ref<DynamicInputHandle>;
  error?: string;
  measure?: 'line' | 'radius' | 'angle' | 'opening';
  confirmLabel?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const lengthInput = useRef<HTMLInputElement>(null);
  const angleInput = useRef<HTMLInputElement>(null);
  const [pin, setPin] = useState<Vec2>();
  const [usableHeight, setUsableHeight] = useState(size.height);
  const [panelSize, setPanelSize] = useState({ width: 196, height: 44 });
  useLayoutEffect(() => {
    const el = panel.current;
    if (!el) return;
    const viewport = window.visualViewport;
    const measure = () => {
      const top = el.parentElement!.getBoundingClientRect().top;
      setUsableHeight(
        viewport ? Math.min(size.height, viewport.offsetTop + viewport.height - top) : size.height,
      );
      setPanelSize({ width: el.offsetWidth, height: el.offsetHeight });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    measure();
    viewport?.addEventListener('resize', measure);
    viewport?.addEventListener('scroll', measure);
    return () => {
      observer.disconnect();
      viewport?.removeEventListener('resize', measure);
      viewport?.removeEventListener('scroll', measure);
    };
  }, [size.height]);
  const left = anchor.x - 16 - panelSize.width,
    right = anchor.x + 16;
  const above = anchor.y - 16 - panelSize.height,
    below = anchor.y + 16;
  // 未编辑的数值框避开指针前方。获得输入焦点后固定位置。
  const roomRight = right + panelSize.width <= size.width;
  const roomBelow = below + panelSize.height <= usableHeight;
  const nearby = {
    x: left >= 0 && (!roomRight || (!!from && anchor.x > from.x)) ? left : right,
    y: above >= 0 && (!roomBelow || !from || anchor.y >= from.y) ? above : below,
  };
  const position = pin ?? nearby;
  useImperativeHandle(handle, () => ({
    start(text) {
      lengthInput.current?.focus({ preventScroll: true });
      if (text !== undefined) change({ ...fields, length: text });
    },
  }));
  const title = { line: '长度', radius: '半径', angle: '旋转角', opening: '圆规开度' }[measure];
  const lockPosition = () => setPin((current) => current ?? nearby);
  return (
    <div
      ref={panel}
      className="cad-dynamic-input"
      data-transient="dynamic-input"
      style={{
        left: Math.max(4, Math.min(size.width - panelSize.width - 4, position.x)),
        top: Math.max(4, Math.min(usableHeight - panelSize.height - 4, position.y)),
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <MeasurementField
        inputRef={lengthInput}
        label={title}
        value={fields.length ?? length.toFixed(2)}
        suffix={measure === 'angle' ? '°' : 'mm'}
        pin={lockPosition}
        change={(text) => change({ ...fields, length: text })}
        commit={commit}
        cancel={cancel}
        next={
          measure === 'line' ? () => angleInput.current?.focus({ preventScroll: true }) : undefined
        }
      />
      {measure === 'line' && (
        <MeasurementField
          inputRef={angleInput}
          label="角度"
          value={fields.angle ?? formatCadAngle(angle, 1)}
          suffix="°"
          pin={lockPosition}
          change={(text) => change({ ...fields, angle: text })}
          commit={commit}
          cancel={cancel}
          next={() => lengthInput.current?.focus({ preventScroll: true })}
        />
      )}
      <button type="button" aria-label={confirmLabel} title={confirmLabel} onClick={commit}>
        ✓
      </button>
      {error && (
        <span className="cad-dynamic-error" role="status">
          {error}
        </span>
      )}
    </div>
  );
}
