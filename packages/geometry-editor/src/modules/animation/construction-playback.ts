import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from 'react';
import type {
  ConstructionAnimationDocument,
  GeometryDocument,
  GeometryEntity,
} from '@tuheng/contracts';
import { evaluateConstructionAnimationState, type ConstructionVisual } from '@tuheng/geometry-core';

export const constructionSpeeds = { slow: 0.65, normal: 1, fast: 1.8 } as const;
export type ConstructionSpeed = keyof typeof constructionSpeeds;
type VisualState = ReturnType<typeof evaluateConstructionAnimationState>;
export type ConstructionPlayback = {
  state: VisualState;
  playKey: number;
  duration: number;
  paused: boolean;
  guides: boolean;
};
type Beat = 'construct' | 'focus' | 'draw';
const beats: Record<Beat, [number, number]> = {
  construct: [0, 0.26],
  focus: [0.26, 0.35],
  draw: [0.35, 1],
};
const motionQuery = '(prefers-reduced-motion: reduce)';
const motionPreference = () => matchMedia(motionQuery).matches;
const noMotionPreference = () => false;
const subscribeMotion = (change: () => void) => {
  const query = matchMedia(motionQuery);
  query.addEventListener('change', change);
  return () => query.removeEventListener('change', change);
};

export function beatStyle(
  beat: Beat,
  order: number,
  count: number,
  duration: number,
): CSSProperties {
  const [start, end] = beats[beat];
  const length = end - start;
  const drawTime = count <= 1 ? length : length * Math.max(0.28, 1 / count);
  const gap = count <= 1 ? 0 : (length - drawTime) / (count - 1);
  return {
    '--geo-trace-delay': `${(start + order * gap) * duration}ms`,
    '--geo-trace-duration': `${drawTime * duration}ms`,
  } as CSSProperties;
}

export function constructionInk(
  entity: GeometryEntity,
  visual: ConstructionVisual,
  pixelsPerMm: number,
) {
  const hidden = entity.lineStyle.endsWith('_HIDDEN');
  const annotation = ['dimension', 'hatch', 'text', 'engineeringAnnotation', 'symbol'].includes(
    entity.kind,
  );
  const thin = hidden || visual.isCenterline || visual.isGuide || annotation;
  const weight = thin ? 0.25 : 0.5;
  const strokeWidth = Math.max(thin ? 1 : 2.2, Math.min(pixelsPerMm * weight, thin ? 2 : 4));
  const strokeDasharray = visual.isCenterline ? '12 3 2 3' : hidden ? '7 4' : undefined;
  switch (visual.role) {
    case 'ACTIVE_CONSTRUCT':
      return { stroke: 'var(--geo-animation-blue)', strokeWidth: 1.8, strokeDasharray };
    case 'ACTIVE_DRAW':
      return {
        stroke: 'var(--geo-animation-red)',
        strokeWidth: hidden ? 1.8 : 2.6,
        strokeDasharray,
      };
    case 'COMPLETED_DRAFT':
      return { stroke: 'var(--geo-animation-draft)', strokeWidth: 1.4, strokeDasharray };
    case 'ERASING':
      return { stroke: 'var(--geo-animation-erase)', strokeWidth: 2.2, strokeDasharray: '1 5' };
    default:
      return {
        stroke: visual.highlightRole
          ? 'var(--geo-animation-red)'
          : hidden
            ? 'var(--geo-animation-hidden)'
            : 'var(--geo-animation-ink)',
        strokeWidth,
        strokeDasharray,
      };
  }
}

export function useConstructionPlayback(
  doc: GeometryDocument,
  animation: ConstructionAnimationDocument,
  enabled: boolean,
) {
  const reduced = useSyncExternalStore(subscribeMotion, motionPreference, noMotionPreference);
  const [cursor, setCursor] = useState({ index: 0, key: 0 });
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState<ConstructionSpeed>('normal');
  const [guides, setGuides] = useState(true);
  const [previousEnabled, setPreviousEnabled] = useState(enabled);
  if (previousEnabled !== enabled) {
    setPreviousEnabled(enabled);
    if (!enabled) {
      setPlaying(false);
      setPaused(false);
    }
  }
  const last = animation.steps.length - 1;
  const index = Math.min(cursor.index, last);
  const step = animation.steps[index];
  const rate = constructionSpeeds[speed];
  const duration =
    (reduced ? Math.min(step.durationMs ?? 2100, 200) : (step.durationMs ?? 2100)) / rate;
  const interval = duration + (reduced ? 900 : 500) / rate;
  const clock = useRef<{ key: number; interval: number; remaining: number } | null>(null);

  function jump(stepIndex: number) {
    setCursor((current) => ({
      index: Math.max(0, Math.min(last, stepIndex)),
      key: current.key + 1,
    }));
    setPaused(false);
  }
  function stop() {
    setPlaying(false);
    setPaused(false);
  }
  function togglePlay() {
    if (playing) {
      setPlaying(false);
      setPaused(true);
    } else {
      if (index === last && last > 0) jump(0);
      setPaused(false);
      setPlaying(true);
    }
  }
  useEffect(() => {
    if (!enabled || !playing) return;
    const previous = clock.current;
    const ticket =
      previous?.key === cursor.key && previous.interval === interval
        ? previous
        : { key: cursor.key, interval, remaining: interval };
    clock.current = ticket;
    const start = performance.now();
    const timer = setTimeout(() => {
      if (index === last) setPlaying(false);
      else setCursor((current) => ({ index: index + 1, key: current.key + 1 }));
    }, ticket.remaining);
    return () => {
      clearTimeout(timer);
      ticket.remaining = Math.max(0, ticket.remaining - (performance.now() - start));
    };
  }, [cursor.key, index, last, interval, playing, enabled]);
  const state = useMemo(
    () => (enabled ? evaluateConstructionAnimationState(doc, animation, index) : undefined),
    [doc, animation, index, enabled],
  );
  return {
    index,
    step,
    playing,
    paused,
    speed,
    guides,
    setGuides,
    jump,
    stop,
    togglePlay,
    changeSpeed(value: ConstructionSpeed) {
      setSpeed(value);
      jump(index);
    },
    presentation: state ? { state, playKey: cursor.key, duration, paused, guides } : undefined,
  };
}
