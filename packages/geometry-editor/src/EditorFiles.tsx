import { useRef } from 'react';
import type { GeometryDocument } from '@tuheng/contracts';
import { sheetBounds, type DxfImportReport } from '@tuheng/geometry-core';
import { downloadCadFile } from './cad-download';
import {
  DrawingFileInput,
  downloadDrawingSchema,
  downloadDrawingText,
  type DrawingTextKind,
} from './DrawingFiles';
import { DxfImportDialog, dxfImportSummary } from './DxfImportDialog';
import type { useDrawingDocument } from './useDrawingDocument';
import type { useEditorChrome } from './useEditorChrome';

type FileOptions = {
  drawing: ReturnType<typeof useDrawingDocument>;
  chrome: ReturnType<typeof useEditorChrome>;
  role: 'teacher' | 'student';
  readOnly: boolean;
  activeView: string;
  report: (message: string) => void;
  onExport?: (text: string, kind: DrawingTextKind) => void;
  commit: (doc: GeometryDocument, label: string) => GeometryDocument | undefined;
  loaded: () => void;
  resetSelection: () => void;
  inspect: () => void;
  importReference?: (file: File) => void;
};

export function useEditorFiles(options: FileOptions) {
  const input = useRef<HTMLInputElement>(null);
  const dxf = useRef<HTMLDialogElement>(null);
  const reference = useRef<HTMLInputElement>(null);
  const {
    drawing,
    chrome,
    report,
    onExport,
    inspect,
    importReference,
    readOnly,
    activeView,
    role,
    commit,
    loaded,
  } = options;
  const { doc } = drawing;
  const output = (kind: DrawingTextKind) => {
    try {
      downloadDrawingText(doc, kind, onExport);
    } catch (error) {
      report('导出失败，' + (error instanceof Error ? error.message : '图纸内容无效'));
    }
  };
  function applyDxf(result: DxfImportReport) {
    if (result.importedCount) {
      const applied = options.commit(result.document, '导入 DXF');
      if (!applied) return;
      options.resetSelection();
      const bounds = sheetBounds(applied, { drawingOnly: true });
      const current = chrome.camera.current;
      if (
        !current ||
        bounds.x < current.x ||
        bounds.y < current.y ||
        bounds.x + bounds.width > current.x + current.width ||
        bounds.y + bounds.height > current.y + current.height
      )
        chrome.requestFit(bounds);
    }
    report(dxfImportSummary(result));
  }
  const controls = (
    <>
      <DrawingFileInput
        inputRef={input}
        readOnly={readOnly}
        doc={drawing.doc}
        activeView={activeView}
        role={role}
        report={report}
        importStroke={(stroke) => commit(stroke, '导入笔迹')}
        replaceDocument={drawing.load}
        loaded={loaded}
      />
      {importReference && (
        <input
          ref={reference}
          className="geo-file-input"
          type="file"
          accept=".json,.dxf,.zip,application/json,application/dxf,application/zip"
          tabIndex={-1}
          aria-label="选择参考图纸文件"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) importReference(file);
          }}
        />
      )}
      {!readOnly && (
        <DxfImportDialog dialogRef={dxf} doc={drawing.doc} role={role} apply={applyDxf} />
      )}
    </>
  );
  return {
    controls,
    actions: {
      importJson: () => input.current?.click(),
      importDxf: () => dxf.current?.showModal(),
      json: () => output('json'),
      dxf: () => output('dxf'),
      schema: downloadDrawingSchema,
      svg: () => output('svg'),
      narrative: () => output('narrative'),
      png: () => void downloadCadFile(doc, 'png', report),
      viewPng: () => {
        if (chrome.camera.current) void downloadCadFile(doc, 'png', report, chrome.camera.current);
      },
      zip: () => void downloadCadFile(doc, 'zip', report),
      inspect,
      loadReference: importReference ? () => reference.current?.click() : undefined,
    },
  };
}
