'use client';
import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  useEffect,
  useReducer,
  useSyncExternalStore,
} from 'react';
import type { GeometryDocument, EditorType } from '@tuheng/contracts';
import {
  serializeGeometryDocument,
  exportGeometryNarrative,
  deletionSet,
  deleteEntities,
  copyEntities,
  editorRegistry,
  targetFromKey,
  targetCapabilities,
  deleteProjectionAxis,
  resolveReference,
  sheetBounds,
  CAD_COMMANDS,
  type Bounds,
  type DxfImportReport,
} from '@tuheng/geometry-core';
import { Viewport } from './Viewport';
import { WorkspaceTopbar, WorkspaceStatus } from './workspace-controls';
import { DrawingRail, ModifyRail } from './workspace-rails';
import { WorkspaceSettings, initialSettings } from './WorkspaceSettings';
import { useCadCommand, type CadId } from './useCadCommand';
import { DrawingAppearance, linePresets, type Appearance } from './CadPreferences';
import { GridSpacing } from './GridSpacing';
import { downloadCadFile } from './cad-download';
import {
  DrawingFileInput,
  downloadDrawingSchema,
  downloadDrawingText,
  type DrawingTextKind,
} from './DrawingFiles';
import { DxfImportDialog, dxfImportSummary } from './DxfImportDialog';
import { commandRegistry, commandUnavailable, textEntry, type CommandId } from './commands';
import { sessionReducer, viewportSession } from './session';
import type { CameraFit, Ruler } from './types';
import { useDrawingDocument } from './useDrawingDocument';
import './styles.css';
// 服务端可以先呈现布局，浏览器完成挂载后再接收编辑操作。
const browserReady = () => true;
const serverReady = () => false;
const noSubscription = () => () => undefined;
export interface GeometryEditorHandle {
  getDocument: () => GeometryDocument;
  exportJSON: () => string;
  exportNarrative: () => string;
  undo: () => void;
  redo: () => void;
  fitToContent: () => void;
}
export interface GeometryEditorProps {
  standalone?: boolean;
  documentName?: string;
  onEditorTypeChange?: (type: EditorType) => void;
  editorType?: EditorType;
  value?: unknown;
  defaultValue?: unknown;
  onChange?: (doc: GeometryDocument) => void;
  role?: 'teacher' | 'student';
  readOnly?: boolean;
  problemDocument?: GeometryDocument;
  highlightedEntityIds?: string[];
  onExport?: (text: string, kind: DrawingTextKind) => void;
}

