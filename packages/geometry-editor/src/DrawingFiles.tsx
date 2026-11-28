import type { RefObject } from 'react';
import { geometryDocumentJsonSchema, type GeometryDocument } from '@tuheng/contracts';
import {
  serializeGeometryDocument,
  exportSheetSvg,
  exportGeometryNarrative,
  exportDocumentToDxf,
  readGeometryJson,
  parseGeometryDocument,
  importPenStroke,
} from '@tuheng/geometry-core';
import { downloadBlob } from './cad-download';
import { readDrawingFile } from './drawing-file-readers';

export type DrawingTextKind = 'json' | 'narrative' | 'svg' | 'dxf';

const drawingTextFormats = {
  json: { export: serializeGeometryDocument, mime: 'application/json', extension: 'json' },
  svg: { export: exportSheetSvg, mime: 'image/svg+xml', extension: 'svg' },
  dxf: { export: exportDocumentToDxf, mime: 'application/dxf', extension: 'dxf' },
  narrative: { export: exportGeometryNarrative, mime: 'text/plain', extension: 'txt' },
};

export function downloadDrawingText(
  doc: GeometryDocument,
  kind: DrawingTextKind,
  onExport?: (text: string, kind: DrawingTextKind) => void,
) {
  const format = drawingTextFormats[kind];
  const text = format.export(doc);
  onExport?.(text, kind);
  downloadBlob(new Blob([text], { type: format.mime }), `tuheng.${format.extension}`);
}

export function downloadDrawingSchema() {
  const text = JSON.stringify(geometryDocumentJsonSchema(), null, 2) + '\n';
  downloadBlob(
    new Blob([text], { type: 'application/schema+json' }),
    'tuheng.geometry.schema.json',
  );
}

export function DrawingFileInput({
  inputRef,
  readOnly,
  doc,
  activeView,
  role,
  report,
  importStroke,
  replaceDocument,
  loaded,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  readOnly: boolean;
  doc: GeometryDocument;
  activeView: string;
  role: 'student' | 'teacher';
  report: (message: string) => void;
  importStroke: (d: GeometryDocument) => GeometryDocument | undefined;
  replaceDocument: (d: GeometryDocument) => void;
  loaded: () => void;
}) {
  return (
    <input
      ref={inputRef}
      className="geo-file-input"
      type="file"
      accept=".json,.zip,application/json,application/zip"
      tabIndex={-1}
      aria-label="加载几何 JSON"
      onChange={async (e) => {
        const control = e.currentTarget,
          file = control.files?.[0];
        if (!file || readOnly) return;
        try {
          const packaged = file.name.toLowerCase().endsWith('.zip');
          const data = readGeometryJson(await readDrawingFile(file));
          // 笔迹附加到当前图纸。完整图纸和 ZIP 则通过同一契约校验后替换文档。
          if (
            !packaged &&
            data &&
            typeof data === 'object' &&
            'schemaVersion' in data &&
            data.schemaVersion === 'tuheng.stroke/1.0.0'
          ) {
            if (!importStroke(importPenStroke(doc, data, activeView, role))) return;
          } else replaceDocument(parseGeometryDocument(data));
          loaded();
          report('图纸已载入');
        } catch (error) {
          report('加载失败，' + (error instanceof Error ? error.message : '文件内容无效'));
        } finally {
          control.value = '';
        }
      }}
    />
  );
}
