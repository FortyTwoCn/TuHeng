import type { Ref } from 'react';
import type { GeometryDocument, Vec2 } from '@tuheng/contracts';
import {
  cadGrips,
  localToSheet,
  point,
  type Bounds,
  type SnapCandidate,
  type TrackingBase,
} from '@tuheng/geometry-core';
import { ViewportDrawing } from './ViewportDrawing';
import { MeasurementOverlay } from './MeasurementOverlay';
import { RelationGuide } from './RelationGuide';
import type { CadPick } from './cad-pointer';
import type { SessionInteraction } from './interaction-controller';
import type { AxisDraft } from './projection-command';
import type { EditorControls } from './types';

export type Marquee = { box: Bounds; mode: 'window' | 'crossing'; ids: string[] };

type ViewportSceneProps = {
  controls: EditorControls;
  box: Bounds;
  scale: number;
  crosshair: Ref<SVGGElement>;
  interaction: SessionInteraction;
  marquee: Marquee | null;
  axis: AxisDraft | null;
  // 这些均为显示数据，命令提交仍由工作区和正式文档历史处理。
  preview: {
    document: GeometryDocument;
    gripDocument: GeometryDocument;
    measurementDocument: GeometryDocument | null;
    path: Vec2[];
    points: Vec2[];
  };
  draft: {
    cursor?: CadPick;
    lineEnd?: Vec2;
    candidate: SnapCandidate | undefined | null;
    viewId: string;
    bases: (TrackingBase & { viewId: string })[];
  };
};

function MarqueeOverlay({ marquee, scale }: { marquee: Marquee; scale: number }) {
  const { box, mode } = marquee;
  const crossing = mode === 'crossing';
  return (
    <g data-selection-mode={mode} data-transient="marquee" pointerEvents="none">
      <rect
        x={box.x}
        y={-box.y - box.height}
        width={box.width}
        height={box.height}
        fill={crossing ? 'var(--cad-crossing-fill)' : 'var(--cad-window-fill)'}
        stroke={crossing ? 'var(--cad-crossing)' : 'var(--cad-window)'}
        strokeWidth={1 / scale}
        strokeDasharray={crossing ? `${5 / scale} ${3 / scale}` : undefined}
      />
      <text x={box.x + 5 / scale} y={-box.y - box.height + 16 / scale} fontSize={12 / scale}>
        {crossing ? 'Crossing · 包含或相交' : 'Window · 完全包含'}
      </text>
    </g>
  );
}

