import { useCallback, useEffect, useRef } from 'react';

/** 把高频指针预览合并到动画帧。电子笔原始采样仍由调用方逐次收集。 */
export function usePointerFrames() {
  const motion = useRef<number | null>(null);
  const pending = useRef<(() => void) | null>(null);
  const afterPaint = useRef<number | null>(null);

  const discardMotion = useCallback(() => {
    if (motion.current !== null) cancelAnimationFrame(motion.current);
    motion.current = null;
    pending.current = null;
  }, []);

  const discardHover = useCallback(() => {
    if (afterPaint.current !== null) cancelAnimationFrame(afterPaint.current);
    afterPaint.current = null;
  }, []);

  const flushMotion = useCallback(() => {
    const latest = pending.current;
    discardMotion();
    latest?.();
  }, [discardMotion]);

  function queueMotion(move: () => void) {
    pending.current = move;
    if (motion.current === null) motion.current = requestAnimationFrame(flushMotion);
  }

  function recheckHover(hitTest: () => void) {
    discardHover();
    // 光标附近的输入框会被上一帧移动。等它完成布局，再判断指针是否落回画布。
    afterPaint.current = requestAnimationFrame(() => {
      afterPaint.current = requestAnimationFrame(() => {
        afterPaint.current = null;
        hitTest();
      });
    });
  }

  useEffect(
    () => () => {
      discardMotion();
      discardHover();
    },
    [discardMotion, discardHover],
  );

  return { queueMotion, flushMotion, discardMotion, recheckHover, discardHover };
}
