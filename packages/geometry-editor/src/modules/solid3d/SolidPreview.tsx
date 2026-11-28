import { useEffect, useMemo, useRef, useState } from 'react';
import type { ProjectionDirection, ReconstructedDrawing3D } from '@tuheng/geometry-core';
import {
  linkedSolidFaces,
  paintSolid,
  pickSolidFace,
  solidEdgeKeys,
  solidFeatureEdges,
} from './solid-canvas';
import { paintSpatial, pickSpatialFeature, spatialHighlight } from './spatial-canvas';
import type { SolidCamera } from './scene-camera';
import type { LinkedFace } from './useSolidPreview';
import type { EditorTheme } from '../../theme';

const presetViews = [
  { name: '轴测', yaw: Math.PI - 0.66, pitch: 0.53 },
  { name: '正视', yaw: Math.PI, pitch: 0, direction: 'V' },
  { name: '俯视', yaw: Math.PI, pitch: Math.PI / 2, direction: 'H' },
  { name: '左视', yaw: Math.PI / 2, pitch: 0, direction: 'W' },
] as const satisfies {
  name: string;
  yaw: number;
  pitch: number;
  direction?: ProjectionDirection;
}[];

export type SolidPreviewProps = {
  scene: ReconstructedDrawing3D;
  theme: EditorTheme;
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

export function SolidPreview({
  scene,
  theme,
  link,
  setLink,
  linkedIds,
  linkedFace,
  select,
  hover,
}: SolidPreviewProps) {
  const [camera, setCamera] = useState<SolidCamera>({ ...presetViews[0], zoom: 1 });
  const [preset, setPreset] = useState<string | undefined>('轴测');
  const [transparent, setTransparent] = useState(false);
  const [wireframe, setWireframe] = useState(false);
  const [projections, setProjections] = useState(true);
  const solid = scene.kind === 'SOLID' ? scene : undefined;
  const spatial = scene.kind === 'DESCRIPTIVE_GEOMETRY' ? scene : undefined;
  const canvas = useRef<HTMLCanvasElement>(null);
  const gesture = useRef<{
    id: number;
    x: number;
    y: number;
    startX: number;
    startY: number;
  } | null>(null);
  const pickPainted = useRef<(x: number, y: number) => LinkedFace | undefined>(() => undefined);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const features = useMemo(() => (solid ? solidFeatureEdges(solid) : []), [solid]);
  const featureKeys = useMemo(() => solidEdgeKeys(features), [features]);
  const highlighted = useMemo(
    () => (solid ? linkedSolidFaces(solid, linkedIds, linkedFace) : new Set<number>()),
    [solid, linkedIds, linkedFace],
  );
  const highlightSpatial = useMemo(
    () => spatialHighlight(linkedIds, linkedFace),
    [linkedIds, linkedFace],
  );
  const highlightedSpatial = spatial
    ? spatial.points.filter(({ projections }) => highlightSpatial(projections)).length +
      spatial.segments.filter(({ sources }) => highlightSpatial(sources)).length +
      spatial.faces.filter(({ sources }) => highlightSpatial(sources)).length
    : undefined;
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
      const viewWidth = width / ratio;
      const viewHeight = height / ratio;
      if (spatial) {
        const targets = paintSpatial(
          context,
          spatial,
          viewWidth,
          viewHeight,
          theme,
          camera,
          projections,
          highlightSpatial,
        );
        pickPainted.current = (x, y) => pickSpatialFeature(targets, x, y);
      } else if (solid) {
        const faces = paintSolid(context, solid, viewWidth, viewHeight, features, featureKeys, {
          camera,
          theme,
          transparent,
          wireframe,
          highlighted,
        });
        pickPainted.current = (x, y) => {
          const face = pickSolidFace(faces, x, y);
          return face === undefined ? undefined : solid.faceSources[face];
        };
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [
    solid,
    spatial,
    theme,
    camera,
    size,
    features,
    featureKeys,
    transparent,
    wireframe,
    highlighted,
    projections,
    highlightSpatial,
  ]);

  function pick(target: HTMLCanvasElement, x: number, y: number) {
    const box = target.getBoundingClientRect();
    return pickPainted.current(x - box.left, y - box.top);
  }

  return (
    <>
      <header className="geo-solid-heading">
        <h3>立体图 3D</h3>
        <div className="geo-teaching-controls geo-solid-presets" role="group" aria-label="三维视角">
          {presetViews.map((view) => {
            const mapping =
              'direction' in view &&
              scene.sourceViewMapping.find((item) => item.direction === view.direction);
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
      </header>
      <canvas
        ref={canvas}
        className="geo-solid-canvas"
        tabIndex={0}
        aria-label={spatial ? '画法几何三维画布' : '三维实体画布'}
        data-triangle-count={solid?.triangles.length}
        data-highlighted-faces={solid ? highlighted.size : undefined}
        data-spatial-points={spatial?.points.length}
        data-spatial-faces={spatial?.faces.length}
        data-projection-rays={spatial && (projections ? spatial.projectionRays.length : 0)}
        data-highlighted-features={highlightedSpatial}
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
      <div className="geo-solid-footer">
        <div className="geo-teaching-controls geo-solid-options" role="group" aria-label="三维显示">
          {spatial ? (
            <button
              type="button"
              aria-pressed={projections}
              onClick={() => setProjections(!projections)}
            >
              投影射线
            </button>
          ) : (
            <>
              <button
                type="button"
                aria-pressed={transparent}
                onClick={() => setTransparent(!transparent)}
              >
                半透明
              </button>
              <button
                type="button"
                aria-pressed={wireframe}
                onClick={() => setWireframe(!wireframe)}
              >
                {wireframe ? '实体' : '线框'}
              </button>
            </>
          )}
          <button type="button" aria-pressed={link} onClick={() => setLink(!link)}>
            二维-三维联动
          </button>
        </div>
        <details className="geo-solid-details">
          <summary>
            {spatial ? '画法几何' : '正交实体'} ·{' '}
            {scene.bounds.size.map((size) => Number(size.toFixed(2))).join(' × ')} mm
            {scene.warnings.length ? ` · ${scene.warnings.length} 项需核对` : ''}
          </summary>
          <p>{scene.confidenceNote}</p>
          {!!scene.warnings.length && (
            <ul>
              {scene.warnings.map((warning, i) => (
                <li key={i}>{warning}</li>
              ))}
            </ul>
          )}
        </details>
      </div>
    </>
  );
}