export const GeometryEditor = forwardRef<GeometryEditorHandle, GeometryEditorProps>(
  function GeometryEditor(
    {
      standalone = false,
      documentName,
      onEditorTypeChange,
      editorType = 'VHW_PROJECTION',
      value,
      defaultValue,
      onChange,
      role = 'student',
      readOnly = false,
      problemDocument,
      highlightedEntityIds = [],
      onExport,
    },
    ref,
  ) {
    const ready = useSyncExternalStore(noSubscription, browserReady, serverReady);
    const drawing = useDrawingDocument({
      editorType,
      value,
      defaultValue,
      onChange,
      role,
      readOnly,
      problemDocument,
    });
    const { doc, parsed, fingerprint, revision, history, synchronize } = drawing;
    const [workspace, dispatch] = useReducer(sessionReducer, {
      activity: { kind: 'tool', tool: 'select' },
      selected: [],
      panel: null,
      active: doc.views[0].id,
      expanded: false,
    });
    const session = viewportSession(workspace);
    const { tool, expanded, panel } = session;
    const selectable = (document: GeometryDocument, ids: string[]) =>
      ids.filter(
        (id) => targetCapabilities(document, targetFromKey(id), role, readOnly).selectable,
      );
    const selected = selectable(doc, session.selected);
    const select = (ids: string[]) => dispatch({ type: 'select', ids });
    const [message, report] = useState('选择对象，或从空白拖动框选');
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
    const [fullscreen, setFullscreen] = useState(false);
    useEffect(() => {
      const change = () => setFullscreen(document.fullscreenElement === root.current);
      document.addEventListener('fullscreenchange', change);
      return () => document.removeEventListener('fullscreenchange', change);
    }, []);
    const fileInput = useRef<HTMLInputElement>(null);
    const dxfDialog = useRef<HTMLDialogElement>(null);
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
    useEffect(() => {
      if (synchronize()) {
        dispatch({ type: 'tool', tool: 'select' });
        dispatch({ type: 'select', ids: [] });
      }
    }, [synchronize]);
    const commit = (next: GeometryDocument, label?: string) => {
      try {
        const applied = drawing.commit(next, label);
        if (!applied) return;
        select(selectable(applied, selected));
        report('已保存到当前文档');
        return applied;
      } catch (e) {
        report(e instanceof Error ? e.message : '无法保存图纸');
      }
    };
    const replace = (next: GeometryDocument) => {
      try {
        return drawing.replace(next);
      } catch (e) {
        report(e instanceof Error ? e.message : '无法恢复当前操作');
      }
    };
    function stepHistory(direction: 'undo' | 'redo', count = 1) {
      const restored = drawing.stepHistory(direction, count);
      if (!restored) return;
      dispatch({
        type: 'tool',
        tool: workspace.activity.kind === 'tool' ? workspace.activity.tool : 'select',
      });
      select(selectable(restored, selected));
      report((direction === 'undo' ? '已撤销 ' : '已恢复 ') + count + ' 步');
    }
    const undo = () => stepHistory('undo'),
      redo = () => stepHistory('redo');
    const requestFit = (bounds?: Bounds) => {
      setZoom(1);
      setCameraFit({ bounds });
    };
    const fit = () => requestFit();
    const resetAfterLoad = () => {
      dispatch({ type: 'tool', tool: 'select' });
      select([]);
    };
    const drawingLoaded = () => {
      resetAfterLoad();
      fit();
    };
    const applyDxf = (result: DxfImportReport) => {
      if (result.importedCount) {
        const applied = drawing.commit(result.document, '导入 DXF');
        if (applied) {
          resetAfterLoad();
          const bounds = sheetBounds(applied, { drawingOnly: true });
          const current = camera.current;
          if (
            !current ||
            bounds.x < current.x ||
            bounds.y < current.y ||
            bounds.x + bounds.width > current.x + current.width ||
            bounds.y + bounds.height > current.y + current.height
          )
            requestFit(bounds);
        }
      }
      report(dxfImportSummary(result));
    };
    useImperativeHandle(ref, () => ({
      getDocument: () => doc,
      exportJSON: () => serializeGeometryDocument(doc),
      exportNarrative: () => exportGeometryNarrative(doc),
      undo,
      redo,
      fitToContent: fit,
    }));
    const perform = (op: () => GeometryDocument) => {
      try {
        commit(op());
      } catch (e) {
        report((e as Error).message);
      }
    };
    const deleteSelection = () =>
      perform(() => {
        if (
          selected.some(
            (id) => !targetCapabilities(doc, targetFromKey(id), role, readOnly).deletable,
          )
        )
          throw Error('选择含只读或有依赖对象，不能删除');
        const ids = selected.filter((id) => targetFromKey(id).kind === 'entity');
        const affected = deletionSet(doc, ids, role).size - ids.length;
        if (affected > 0 && !window.confirm('同时删除依赖所选节点的 ' + affected + ' 个对象？'))
          return doc;
        let d = doc;
        for (const id of selected) {
          const r = targetFromKey(id);
          if (r.kind === 'projectionAxis') d = deleteProjectionAxis(d, r.systemId, role);
        }
        d = deleteEntities(
          d,
          selected.filter((id) => targetFromKey(id).kind === 'entity'),
          role,
        );
        select([]);
        return d;
      });
    const copySelection = () => perform(() => copyEntities(doc, selected, role));
    const activeView = doc.views.some((v) => v.id === session.active)
      ? session.active
      : doc.views[0].id;
    const cad = useCadCommand(
      workspace.activity,
      dispatch,
      doc,
      fingerprint,
      activeView,
      role,
      readOnly,
      selected,
      commit,
      report,
      appearance,
    );
    function startCad(id: CadId) {
      if (readOnly) return;
      const group = CAD_COMMANDS.find((command) => command.id === id)?.group;
      if (id === 'point') setAppearance({ pattern: 'SOLID', ...linePresets.SOLID });
      if (group === '尺寸标注' || group === '高级标注')
        setAppearance({ pattern: 'GUIDE', ...linePresets.GUIDE });
      cad.start(id);
      root.current?.querySelector<SVGSVGElement>('.geo-view > svg')?.focus({ preventScroll: true });
    }
    const runCommand = (id: CommandId) => {
      const entry = commandRegistry.find((e) => e.id === id);
      if (!entry) return;
      const reason = commandUnavailable(entry, readOnly, doc.editorType);
      if (reason) {
        report(reason);
        return;
      }
      if (entry.kind === 'tool') {
        dispatch({ type: 'tool', tool: id as typeof tool });
        if (id === 'projection' || id === 'pen') select([]);
        report(
          id === 'box'
            ? '点击或拖动两个对角点'
            : id === 'projection'
              ? '选择不同投影中的对应对象'
              : entry.name,
        );
        return;
      }
      if (id === 'new-axis') {
        dispatch({ type: 'patch', patch: { panel: 'axis', construction: null, tool: 'select' } });
        return;
      }
      const mode = id.startsWith('construct') ? 'create' : 'adjust',
        directionMode = id.endsWith('parallel') ? 'PARALLEL' : 'PERPENDICULAR';
      let reference;
      try {
        const r = selected[0] ? targetFromKey(selected[0]) : undefined;
        if (r && resolveReference(doc, r).direction) reference = r;
      } catch {}
      dispatch({
        type: 'patch',
        patch: {
          tool: 'select',
          panel: null,
          construction: {
            mode,
            spec: { directionMode, geometryExtent: 'line', semanticStyle: 'visible', length: 10 },
            reference,
            keep: false,
            phase: reference ? (mode === 'create' ? 'position' : 'target') : 'reference',
          },
        },
      });
      report(
        reference
          ? mode === 'create'
            ? '选择通过点或位置；参考对象保持不动'
            : '选择待修改答案线'
          : '请选择参考线或投影轴',
      );
    };
    if (!parsed.success)
      return (
        <div role="alert">
          几何文档加载失败。
          {parsed.error.issues
            .slice(0, 3)
            .map((i) => i.message)
            .join('；')}
        </div>
      );
    const linked = doc.projectionGroups
      .filter((g) => g.entityIds.some((id) => selected.includes(id)))
      .flatMap((g) => g.entityIds);
    const openSettings = () =>
      dispatch({ type: 'patch', patch: { panel: panel === 'settings' ? null : 'settings' } });
    const toggle = (key: 'objectSnap' | 'grid' | 'gridSnap' | 'tracking' | 'ortho') =>
      setSettings((s) => ({ ...s, [key]: !s[key] }));
    const activeCommand =
      cad.session?.commandId ??
      (panel === 'axis'
        ? 'new-axis'
        : session.construction
          ? (session.construction.mode === 'create' ? 'construct-' : 'relation-') +
            (session.construction.spec.directionMode === 'PARALLEL' ? 'parallel' : 'perpendicular')
          : tool);
    const railProps = {
      active: activeCommand,
      readOnly,
      editorType: doc.editorType,
      run: runCommand,
      start: startCad,
      selectionMode: settings.selectionMode,
      setSelectionMode: (selectionMode: typeof settings.selectionMode) =>
        setSettings((s) => ({ ...s, selectionMode })),
    };
    const importJson = () => fileInput.current?.click();
    const output = (kind: DrawingTextKind) => {
      try {
        downloadDrawingText(doc, kind, onExport);
      } catch (error) {
        report('导出失败，' + (error instanceof Error ? error.message : '图纸内容无效'));
      }
    };
    const fileActions = {
      importJson,
      importDxf: () => dxfDialog.current?.showModal(),
      json: () => output('json'),
      dxf: () => output('dxf'),
      schema: downloadDrawingSchema,
      svg: () => output('svg'),
      narrative: () => output('narrative'),
      png: () => void downloadCadFile(doc, 'png', report),
      viewPng: () => {
        if (camera.current) void downloadCadFile(doc, 'png', report, camera.current);
      },
      zip: () => void downloadCadFile(doc, 'zip', report),
      inspect: () => dispatch({ type: 'patch', patch: { panel: 'file' } }),
    };
    return (
      <div
        ref={root}
        data-workspace-ready={ready}
        inert={!ready}
        className={`geometry-editor ${standalone ? 'geo-standalone' : ''} ${expanded ? 'geo-expanded' : ''} ${settings.inputLayout === 'touch' || (settings.inputLayout === 'auto' && touch) ? 'geo-touch' : ''}`}
        data-input-layout={settings.inputLayout}
        data-theme={settings.theme}
        onPointerUp={(e) => {
          // 混合输入设备先结束本次画布手势，再调整工具栏触控尺寸。
          if (e.target instanceof Element && e.target.closest('.geo-view > svg')) {
            setTouch(e.pointerType === 'touch' || e.pointerType === 'pen');
          }
        }}
        tabIndex={0}
        aria-label={`${editorRegistry[doc.editorType].name}编辑器`}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing || textEntry(e.target) || e.defaultPrevented) return;
          if (
            (e.target === e.currentTarget || e.target instanceof SVGSVGElement) &&
            !panel &&
            !e.ctrlKey &&
            !e.metaKey &&
            !e.altKey &&
            !e.shiftKey &&
            (e.key === 'F3' || e.key === 'F8' || e.key === 'F11')
          ) {
            e.preventDefault();
            if (!e.repeat)
              toggle(e.key === 'F3' ? 'objectSnap' : e.key === 'F8' ? 'ortho' : 'tracking');
            return;
          }
          if (
            cad.session &&
            (e.key === 'Escape' || (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)))
          ) {
            e.preventDefault();
            cad.send({ type: e.key === 'Escape' ? 'cancel' : 'confirm' });
            return;
          }
          if (
            !cad.session &&
            !panel &&
            !e.ctrlKey &&
            !e.metaKey &&
            !e.altKey &&
            (e.target === e.currentTarget || e.target instanceof SVGSVGElement) &&
            /^[a-z]$/i.test(e.key)
          ) {
            const cmd = CAD_COMMANDS.find((c) => c.aliases.includes(e.key.toLowerCase()));
            if (cmd) {
              e.preventDefault();
              startCad(cmd.id);
            }
            return;
          }
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            if (e.shiftKey) redo();
            else undo();
          }
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
            e.preventDefault();
            redo();
          }
          if (!cad.session && (e.key === 'Delete' || e.key === 'Backspace')) {
            e.preventDefault();
            deleteSelection();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            if (panel) dispatch({ type: 'patch', patch: { panel: null } });
            else if (session.construction)
              dispatch({ type: 'patch', patch: { construction: null } });
            else if (selected.length) select([]);
            else dispatch({ type: 'tool', tool: 'select' });
          }
        }}
      >
        <WorkspaceTopbar
          title={documentName ?? editorRegistry[doc.editorType].name}
          fullscreen={fullscreen}
          toggleFullscreen={() => {
            if (document.fullscreenElement === root.current)
              void document.exitFullscreen().catch(() => report('无法退出全屏'));
            else if (root.current?.requestFullscreen)
              void root.current.requestFullscreen().catch(() => report('浏览器无法进入全屏'));
            else if (!standalone) dispatch({ type: 'patch', patch: { expanded: !expanded } });
            else report('此浏览器未开放网页全屏');
          }}
          expanded={expanded}
          standalone={standalone}
          readOnly={readOnly}
          canUndo={history.canUndo}
          canRedo={history.canRedo}
          operations={history.operations}
          jumpHistory={stepHistory}
          undo={undo}
          redo={redo}
          fit={fit}
          toggleExpanded={() => dispatch({ type: 'patch', patch: { expanded: !expanded } })}
          fileActions={fileActions}
          startCad={startCad}
          sheetControl={
            onEditorTypeChange ? (
              <select
                className="cad-sheet-select"
                aria-label="图纸类型"
                value={doc.editorType}
                onChange={(e) => onEditorTypeChange(e.target.value as EditorType)}
              >
                {Object.entries(editorRegistry).map(([id, definition]) => (
                  <option key={id} value={id}>
                    {definition.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="cad-sheet-title">{editorRegistry[doc.editorType].name}</span>
            )
          }
          styleControls={
            <>
              <DrawingAppearance
                theme={settings.theme}
                initial={appearance}
                doc={doc}
                selected={selected}
                role={role}
                readOnly={readOnly}
                commit={commit}
                change={setAppearance}
                report={report}
              />
              <GridSpacing
                key={doc.settings.grid}
                readOnly={readOnly}
                value={doc.settings.grid}
                report={report}
                change={(grid) =>
                  commit({ ...doc, settings: { ...doc.settings, grid } }, '设置网格间距')
                }
              />
            </>
          }
        />
        <DrawingFileInput
          inputRef={fileInput}
          readOnly={readOnly}
          doc={doc}
          activeView={activeView}
          role={role}
          report={report}
          importStroke={(stroke) => commit(stroke, '导入笔迹')}
          replaceDocument={drawing.load}
          loaded={drawingLoaded}
        />
        {!readOnly && (
          <DxfImportDialog dialogRef={dxfDialog} doc={doc} role={role} apply={applyDxf} />
        )}
        <div className="geo-workspace-body">
          <DrawingRail {...railProps} />
          <div className="geo-views">
            <Viewport
              document={doc}
              cad={cad}
              cursorStatusRef={cursorStatusRef}
              appearance={appearance}
              cameraRef={camera}
              gridSpacing={doc.settings.grid}
              revision={revision}
              viewId={activeView}
              focusKey={focusKey}
              replace={replace}
              role={role}
              readOnly={readOnly}
              tool={tool}
              selected={selected}
              select={select}
              commit={commit}
              report={report}
              {...settings}
              skipSnap={skipSnap}
              consumeSnap={() => setSkipSnap(false)}
              ruler={ruler}
              onRulerChange={setRuler}
              zoom={zoom}
              highlighted={[...highlightedEntityIds, ...linked]}
              fit={cameraFit}
              session={session}
              dispatch={dispatch}
              runCommand={runCommand}
              deleteSelection={deleteSelection}
              copySelection={copySelection}
            />
          </div>
          <ModifyRail
            {...railProps}
            erase={() => (selected.length ? deleteSelection() : startCad('erase'))}
            canErase={
              !readOnly &&
              selected.every(
                (id) => targetCapabilities(doc, targetFromKey(id), role, readOnly).deletable,
              )
            }
          />
        </div>
        <WorkspaceStatus
          cad={cad}
          viewName={doc.views.find((v) => v.id === activeView)?.name ?? activeView}
          axisLabel={doc.editorType === 'VH_PROJECTION' ? 'X-O' : undefined}
          toolName={
            CAD_COMMANDS.find((c) => c.id === activeCommand)?.name ??
            commandRegistry.find((c) => c.id === activeCommand)?.name ??
            '选择'
          }
          message={message}
          entityCount={doc.entities.length}
          selectionCount={selected.length}
          cursorStatusRef={cursorStatusRef}
          snapping={settings.objectSnap}
          toggleSnap={() => toggle('objectSnap')}
          objectTypes={settings.objectTypes}
          changeObjectTypes={(objectTypes) => setSettings((s) => ({ ...s, objectTypes }))}
          orthogonal={settings.ortho}
          toggleOrthogonal={() => toggle('ortho')}
          grid={settings.grid}
          toggleGrid={() => toggle('grid')}
          gridSnap={settings.gridSnap}
          toggleGridSnap={() => toggle('gridSnap')}
          tracking={settings.tracking}
          toggleTracking={() => toggle('tracking')}
          openSettings={openSettings}
          theme={settings.theme}
          toggleTheme={() =>
            setSettings((s) => ({ ...s, theme: s.theme === 'dark' ? 'light' : 'dark' }))
          }
        />
        {(panel === 'settings' || panel === 'file') && (
          <aside
            className="geo-panel"
            role="dialog"
            aria-label={panel === 'settings' ? '视图与设置' : '文档与文件'}
          >
            <div className="geo-card-heading">
              <strong>{panel === 'settings' ? '视图与设置' : '文档与文件'}</strong>
              <button
                type="button"
                onClick={() => dispatch({ type: 'patch', patch: { panel: null } })}
              >
                关闭面板
              </button>
            </div>
            {panel === 'settings' ? (
              <WorkspaceSettings
                {...{
                  doc,
                  settings,
                  setSettings,
                  history,
                  setZoom,
                  fit,
                  setFocusKey,
                  skipSnap,
                  setSkipSnap,
                  ruler,
                  setRuler,
                  readOnly,
                  role,
                  commit,
                  report,
                  perform,
                  problemDocument,
                  activeView,
                }}
              />
            ) : (
              <>
                <button type="button" disabled={readOnly} onClick={importJson}>
                  加载 JSON
                </button>
                <pre className="geo-export">{serializeGeometryDocument(doc)}</pre>
              </>
            )}
          </aside>
        )}
      </div>
    );
  },
);
