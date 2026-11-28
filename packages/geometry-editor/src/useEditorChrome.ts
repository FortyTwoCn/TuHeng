import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { GeometryDocument } from '@tuheng/contracts';
import type { Bounds } from '@tuheng/geometry-core';
import type { CameraFit, Ruler } from './types';
import { initialSettings } from './WorkspaceSettings';
import { textEntry } from './commands';
import type { Appearance } from './CadPreferences';

// 服务端先呈现布局，浏览器挂载后才接收编辑操作。
const browserReady = () => true;
const serverReady = () => false;
const noSubscription = () => () => undefined;

export function useEditorChrome(doc: GeometryDocument) {
  const ready = useSyncExternalStore(noSubscription, browserReady, serverReady);
  const [settings, setSettings] = useState(() => initialSettings(doc));
  const [appearance, setAppearance] = useState<Appearance>({});
  const [touch, setTouch] = useState(false);
  const [documentLabels, setDocumentLabels] = useState(doc.settings.labels);
  if (documentLabels !== doc.settings.labels) {
    setDocumentLabels(doc.settings.labels);
    setSettings((current) => ({ ...current, labels: doc.settings.labels }));
  }
  const [skipSnap, setSkipSnap] = useState(false),
    [zoom, setZoom] = useState(1),
    [cameraFit, setCameraFit] = useState<CameraFit>({}),
    [focusKey, setFocusKey] = useState(0);
  const [ruler, setRuler] = useState<Ruler>({
    visible: false,
    origin: { x: 5, y: 5 },
    angle: 0,
    length: 60,
  });
  const root = useRef<HTMLDivElement>(null);
  const camera = useRef<Bounds | null>(null);
  const updateCamera = useCallback((box: Bounds) => {
    camera.current = box;
  }, []);
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const change = () => setFullscreen(document.fullscreenElement === root.current);
    document.addEventListener('fullscreenchange', change);
    return () => document.removeEventListener('fullscreenchange', change);
  }, []);
  const cursorStatusRef = useRef<HTMLOutputElement>(null);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const viewport = window.visualViewport;
    const syncKeyboard = () => {
      if (viewport && el.contains(document.activeElement) && textEntry(document.activeElement)) {
        el.style.setProperty('--geo-keyboard-height', Math.floor(viewport.height) + 'px');
      } else el.style.removeProperty('--geo-keyboard-height');
    };
    viewport?.addEventListener('resize', syncKeyboard);
    el.addEventListener('focusin', syncKeyboard);
    el.addEventListener('focusout', syncKeyboard);
    return () => {
      viewport?.removeEventListener('resize', syncKeyboard);
      el.removeEventListener('focusin', syncKeyboard);
      el.removeEventListener('focusout', syncKeyboard);
    };
  }, []);
  const requestFit = (bounds?: Bounds) => {
    setZoom(1);
    setCameraFit({ bounds });
  };
  const fit = () => requestFit();
  const toggle = (key: 'objectSnap' | 'grid' | 'gridSnap' | 'tracking' | 'ortho') =>
    setSettings((s) => ({ ...s, [key]: !s[key] }));
  return {
    ready,
    root,
    camera,
    updateCamera,
    fullscreen,
    touch,
    setTouch,
    appearance,
    setAppearance,
    settings,
    setSettings,
    skipSnap,
    setSkipSnap,
    zoom,
    setZoom,
    cameraFit,
    focusKey,
    setFocusKey,
    ruler,
    setRuler,
    cursorStatusRef,
    fit,
    requestFit,
    toggle,
    focusCanvas: () =>
      root.current?.querySelector<SVGSVGElement>('.geo-view > svg')?.focus({ preventScroll: true }),
  };
}
