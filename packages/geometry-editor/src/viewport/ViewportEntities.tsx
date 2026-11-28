import { cloneElement, useMemo } from 'react';
import type { Bounds, ConstructionVisualRole } from '@tuheng/geometry-core';
import { beatStyle } from '../modules/animation/construction-playback';
import { ConstructionOverlays } from '../modules/animation/ConstructionOverlays';
import { EntityShape } from '../rendering';
import { sheetDrawingDocument } from '../sheet-drawing';
import type { ViewportDrawingControls } from '../ViewportDrawing';

const paintOrder: Partial<Record<ConstructionVisualRole, number>> = {
  COMPLETED_DRAFT: 0,
  DEEPENED: 0,
  ACTIVE_CONSTRUCT: 1,
  ERASING: 2,
  ACTIVE_DRAW: 3,
};

// 正式图元共用一次遍历。镜头变化只更新裁剪、屏幕尺寸和渐进描边所需的参数。
export function ViewportEntities({
  controls: { document, selected, highlighted, hiddenLayers, labels, playback, inspectOnly },
  box,
  scale,
}: {
  controls: ViewportDrawingControls;
  box: Bounds;
  scale: number;
}) {
  const sheet = useMemo(() => sheetDrawingDocument(document), [document]);
  const points = useMemo(
    () => new Map(sheet.entities.flatMap((e) => (e.kind === 'point' ? [[e.id, e.position]] : []))),
    [sheet],
  );
  const visuals = playback?.state;
  const guides = playback?.guides;
  const duration = playback?.duration ?? 0;
  const layer = useMemo(() => {
    const active = new Set([...selected, ...highlighted]);
    const hidden = new Set(hiddenLayers);
    const entries = sheet.entities.flatMap((entity) => {
      if (hidden.has(entity.layerId)) return [];
      const visual = visuals?.entities.get(entity.id);
      if (
        visuals &&
        (!visual ||
          paintOrder[visual.role] === undefined ||
          (visual.isGuide && !visual.isCenterline && !guides && visual.role !== 'ERASING') ||
          (entity.kind === 'point' && !entity.labelVisible && visual.role === 'DEEPENED'))
      )
        return [];
      return [{ entity, visual }];
    });
    let activeGuideCount = 0;
    let activeDrawCount = 0;
    if (visuals) {
      entries.sort(
        (a, b) =>
          paintOrder[a.visual!.role]! - paintOrder[b.visual!.role]! ||
          a.visual!.order - b.visual!.order,
      );
      for (const { visual } of entries) {
        if (visual?.role === 'ACTIVE_CONSTRUCT')
          activeGuideCount = Math.max(activeGuideCount, visual.order + 1);
        if (visual?.role === 'ACTIVE_DRAW')
          activeDrawCount = Math.max(activeDrawCount, visual.order + 1);
      }
      for (const visual of visuals.temporaryGuides.values())
        if (visual.role === 'ACTIVE_CONSTRUCT')
          activeGuideCount = Math.max(activeGuideCount, visual.order + 1);
    }
    const clip: number[] = [];
    const sized: number[] = [];
    const elements = entries.map(({ entity, visual }, index) => {
      const isSelected = !visual && active.has(entity.id);
      const showLabel = entity.kind === 'point' && labels && entity.labelVisible;
      const timing =
        visual?.role === 'ACTIVE_CONSTRUCT'
          ? beatStyle('construct', visual.order, activeGuideCount, duration)
          : visual?.role === 'ACTIVE_DRAW'
            ? beatStyle('draw', visual.order, activeDrawCount, duration)
            : undefined;
      if (entity.kind === 'line' || timing) clip.push(index);
      if (isSelected || showLabel || entity.appearance?.widthMm || visual) sized.push(index);
      return (
        <EntityShape
          key={entity.id}
          document={sheet}
          sourceDocument={document}
          sheetPoints={points}
          entity={entity}
          labels={showLabel}
          selected={isSelected}
          inspectOnly={inspectOnly}
          animationVisual={visual && { visual, timing, linked: active.has(entity.id) }}
          scale={1}
        />
      );
    });
    return { elements, clip, sized, activeGuideCount };
  }, [
    document,
    sheet,
    points,
    selected,
    highlighted,
    hiddenLayers,
    labels,
    inspectOnly,
    visuals,
    guides,
    duration,
  ]);
  const geometry = useMemo(() => {
    if (!layer.clip.length && !layer.sized.length) return layer.elements;
    const elements = layer.elements.slice();
    for (const i of layer.clip) elements[i] = cloneElement(elements[i], { box });
    for (const i of layer.sized) elements[i] = cloneElement(elements[i], { scale });
    return elements;
  }, [layer, box, scale]);

  return (
    <g
      key={playback?.playKey ?? 'drawing'}
      data-construction-play-key={playback?.playKey}
      data-construction-paused={playback?.paused}
    >
      {geometry}
      {playback && (
        <ConstructionOverlays
          playback={playback}
          box={box}
          scale={scale}
          activeGuideCount={layer.activeGuideCount}
        />
      )}
    </g>
  );
}
