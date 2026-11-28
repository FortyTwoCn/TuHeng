'use client';
import { ViewportScene } from './ViewportScene';
import { OverlappingTargets } from './ViewportFeedback';
import { ViewportTools } from './viewport/ViewportTools';
import { useViewportInteractions } from './viewport/useViewportInteractions';
import type { ViewportProps } from './viewport/viewport-types';

export function Viewport(props: ViewportProps) {
  const i = useViewportInteractions(props);
  const { document: doc, tool } = props;
  const {
    svg,
    cad,
    axisDraft,
    overlap,
    state,
    box,
    scale,
    crosshair,
    marquee,
    sceneDocument,
    shownDrag,
    previewDoc,
    precision,
    preview,
    points,
    activeCursor,
    shownCandidate,
    candidateView,
    tracking,
    resumeCoveredHover,
    down,
    queueMove,
    up,
    finishFromCanvas,
  } = i;
  return (
    <section
      className={`geo-view geo-active${cad ? ' cad-active' : ''}`}
      onPointerMoveCapture={resumeCoveredHover}
    >
      {overlap.length > 1 &&
        props.selected.length > 0 &&
        state === 'idle' &&
        tool === 'select' &&
        !props.session.construction &&
        !cad && (
          <OverlappingTargets
            doc={doc}
            hits={overlap}
            selectedId={props.selected[0]}
            select={props.select}
          />
        )}
      <svg
        ref={svg}
        tabIndex={0}
        aria-label="统一展开图绘图区"
        data-interaction={
          props.session.construction
            ? props.session.construction.phase === 'reference'
              ? 'pickingReference'
              : props.session.construction.spec.directionMode === 'PARALLEL'
                ? 'placingParallel'
                : 'placingPerpendicular'
            : axisDraft
              ? 'placingAxis'
              : state
        }
        viewBox={`${box.x} ${-box.y - box.height} ${box.width} ${box.height}`}
        onPointerDown={down}
        onPointerMove={(event) => {
          if (props.hoverEntity && event.pointerType !== 'touch')
            props.hoverEntity(
              (event.target as Element)
                .closest('[data-entity-id]')
                ?.getAttribute('data-entity-id') ?? undefined,
            );
          queueMove(event);
        }}
        onPointerEnter={i.enterPointer}
        onPointerUp={up}
        onDoubleClick={i.doubleClick}
        onPointerLeave={i.clearHover}
        onContextMenu={(e) => {
          if (finishFromCanvas()) e.preventDefault();
        }}
        onKeyDown={i.keyDown}
        onPointerCancel={(e) => i.cancelPointer(e.pointerId)}
        onLostPointerCapture={(e) => i.lostPointer(e.pointerId)}
      >
        <ViewportScene
          controls={props}
          box={box}
          scale={scale}
          crosshair={crosshair}
          interaction={state}
          marquee={marquee}
          axis={axisDraft}
          preview={{
            document: sceneDocument,
            gripDocument: shownDrag ?? doc,
            measurementDocument: previewDoc ?? precision.commandPreview,
            path: preview,
            points,
          }}
          draft={{
            cursor: activeCursor,
            lineEnd: precision.linePreview?.position,
            candidate: shownCandidate,
            viewId: candidateView,
            bases: tracking.active,
          }}
        />
      </svg>
      <ViewportTools props={props} interaction={i} />
    </section>
  );
}
