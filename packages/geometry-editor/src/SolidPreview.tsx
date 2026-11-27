import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ProjectionDirection,
  ReconstructedSolid3D,
  SolidReconstructionResult,
} from '@tuheng/geometry-core';
import {
  linkedSolidFaces,
  paintSolid,
  pickSolidFace,
  solidEdgeKeys,
  solidFeatureEdges,
  type SolidCamera,
} from './solid-canvas';
import type { LinkedFace } from './useTeachingWorkspace';

const presetViews = [
  { name: '轴测', yaw: 0.65, pitch: 0.48 },
  { name: '正视', yaw: 0, pitch: 0, direction: 'V' },
  { name: '俯视', yaw: 0, pitch: Math.PI / 2, direction: 'H' },
  { name: '左视', yaw: -Math.PI / 2, pitch: 0, direction: 'W' },
] as const satisfies {
  name: string;
  yaw: number;
  pitch: number;
  direction?: ProjectionDirection;
}[];

type PreviewProps = {
  solid: ReconstructedSolid3D;
  link: boolean;
  setLink: (link: boolean) => void;
  linkedIds?: ReadonlySet<string>;
  linkedFace?: LinkedFace;
  select: (face?: LinkedFace) => void;
  hover: (face?: LinkedFace) => void;
};
const zoomCamera = (camera: SolidCamera, factor: number) => ({
  ...camera,
  zoom: Math.max(0.35, Math.min(6, camera.zoom * factor)),
});

