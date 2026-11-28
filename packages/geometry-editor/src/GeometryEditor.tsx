'use client';
import { forwardRef, useImperativeHandle } from 'react';
import type { EditorType, GeometryDocument } from '@tuheng/contracts';
import {
  copyEntitiesFromReferenceDocument,
  editorRegistry,
  exportGeometryNarrative,
  serializeGeometryDocument,
} from '@tuheng/geometry-core';
import { useEditorFiles } from './EditorFiles';
import { EditorWorkspaceBody } from './EditorWorkspaceBody';
import { useWorkspaceFeatures } from './modules/useWorkspaceFeatures';
import {
  useWorkspaceLayout,
  type WorkspaceMode,
  type WorkspaceModules,
} from './modules/useWorkspaceLayout';
import { useEditorDocumentSession } from './useEditorDocumentSession';
import { useEditorChrome } from './useEditorChrome';
import { useEditorCommands } from './useEditorCommands';
import { EditorHeader, EditorFooter } from './EditorChromeControls';
import { workspaceShortcuts } from './workspace-shortcuts';
import type { DrawingTextKind } from './DrawingFiles';
import './styles.css';

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
  workspaceMode?: WorkspaceMode;
  enabledModules?: WorkspaceModules;
  referenceDocument?: GeometryDocument | null;
  referenceTitle?: string;
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
      workspaceMode = 'drafting',
      enabledModules,
      referenceDocument,
      referenceTitle,
    },
    ref,
  ) {
    const layout = useWorkspaceLayout(workspaceMode, enabledModules, readOnly);
    const locked = readOnly || layout.editingLocked;
    const model = useEditorDocumentSession({
      editorType,
      value,
      defaultValue,
      onChange,
      role,
      readOnly,
      locked,
      problemDocument,
    });
    const {
      drawing,
      doc,
      workspace,
      session,
      dispatch,
      report,
      commit,
      replace,
      undo,
      redo,
      activeView,
      selected,
      select,
      resetCommand,
      resetSelection,
    } = model;
    const { parsed, fingerprint, revision } = drawing;
    const { expanded, tool } = session;
    const chrome = useEditorChrome(doc);
    const { root, settings, appearance, fit, toggle } = chrome;
    useImperativeHandle(ref, () => ({
      getDocument: () => doc,
      exportJSON: () => serializeGeometryDocument(doc),
      exportNarrative: () => exportGeometryNarrative(doc),
      undo,
      redo,
      fitToContent: fit,
    }));

    const features = useWorkspaceFeatures({
      doc,
      layout,
      readOnly,
      selected,
      commit,
      report,
      resetCommand,
      referenceDocument,
      referenceTitle,
    });
    const { animation, audit, solid, reference } = features;
    const commands = useEditorCommands({
      doc,
      fingerprint,
      role,
      locked,
      activity: workspace.activity,
      session,
      dispatch,
      activeView,
      selected,
      select,
      commit,
      report,
      chrome,
    });
    const { cad, runCommand, deleteSelection, copySelection } = commands;
    const files = useEditorFiles({
      drawing,
      chrome,
      role,
      readOnly,
      activeView,
      report,
      commit,
      resetSelection,
      onExport,
      loaded() {
        resetSelection();
        features.resetAfterLoad();
        fit();
      },
      inspect: () => dispatch({ type: 'patch', patch: { panel: 'file' } }),
      importReference: layout.canReference
        ? (file) => {
            layout.openReference();
            void reference.load(file);
          }
        : undefined,
    });
    function changeMode(next: WorkspaceMode) {
      if (next === layout.mode) return;
      features.resetTeachingInteraction();
      layout.changeMode(next);
    }
    function copyReference(source: GeometryDocument, ids: string[]) {
      if (locked) return;
      try {
        const current = chrome.camera.current ?? undefined;
        const result = copyEntitiesFromReferenceDocument(source, doc, ids, {
          role,
          activeViewId: activeView,
          visibleBounds: current,
        });
        const applied = commit(result.document, '复制参考图元');
        if (!applied) return;
        resetCommand();
        select(result.selectedIds);
        layout.setPane('sheet');
        const { bounds } = result;
        if (
          !current ||
          bounds.x < current.x ||
          bounds.y < current.y ||
          bounds.x + bounds.width > current.x + current.width ||
          bounds.y + bounds.height > current.y + current.height
        )
          chrome.requestFit(bounds);
        requestAnimationFrame(chrome.focusCanvas);
        report(`已复制 ${result.selectedIds.length} 个对象到主画框，可直接拖动摆放`);
      } catch (error) {
        report('复制参考图元失败，' + (error instanceof Error ? error.message : '图元内容无效'));
      }
    }
    if (!parsed.success)
      return (
        <div role="alert">
          几何文档加载失败。
          {parsed.error.issues
            .slice(0, 3)
            .map((issue) => issue.message)
            .join('；')}
        </div>
      );
    const linked = doc.projectionGroups
      .filter((group) => group.entityIds.some((id) => selected.includes(id)))
      .flatMap((group) => group.entityIds);
    const view = {
      ...settings,
      document: doc,
      cad,
      appearance,
      revision,
      viewId: activeView,
      replace,
      onCameraChange: chrome.updateCamera,
      cursorStatusRef: chrome.cursorStatusRef,
      gridSpacing: doc.settings.grid,
      focusKey: chrome.focusKey,
      role,
      readOnly: locked,
      tool: layout.playback ? ('pan' as const) : tool,
      selected: layout.playback ? [] : selected,
      select,
      commit,
      report,
      skipSnap: chrome.skipSnap,
      consumeSnap: () => chrome.setSkipSnap(false),
      ruler: layout.playback ? { ...chrome.ruler, visible: false } : chrome.ruler,
      onRulerChange: chrome.setRuler,
      zoom: chrome.zoom,
      fit: chrome.cameraFit,
      highlighted: [
        ...highlightedEntityIds,
        ...linked,
        ...solid.linked2D,
        ...(audit.selected?.entityIds ?? []),
      ],
      playback: animation.playback.presentation,
      auditCheck: audit.selected,
      hoverEntity: layout.showSolid && solid.link ? solid.setEntityHover : undefined,
      fitTeachingViewport: layout.mode === 'teaching' || layout.showAudit || layout.docked,
      session: layout.playback ? { ...session, construction: null, panel: null } : session,
      dispatch,
      runCommand,
      deleteSelection,
      copySelection,
    };
    return (
      <div
        ref={root}
        data-workspace-ready={chrome.ready}
        inert={!chrome.ready}
        className={`geometry-editor ${standalone ? 'geo-standalone' : ''} ${expanded ? 'geo-expanded' : ''} ${settings.inputLayout === 'touch' || (settings.inputLayout === 'auto' && chrome.touch) ? 'geo-touch' : ''}`}
        data-workspace-mode={layout.mode}
        data-input-layout={settings.inputLayout}
        data-theme={settings.theme}
        onPointerUp={(event) => {
          // 混合输入先完成画布手势，再更新工具栏尺寸。
          if (event.target instanceof Element && event.target.closest('.geo-view > svg'))
            chrome.setTouch(event.pointerType === 'touch' || event.pointerType === 'pen');
        }}
        tabIndex={0}
        aria-label={`${editorRegistry[doc.editorType].name}编辑器`}
        onKeyDown={workspaceShortcuts({
          playback: layout.playback,
          animation: animation.playback,
          exitTeaching: () => changeMode('drafting'),
          session,
          dispatch,
          commands,
          selected,
          select,
          undo,
          redo,
          toggle,
        })}
      >
        <EditorHeader
          model={model}
          chrome={chrome}
          commands={commands}
          role={role}
          readOnly={readOnly}
          locked={locked}
          layout={layout}
          changeMode={changeMode}
          standalone={standalone}
          documentName={documentName}
          onEditorTypeChange={onEditorTypeChange}
          fileActions={{ ...files.actions, ...animation.files }}
        />
        {files.controls}
        {animation.fileControls}
        <EditorWorkspaceBody
          viewport={view}
          commands={commands}
          layout={layout}
          features={features}
          readOnly={readOnly}
          loadReference={() => files.actions.loadReference?.()}
          copyReference={copyReference}
        />
        <EditorFooter
          model={model}
          chrome={chrome}
          commands={commands}
          role={role}
          readOnly={readOnly}
          locked={locked}
          problemDocument={problemDocument}
          importJson={files.actions.importJson}
        />
      </div>
    );
  },
);
