import { useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { GeometryDocument } from '@tuheng/contracts';
import { importDxfToDocument, type DxfImportReport } from '@tuheng/geometry-core';
import { readDxfFile } from './drawing-file-readers';

type ImportReceipt = Pick<
  DxfImportReport,
  'warnings' | 'importedCount' | 'createdEntityCount' | 'ignoredCount'
>;

export function dxfImportSummary(result: ImportReceipt) {
  const summary = `已导入 ${result.importedCount} 个 DXF 对象，新增 ${result.createdEntityCount} 个图元和节点`;
  return result.ignoredCount ? `${summary}，忽略 ${result.ignoredCount} 个对象` : summary;
}

type ImportContext = {
  doc: GeometryDocument;
  role: 'teacher' | 'student';
  apply: (result: DxfImportReport) => void;
};

export function DxfImportDialog({
  dialogRef,
  doc,
  role,
  apply,
}: ImportContext & { dialogRef: RefObject<HTMLDialogElement | null> }) {
  const title = useId();
  const control = useRef<HTMLInputElement>(null);
  const latest = useRef<ImportContext>(null);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [center, setCenter] = useState(false);
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<ImportReceipt>();
  useLayoutEffect(() => {
    latest.current = { doc, role, apply };
    return () => {
      latest.current = null;
    };
  }, [doc, role, apply]);

  async function runImport() {
    if (!file || busy) return;
    setBusy(true);
    setError('');
    try {
      const text = await readDxfFile(file);
      const current = latest.current;
      if (!dialogRef.current?.open || !current) return;
      if (current.doc !== doc || current.role !== role) throw Error('当前图纸已更新，请重新导入');
      const result = importDxfToDocument(text, {
        document: doc,
        role,
        mode,
        placement: center ? 'center' : 'preserve',
      });
      current.apply(result);
      const { warnings, importedCount, createdEntityCount, ignoredCount } = result;
      if (warnings.length)
        setReceipt({ warnings, importedCount, createdEntityCount, ignoredCount });
      else dialogRef.current.close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '文件内容无效');
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialogRef}
      className="geo-dxf-dialog"
      aria-labelledby={title}
      onKeyDown={(event) => event.stopPropagation()}
      onCancel={(event) => {
        if (busy) event.preventDefault();
      }}
      onClose={() => {
        setFile(undefined);
        setMode('merge');
        setCenter(false);
        setError('');
        setReceipt(undefined);
        if (control.current) control.current.value = '';
      }}
    >
      <h3 id={title}>导入 DXF</h3>
      {receipt ? (
        <>
          <p role="status">{dxfImportSummary(receipt)}</p>
          <ul>
            {receipt.warnings.map(({ type, count, message }) => (
              <li key={type + '/' + message}>
                {type} × {count}，{message}
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => dialogRef.current?.close()}>
            完成
          </button>
        </>
      ) : (
        <>
          <label>
            导入方式
            <select
              value={mode}
              disabled={busy}
              onChange={(e) => setMode(e.target.value === 'replace' ? 'replace' : 'merge')}
            >
              <option value="merge">合并导入</option>
              <option value="replace">替换当前可编辑图层</option>
            </select>
          </label>
          <label className="geo-dxf-center">
            <input
              type="checkbox"
              checked={center}
              disabled={busy}
              onChange={(e) => setCenter(e.target.checked)}
            />
            将图形居中到原点
          </label>
          <label>
            选择 DXF 文件
            <input
              ref={control}
              type="file"
              accept=".dxf,application/dxf"
              disabled={busy}
              onChange={(e) => setFile(e.target.files?.[0])}
            />
          </label>
          {error && <p role="alert">导入失败，{error}</p>}
          <div className="geo-dxf-actions">
            <button type="button" disabled={busy} onClick={() => dialogRef.current?.close()}>
              取消
            </button>
            <button type="button" disabled={!file || busy} onClick={() => void runImport()}>
              {busy ? '正在导入…' : '导入图形'}
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