function InteractiveSolid({
  solid,
  link,
  setLink,
  linkedIds,
  linkedFace,
  select,
  hover,
}: PreviewProps) {
  const [camera, setCamera] = useState<SolidCamera>({ ...presetViews[0], zoom: 1 });
  const [preset, setPreset] = useState<string | undefined>('轴测');
  const [transparent, setTransparent] = useState(false);
  const [wireframe, setWireframe] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const gesture = useRef<{
    id: number;
    x: number;
    y: number;
    startX: number;
    startY: number;
  } | null>(null);
  const painted = useRef<ReturnType<typeof paintSolid>>([]);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const features = useMemo(() => solidFeatureEdges(solid), [solid]);
  const featureKeys = useMemo(() => solidEdgeKeys(features), [features]);
  const highlighted = useMemo(
    () => linkedSolidFaces(solid, linkedIds, linkedFace),
    [solid, linkedIds, linkedFace],
  );
  useEffect(() => {
    const node = canvas.current;
    if (!node) return;
    const resize = new ResizeObserver(([{ contentRect }]) => {
      setSize({ width: Math.max(contentRect.width, 1), height: Math.max(contentRect.height, 1) });
    });
    resize.observe(node);
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      setCamera((value) => zoomCamera(value, Math.exp(-Math.sign(event.deltaY) * 0.16)));
    };
    node.addEventListener('wheel', wheel, { passive: false });
    return () => {
      resize.disconnect();
      node.removeEventListener('wheel', wheel);
    };
  }, []);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const node = canvas.current,
        context = node?.getContext('2d');
      if (!node || !context) return;
      const ratio = Math.min(devicePixelRatio, 2);
      const width = Math.round(size.width * ratio),
        height = Math.round(size.height * ratio);
      if (node.width !== width || node.height !== height) {
        node.width = width;
        node.height = height;
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      painted.current = paintSolid(context, solid, size.width, size.height, features, featureKeys, {
        camera,
        transparent,
        wireframe,
        highlighted,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [solid, camera, size, features, featureKeys, transparent, wireframe, highlighted]);

  function pick(target: HTMLCanvasElement, x: number, y: number) {
    const box = target.getBoundingClientRect();
    const face = pickSolidFace(painted.current, x - box.left, y - box.top);
    return face === undefined ? undefined : solid.faceSources[face];
  }

  return (
    <>
      <div className="geo-teaching-controls geo-solid-presets" role="group" aria-label="三维视角">
        {presetViews.map((view) => {
          const mapping =
            'direction' in view &&
            solid.sourceViewMapping.find((item) => item.direction === view.direction);
          const linked = mapping ? { viewId: mapping.viewId } : undefined;
          return (
            <button
              key={view.name}
              type="button"
              aria-pressed={preset === view.name}
              onPointerEnter={() => hover(linked)}
              onPointerLeave={() => hover(undefined)}
              onClick={() => {
                setCamera({ yaw: view.yaw, pitch: view.pitch, zoom: 1 });
                setPreset(view.name);
                select(linked);
              }}
            >
              {view.name}
            </button>
          );
        })}
      </div>
      <canvas
        ref={canvas}
        className="geo-solid-canvas"
        tabIndex={0}
        aria-label="三维实体画布"
        data-triangle-count={solid.triangles.length}
        data-highlighted-faces={highlighted.size}
        data-orbit={`${camera.yaw.toFixed(3)},${camera.pitch.toFixed(3)},${camera.zoom.toFixed(3)}`}
        onPointerDown={(event) => {
          if (gesture.current || event.button !== 0) return;
          gesture.current = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            startX: event.clientX,
            startY: event.clientY,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const current = gesture.current;
          if (current?.id === event.pointerId) {
            const dx = event.clientX - current.x,
              dy = event.clientY - current.y;
            if (dx || dy) {
              setPreset(undefined);
              setCamera((value) => ({
                ...value,
                yaw: value.yaw + dx * 0.009,
                pitch: Math.max(-Math.PI / 2, Math.min(Math.PI / 2, value.pitch + dy * 0.009)),
              }));
              Object.assign(current, { x: event.clientX, y: event.clientY });
            }
          } else if (link && event.pointerType !== 'touch')
            hover(pick(event.currentTarget, event.clientX, event.clientY));
        }}
        onPointerUp={(event) => {
          const current = gesture.current;
          if (current?.id !== event.pointerId) return;
          if (
            link &&
            Math.hypot(event.clientX - current.startX, event.clientY - current.startY) <= 4
          )
            select(pick(event.currentTarget, event.clientX, event.clientY));
          gesture.current = null;
        }}
        onPointerCancel={() => {
          gesture.current = null;
        }}
        onLostPointerCapture={() => {
          gesture.current = null;
        }}
        onPointerLeave={() => hover(undefined)}
        onKeyDown={(event) => {
          const key = event.key;
          if (!['+', '=', '-', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key))
            return;
          event.preventDefault();
          if (key === '+' || key === '=' || key === '-')
            setCamera((value) => zoomCamera(value, key === '-' ? 0.85 : 1.18));
          else {
            setPreset(undefined);
            setCamera((value) => ({
              ...value,
              yaw: value.yaw + (key === 'ArrowLeft' ? -0.15 : key === 'ArrowRight' ? 0.15 : 0),
              pitch: Math.max(
                -Math.PI / 2,
                Math.min(
                  Math.PI / 2,
                  value.pitch + (key === 'ArrowUp' ? 0.15 : key === 'ArrowDown' ? -0.15 : 0),
                ),
              ),
            }));
          }
        }}
      />
      <div className="geo-teaching-controls geo-solid-options" role="group" aria-label="三维显示">
        <button
          type="button"
          aria-pressed={transparent}
          onClick={() => setTransparent(!transparent)}
        >
          半透明
        </button>
        <button type="button" aria-pressed={wireframe} onClick={() => setWireframe(!wireframe)}>
          {wireframe ? '实体' : '线框'}
        </button>
        <button type="button" aria-pressed={link} onClick={() => setLink(!link)}>
          二维-三维联动
        </button>
      </div>
      <details className="geo-solid-details">
        <summary>
          {solid.bounds.size.map((size) => Number(size.toFixed(2))).join(' × ')} mm · 模型说明
        </summary>
        <p>{solid.confidenceNote}</p>
        {!!solid.warnings.length && (
          <ul>
            {solid.warnings.map((warning, i) => (
              <li key={i}>{warning}</li>
            ))}
          </ul>
        )}
      </details>
    </>
  );
}

export function SolidPreview({
  solid,
  build,
  generate,
  ...props
}: Omit<PreviewProps, 'solid'> & {
  solid?: ReconstructedSolid3D;
  build?: { result?: SolidReconstructionResult; error?: string };
  generate: () => void;
}) {
  const failure =
    build?.error ?? (build?.result && !build.result.ok ? build.result.reason : undefined);
  return (
    <section className="geo-solid-pane" aria-label="立体图三维预览">
      <h3>立体图 3D</h3>
      {solid ? (
        <InteractiveSolid {...props} solid={solid} />
      ) : (
        <div className="geo-solid-message">
          {build && !failure ? (
            <p role="status">正在求投影交集…</p>
          ) : (
            <>
              <p role={failure ? 'alert' : undefined}>{failure ?? '当前图纸需要生成三维模型。'}</p>
              <button type="button" onClick={generate}>
                重新生成三维模型
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
