import type { PointerEvent } from 'react';
import type { Vec2 } from '@tuheng/contracts';
import { cadGrips, interactionThresholds, type Bounds, type CadGrip } from '@tuheng/geometry-core';
import { hitTargets, type Hit } from '../interaction-controller';
import type { Gesture } from '../selection-gesture';
import type { ViewportProps } from './viewport-types';

// 锁定按下时的图纸、视图与像素比例，供后续拖动和提交使用。
export function beginViewportGesture(
  e: PointerEvent<SVGSVGElement>,
  p: Vec2,
  {
    props,
    box,
    inverse,
    scale,
    placingGrip,
    skippedPick,
    filtered,
    drawingFrame,
  }: {
    props: ViewportProps;
    box: Bounds;
    inverse: DOMMatrix;
    scale: number;
    placingGrip?: CadGrip;
    skippedPick: string | null;
    filtered: (hits: Hit[]) => Hit[];
    drawingFrame: (p: Vec2, hit?: Hit) => string;
  },
) {
  const { document: doc, role, readOnly, tool } = props;
  const cad = props.cad.session;
  const hit = filtered(
      hitTargets(
        doc,
        p,
        scale,
        box,
        props.hiddenLayers,
        props.selected,
        props.axes,
        interactionThresholds[(e.pointerType || 'mouse') as keyof typeof interactionThresholds]
          ?.hit ?? 10,
      ),
    )[0],
    pan =
      e.button === 1 ||
      tool === 'pan' ||
      (tool === 'pen' && e.pointerType === 'touch' && !props.fingerDraw);
  const ids = hit ? (props.selected.includes(hit.id) ? props.selected : [hit.id]) : [];
  const frameId = drawingFrame(p, hit);
  const gripAttribute = (e.target as Element)
    .closest('[data-grip-entity]')
    ?.getAttribute('data-grip-entity');
  const gripKey =
    !cad && !readOnly && tool === 'select' && (e.target as Element).getAttribute('data-cad-grip');
  const entity = props.selected.includes(gripAttribute ?? '')
    ? doc.entities.find((v) => v.id === gripAttribute)
    : undefined;
  const grip = pan
    ? undefined
    : (placingGrip ??
      (gripKey && entity ? cadGrips(doc, entity, role).find((v) => v.key === gripKey) : undefined));
  const draft: Gesture = {
    cadId: cad?.commandId,
    grip,
    penOwnsInput: e.pointerType === 'pen',
    subtract: props.selectionMode === 'remove',
    id: e.pointerId,
    start: p,
    last: p,
    screen: { x: e.clientX, y: e.clientY },
    inverse: inverse,
    scale,
    snapPixels:
      interactionThresholds[(e.pointerType || 'mouse') as keyof typeof interactionThresholds]
        ?.snap ?? 10,
    dragPixels:
      interactionThresholds[(e.pointerType || 'mouse') as keyof typeof interactionThresholds]
        ?.drag ?? 4,
    revision: props.revision,
    selection: props.selected,
    toggle: e.ctrlKey || e.metaKey,
    base: doc,
    pausedSnap: e.altKey || (!!cad && skippedPick === cad.prefix),
    tool,
    appearance: props.appearance,
    hit,
    ids,
    viewId: frameId,
    state:
      props.ruler.visible &&
      (e.altKey || (tool !== 'pen' && (e.target as Element).getAttribute('data-ruler') === 'true'))
        ? 'movingRuler'
        : pan
          ? 'panning'
          : tool === 'pen'
            ? 'drawingStroke'
            : 'pressed',
    samples: [{ ...p, pressure: e.pressure }],
    additive: e.shiftKey || props.selectionMode === 'add',
  };
  return { draft, pan };
}
