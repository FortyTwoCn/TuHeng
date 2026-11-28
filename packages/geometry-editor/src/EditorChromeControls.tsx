import type { ComponentProps } from 'react';
import type { GeometryDocument, EditorType } from '@tuheng/contracts';
import { CAD_COMMANDS, editorRegistry, serializeGeometryDocument } from '@tuheng/geometry-core';
import { DrawingAppearance } from './CadPreferences';
import { commandRegistry } from './commands';
import { GridSpacing } from './GridSpacing';
import { WorkspaceSettings } from './WorkspaceSettings';
import { WorkspaceStatus, WorkspaceTopbar } from './workspace-controls';
import type { useEditorChrome } from './useEditorChrome';
import type { useEditorCommands } from './useEditorCommands';
import type { useEditorDocumentSession } from './useEditorDocumentSession';
import type { WorkspaceLayout, WorkspaceMode } from './modules/useWorkspaceLayout';

type Context = {
  model: ReturnType<typeof useEditorDocumentSession>;
  chrome: ReturnType<typeof useEditorChrome>;
  commands: ReturnType<typeof useEditorCommands>;
  role: 'teacher' | 'student';
  readOnly: boolean;
  locked: boolean;
};

export function EditorHeader({
  model,
  chrome,
  commands,
  role,
  readOnly,
  locked,
  layout,
  changeMode,
  standalone,
  documentName,
  onEditorTypeChange,
  fileActions,
}: Context & {
  layout: WorkspaceLayout;
  changeMode: (mode: WorkspaceMode) => void;
  standalone: boolean;
  documentName?: string;
  onEditorTypeChange?: (type: EditorType) => void;
  fileActions: ComponentProps<typeof WorkspaceTopbar>['fileActions'];
}) {
  const { doc, drawing, session, dispatch, report, commit, stepHistory, undo, redo, selected } =
    model;
  const { history } = drawing;
  const { expanded } = session;
  const { fit, root, settings, appearance, setAppearance } = chrome;
  const { startCad } = commands;
  return (
    <WorkspaceTopbar
      title={documentName ?? editorRegistry[doc.editorType].name}
      fullscreen={chrome.fullscreen}
      expanded={expanded}
      standalone={standalone}
      readOnly={locked}
      filesReadOnly={readOnly}
      canUndo={history.canUndo}
      canRedo={history.canRedo}
      operations={history.operations}
      jumpHistory={stepHistory}
      undo={undo}
      redo={redo}
      fit={fit}
      startCad={startCad}
      toggleExpanded={() => dispatch({ type: 'patch', patch: { expanded: !expanded } })}
      toggleFullscreen={() => {
        if (document.fullscreenElement === root.current)
          void document.exitFullscreen().catch(() => report('无法退出全屏'));
        else if (root.current?.requestFullscreen)
          void root.current.requestFullscreen().catch(() => report('浏览器无法进入全屏'));
        else if (!standalone) dispatch({ type: 'patch', patch: { expanded: !expanded } });
        else report('此浏览器未开放网页全屏');
      }}
      workspace={{
        mode: layout.mode,
        changeMode,
        audit: layout.canAudit
          ? { open: layout.showAudit, toggle: () => layout.openAudit(!layout.showAudit) }
          : undefined,
        reference: layout.canReference
          ? {
              open: layout.reference.visibility === 'open',
              toggle:
                layout.reference.visibility === 'open'
                  ? layout.minimizeReference
                  : layout.openReference,
            }
          : undefined,
      }}
      fileActions={fileActions}
      sheetControl={
        onEditorTypeChange ? (
          <select
            className="cad-sheet-select"
            aria-label="图纸类型"
            value={doc.editorType}
            onChange={(event) => onEditorTypeChange(event.target.value as EditorType)}
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
        (!layout.playback || layout.authoring) && (
          <>
            <DrawingAppearance
              theme={settings.theme}
              initial={appearance}
              doc={doc}
              selected={selected}
              role={role}
              readOnly={locked}
              commit={commit}
              change={setAppearance}
              report={report}
            />
            <GridSpacing
              key={doc.settings.grid}
              readOnly={locked}
              value={doc.settings.grid}
              report={report}
              change={(grid) =>
                commit({ ...doc, settings: { ...doc.settings, grid } }, '设置网格间距')
              }
            />
          </>
        )
      }
    />
  );
}

export function EditorFooter({
  model,
  chrome,
  commands,
  role,
  readOnly,
  locked,
  problemDocument,
  importJson,
}: Context & {
  problemDocument?: GeometryDocument;
  importJson: () => void;
}) {
  const { doc, drawing, session, dispatch, activeView, message, selected, commit, report } = model;
  const { history } = drawing;
  const { panel } = session;
  const { cad, activeCommand } = commands;
  const { settings, setSettings, fit, toggle } = chrome;
  const openSettings = () =>
    dispatch({ type: 'patch', patch: { panel: panel === 'settings' ? null : 'settings' } });
  return (
    <>
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
        cursorStatusRef={chrome.cursorStatusRef}
        snapping={settings.objectSnap}
        toggleSnap={() => toggle('objectSnap')}
        objectTypes={settings.objectTypes}
        changeObjectTypes={(objectTypes) => setSettings((old) => ({ ...old, objectTypes }))}
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
          setSettings((old) => ({ ...old, theme: old.theme === 'dark' ? 'light' : 'dark' }))
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
              doc={doc}
              settings={settings}
              setSettings={setSettings}
              history={history}
              setZoom={chrome.setZoom}
              fit={fit}
              setFocusKey={chrome.setFocusKey}
              skipSnap={chrome.skipSnap}
              setSkipSnap={chrome.setSkipSnap}
              ruler={chrome.ruler}
              setRuler={chrome.setRuler}
              readOnly={locked}
              role={role}
              commit={commit}
              report={report}
              perform={commands.perform}
              problemDocument={problemDocument}
              activeView={activeView}
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
    </>
  );
}
