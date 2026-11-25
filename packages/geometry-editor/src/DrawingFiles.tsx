import type { RefObject } from 'react';
import type { GeometryDocument } from '@tuheng/contracts';
import {
  serializeGeometryDocument,
  exportSheetSvg,
  exportGeometryNarrative,
  loadGeometryDocument,
  importPenStroke,
  readCadPackage,
  cadPackageLimit,
} from '@tuheng/geometry-core';
export function downloadDrawingText(
  doc: GeometryDocument,
  kind: 'json' | 'narrative' | 'svg',
  onExport?: (text: string, kind: 'json' | 'narrative' | 'svg') => void,
) {
  const text =
    kind === 'json'
      ? serializeGeometryDocument(doc)
      : kind === 'svg'
        ? exportSheetSvg(doc)
        : exportGeometryNarrative(doc);
  onExport?.(text, kind);
  const url = URL.createObjectURL(
      new Blob([text], {
        type:
          kind === 'svg' ? 'image/svg+xml' : kind === 'json' ? 'application/json' : 'text/plain',
      }),
    ),
    a = document.createElement('a');
  a.href = url;
  a.download = `tuheng.${kind === 'narrative' ? 'txt' : kind}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
          if (!packaged && file.size > 2_000_000) throw Error('文档超过 2MB');
          if (packaged && file.size > cadPackageLimit) throw Error('图纸包超过 8MB');
          const text = packaged ? await readCadPackage(await file.arrayBuffer()) : await file.text();
          const data = JSON.parse(text);
          if (!packaged && data?.schemaVersion === 'tuheng.stroke/1.0.0') {
            if (!importStroke(importPenStroke(doc, data, activeView, role))) return;
          } else replaceDocument(loadGeometryDocument(text));
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
