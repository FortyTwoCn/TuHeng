import { useRef, useState } from 'react';

export function useWorkspaceSplit(initial: number, min: number, max: number) {
  const [value, setValue] = useState(initial);
  return {
    value,
    min,
    max,
    change: (next: number) => setValue(Math.round(Math.max(min, Math.min(max, next)))),
  };
}

export function WorkspaceDivider({
  split,
  label,
  reverse = false,
}: {
  split: ReturnType<typeof useWorkspaceSplit>;
  label: string;
  reverse?: boolean;
}) {
  const start = useRef<{ x: number; value: number; width: number }>(null);
  const direction = reverse ? -1 : 1;
  return (
    <div
      className="geo-workspace-divider"
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={split.min}
      aria-valuemax={split.max}
      aria-valuenow={split.value}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        const left = event.currentTarget.previousElementSibling?.getBoundingClientRect();
        const right = event.currentTarget.nextElementSibling?.getBoundingClientRect();
        if (!left || !right) return;
        start.current = { x: event.clientX, value: split.value, width: right.right - left.left };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const origin = start.current;
        if (origin && event.currentTarget.hasPointerCapture(event.pointerId))
          split.change(
            origin.value + (direction * (event.clientX - origin.x) * 100) / origin.width,
          );
      }}
      onLostPointerCapture={() => {
        start.current = null;
      }}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        split.change(split.value + direction * (event.key === 'ArrowLeft' ? -2 : 2));
      }}
    />
  );
}
