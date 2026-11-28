import { useCallback, useEffect, useRef, useState } from 'react';
import type { GeometryDocument } from '@tuheng/contracts';
import { distance, isPointFeature, trackingBase, type SnapCandidate } from '@tuheng/geometry-core';

type Retained = ReturnType<typeof trackingBase>;
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

  function visit(viewId: string, snap?: SnapCandidate, hiddenLayers?: string[]) {
    if (!enabled || !scope || !snap || !isPointFeature(snap)) {
      leave();
      return;
    }
    const id = viewId + ':' + snap.position.x.toFixed(7) + ',' + snap.position.y.toFixed(7);
    if (hover.current?.id === id) return;
    leave();
    const base = trackingBase(doc, viewId, snap, { hiddenLayers });
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