export function ViewportScene({
  controls,
  box,
  scale,
  crosshair,
  interaction,
  marquee,
  axis,
  preview,
  draft,
}: ViewportSceneProps) {
  const { document: doc, role, readOnly, tool, selected } = controls;
  const cad = controls.cad.session;
  const { cursor, lineEnd, candidate, viewId, bases } = draft;
  const { document: displayDoc, gripDocument, measurementDocument, path, points } = preview;
  const canGuide = !!cad && interaction !== 'pinching';
  const start = cad?.points[0];
  const relationEnd = lineEnd ?? cursor?.position;
  // SVG 的 Y 轴向下。这里统一由局部坐标转图纸坐标，再映射到 SVG。
  const cursorSheet = cursor && localToSheet(doc, cursor.viewId, cursor.position);
  const lineSheet = cad && lineEnd && localToSheet(doc, cad.viewId, lineEnd);
  const leaf = measurementDocument?.entities.at(-1);
  const measure =
    cad && measurementDocument && ['segment', 'line', 'circle', 'arc'].includes(cad.commandId);
  const grips =
    !cad && !readOnly && tool === 'select'
      ? gripDocument.entities
          .filter((e) => selected.includes(e.id))
          .flatMap((e) =>
            cadGrips(gripDocument, e, role).map((grip) => ({ ...grip, viewId: e.viewId })),
          )
      : [];
  let measurementPath = path;
  if (measure && (leaf?.kind === 'arc' || leaf?.kind === 'circle')) {
    const center = point(measurementDocument, leaf.center);
    measurementPath = [0, leaf.radius].map((dx) =>
      localToSheet(measurementDocument, leaf.viewId, { x: center.x + dx, y: center.y }),
    );
  } else if (path.length < 2) {
    const last = points.at(-1);
    measurementPath = last && cursorSheet ? [last, cursorSheet] : [];
  }

  return (
    <>
      <ViewportDrawing
        controls={{
          ...controls,
          document: displayDoc,
          highlighted: [...controls.highlighted, ...(marquee?.ids ?? []), ...(cad?.ids ?? [])],
        }}
        box={box}
        scale={scale}
        preview={cad ? [] : path}
        steps={points}
        candidate={candidate ? localToSheet(doc, viewId, candidate.position) : null}
        axisDraft={axis && ['side', 'confirm'].includes(axis.phase) ? axis.spec : null}
      />
      {grips.map((grip) => {
        const q = localToSheet(doc, grip.viewId, grip.position);
        return (
          <g
            key={`${grip.entityId}:${grip.key}`}
            data-transient="grip"
            data-grip-entity={grip.entityId}
            transform={`translate(${q.x} ${-q.y})`}
          >
            <rect
              data-cad-grip={grip.key}
              x={-4 / scale}
              y={-4 / scale}
              width={8 / scale}
              height={8 / scale}
              fill="var(--cad-control)"
              stroke="var(--cad-window)"
              strokeWidth={1.5 / scale}
            />
            <circle data-cad-grip={grip.key} r={12 / scale} fill="transparent">
              <title>{grip.label}</title>
            </circle>
          </g>
        );
      })}
      {canGuide && cad.commandId === 'trim' && !cad.pointIds[0] && points[0] && cursorSheet && (
        <rect
          data-transient="trim-box"
          x={Math.min(points[0].x, cursorSheet.x)}
          y={-Math.max(points[0].y, cursorSheet.y)}
          width={Math.abs(points[0].x - cursorSheet.x)}
          height={Math.abs(points[0].y - cursorSheet.y)}
          stroke="var(--cad-relation)"
          strokeWidth={1 / scale}
          strokeDasharray={`${4 / scale} ${3 / scale}`}
          fill="var(--cad-relation)"
          fillOpacity={0.09}
          pointerEvents="none"
        />
      )}
      {canGuide && lineSheet && points[0] && (
        <line
          data-transient="rubber-band"
          pointerEvents="none"
          x1={points[0].x}
          y1={-points[0].y}
          x2={lineSheet.x}
          y2={-lineSheet.y}
          stroke={controls.appearance.color ?? 'var(--cad-accent)'}
          strokeWidth={1.4}
          vectorEffect="non-scaling-stroke"
          strokeDasharray="6 3"
        />
      )}
      {canGuide && start && relationEnd && (candidate?.guide || candidate?.equalLength) && (
        <RelationGuide
          doc={doc}
          viewId={cad.viewId}
          candidate={candidate}
          start={start}
          end={relationEnd}
          box={box}
          pixels={scale}
        />
      )}
      <g
        ref={crosshair}
        aria-hidden="true"
        data-transient="crosshair"
        pointerEvents="none"
        style={{ visibility: 'hidden' }}
        fill="none"
        stroke="var(--cad-axis)"
        strokeWidth={1}
      >
        <rect x={-3.5} y={-3.5} width={7} height={7} />
        <path d="M-20 0H-6 M6 0H20 M0 -20V-6 M0 6V20" />
      </g>
      {canGuide &&
        controls.tracking &&
        bases.map((base) => {
          const p = localToSheet(doc, base.viewId, base.position);
          return (
            <circle
              key={`${base.viewId}:${base.position.x},${base.position.y}`}
              data-transient="tracking-base"
              cx={p.x}
              cy={-p.y}
              r={4 / scale}
              fill="none"
              stroke="var(--cad-relation)"
              strokeWidth={1 / scale}
              pointerEvents="none"
            />
          );
        })}
      {canGuide &&
        cursorSheet &&
        candidate?.tracks?.map(({ point, direction }) => {
          const from = localToSheet(doc, viewId, point);
          return (
            <line
              key={`${point.x},${point.y},${direction.x},${direction.y}`}
              data-transient="tracking"
              x1={from.x}
              y1={-from.y}
              x2={cursorSheet.x}
              y2={-cursorSheet.y}
              pointerEvents="none"
              stroke="var(--cad-relation)"
              strokeWidth={1 / scale}
              strokeDasharray={`${4 / scale} ${3 / scale}`}
            />
          );
        })}
      {measure && (
        <MeasurementOverlay
          doc={measurementDocument}
          ids={leaf?.kind === 'segment' ? [leaf.id] : []}
          path={measurementPath}
          tool={cad.commandId}
          box={box}
          scale={scale}
        />
      )}
      {marquee && <MarqueeOverlay marquee={marquee} scale={scale} />}
      {!cad && interaction !== 'idle' && interaction !== 'drawingStroke' && !marquee && (
        <MeasurementOverlay
          doc={measurementDocument ?? doc}
          ids={interaction.startsWith('dragging') ? selected : []}
          path={path}
          tool={tool}
          box={box}
          scale={scale}
        />
      )}
    </>
  );
}
