import { angle, distance, sub } from '@tuheng/geometry-core';
import { DynamicLineInput } from '../DynamicLineInput';
import { FloatingInspector } from '../FloatingInspector';
import { OperationRecovery } from '../OperationRecovery';
import { sheetToViewport } from '../useCadPrecision';
import { EntityStyleHint, SnapFeedback } from '../ViewportFeedback';
import { ViewportProjection } from '../ViewportProjection';
import type { ViewportInteractions } from './useViewportInteractions';
import type { ViewportProps } from './viewport-types';

// 跟随手势状态显示临时反馈、精确输入和恢复入口。
export function ViewportTools({
  props,
  interaction,
}: {
  props: ViewportProps;
  interaction: ViewportInteractions;
}) {
  const { document: doc, role, readOnly, tool } = props;
  const {
    precision,
    state,
    box,
    size,
    scale,
    dynamicInput,
    inspected,
    cad,
    dragMeasure,
    gripTip,
    gripSheet,
    dragFields,
    setDragFields,
    dragError,
    setDragError,
    commitDrag,
    cancel,
    svg,
    shownCandidate,
    activeCursor,
    skippedPick,
    toggleSnapPreview,
    placingGrip,
    axisDraft,
    setLastSnap,
    setLastPen,
    setInterrupted,
    lastSnap,
    lastPen,
    interrupted,
    accept,
    setAxisDraft,
    activeConstruction,
    setConstructionPreview,
    setPreview,
  } = interaction;
  return (
    <>
      {precision.input &&
        state !== 'pinching' &&
        (() => {
          const { key, anchor, from, ...input } = precision.input;
          return (
            <DynamicLineInput
              key={key}
              {...input}
              anchor={sheetToViewport(anchor, box, scale)}
              from={from && sheetToViewport(from, box, scale)}
              size={size}
              handle={dynamicInput}
            />
          );
        })()}
      {inspected && <EntityStyleHint entity={inspected} />}
      {!cad && dragMeasure && gripSheet && gripTip && (
        <DynamicLineInput
          anchor={sheetToViewport(gripSheet, box, scale)}
          size={size}
          length={distance(dragMeasure.anchor, gripTip)}
          angle={angle(sub(gripTip, dragMeasure.anchor))}
          fields={dragFields ?? {}}
          change={(v) => {
            setDragFields(v);
            setDragError('');
          }}
          measure={dragMeasure.target.kind === 'radius' ? 'radius' : 'line'}
          commit={commitDrag}
          confirmLabel="确认调整"
          cancel={() => {
            cancel();
            svg.current?.focus();
          }}
          handle={dynamicInput}
          error={dragFields ? dragError : ''}
        />
      )}
      {(shownCandidate || (cad?.phase === 'points' && activeCursor && props.snapping)) && (
        <SnapFeedback
          candidate={shownCandidate}
          paused={!!cad && skippedPick === cad.prefix}
          toggle={toggleSnapPreview}
        />
      )}
      {state === 'idle' &&
        !dragMeasure &&
        !placingGrip &&
        props.selected.length > 0 &&
        tool === 'select' &&
        !axisDraft &&
        !props.session.construction &&
        !cad && (
          <FloatingInspector
            controls={props}
            svg={svg}
            cameraKey={`${box.x},${box.y},${box.width},${box.height}`}
            beginEdit={() => {
              setLastSnap(null);
              setLastPen(null);
              setInterrupted(null);
            }}
          />
        )}
      {!readOnly && (
        <OperationRecovery
          doc={doc}
          role={role}
          lastSnap={lastSnap}
          lastPen={lastPen}
          interrupted={interrupted}
          replace={props.replace}
          commit={accept}
          report={props.report}
          setLastSnap={setLastSnap}
          setLastPen={setLastPen}
          setInterrupted={setInterrupted}
        />
      )}
      <ViewportProjection
        controls={props}
        axis={axisDraft}
        setAxis={setAxisDraft}
        preview={activeConstruction}
        accept={accept}
        cancelGesture={cancel}
        clearPreview={() => {
          setConstructionPreview(null);
          setPreview([]);
        }}
      />
    </>
  );
}
