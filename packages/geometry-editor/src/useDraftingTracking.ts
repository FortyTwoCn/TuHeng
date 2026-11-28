import { useCallback, useEffect, useRef, useState } from 'react';
import type { GeometryDocument } from '@tuheng/contracts';
import { distance, trackingBase, type SnapCandidate } from '@tuheng/geometry-core';

type Retained = ReturnType<typeof trackingBase>;
const features: SnapCandidate['kind'][] = [
  'COINCIDENT',
  'ENDPOINT',
  'ORIGIN',
  'MIDPOINT',
  'CENTER',
  'INTERSECTION',
  'QUADRANT',
];

export function useDraftingTracking(
  doc: GeometryDocument,
  scope: string | undefined,
  enabled: boolean,
) {
  const hover = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | undefined>(undefined);
  const [state, setState] = useState<{
    scope: string;
    bases: Retained[];
  }>();
  const active = enabled && state && state.scope === scope ? state.bases : [];
  const leave = useCallback(() => {
    if (hover.current) clearTimeout(hover.current.timer);
    hover.current = undefined;
  }, []);
  const clear = useCallback(() => {
    leave();
    setState(undefined);
  }, [leave]);
  useEffect(() => {
    return () => {
      if (hover.current) clearTimeout(hover.current.timer);
      hover.current = undefined;
    };
  }, [doc, scope, enabled]);

  function visit(viewId: string, snap?: SnapCandidate) {
    if (!enabled || !scope || !snap || !features.includes(snap.kind)) {
      leave();
      return;
    }
    const id = viewId + ':' + snap.position.x.toFixed(7) + ',' + snap.position.y.toFixed(7);
    if (hover.current?.id === id) return;
    leave();
    const base = trackingBase(doc, viewId, snap);
    hover.current = {
      id,
      timer: setTimeout(() => {
        setState((previous) => {
          const bases = previous?.scope === scope ? previous.bases : [];
          const existing = bases.find(
            (b) => b.viewId === viewId && distance(b.position, base.position) < 1e-7,
          );
          return {
            scope,
            bases: existing ? bases.filter((b) => b !== existing) : [...bases.slice(-7), base],
          };
        });
      }, 400),
    };
  }
  return { active, visit, leave, clear };
}
