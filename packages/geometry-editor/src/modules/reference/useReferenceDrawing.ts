import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  editorRegistry,
  importDxfToDocument,
  loadGeometryDocument,
  validateGeometryDocument,
} from '@tuheng/geometry-core';
import type { GeometryDocument } from '@tuheng/contracts';
import { readDrawingFile, readDxfFile } from '../../drawing-file-readers';

type Entry = { document: GeometryDocument; title: string; notice?: string };

async function loadReferenceDrawing(file: File): Promise<Entry> {
  const extension = file.name.split('.').at(-1)?.toLowerCase();
  if (extension === 'dxf') {
    const result = importDxfToDocument(await readDxfFile(file));
    if (!result.importedCount) throw Error('DXF 中没有可预览的图元');
    return {
      document: result.document,
      title: file.name,
      notice: result.ignoredCount ? `DXF 已略过 ${result.ignoredCount} 个对象` : undefined,
    };
  }
  if (extension !== 'zip' && extension !== 'json') throw Error('请选择 JSON、DXF 或 ZIP 图纸包');
  return { document: loadGeometryDocument(await readDrawingFile(file)), title: file.name };
}

// 参考图只保存于本工作区。关闭或再次打开文件时，使先前的异步读取失效。
export function useReferenceDrawing(supplied: GeometryDocument | null | undefined, title?: string) {
  const [loaded, setLoaded] = useState<Entry>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [previous, setPrevious] = useState(supplied);
  const validated = useMemo(() => supplied && validateGeometryDocument(supplied), [supplied]);
  const request = useRef(0);
  useLayoutEffect(
    () => () => {
      request.current++;
    },
    [supplied],
  );
  if (previous !== supplied) {
    setPrevious(supplied);
    setLoaded(undefined);
    setError('');
    setLoading(false);
  }
  const suppliedDrawing = validated?.success ? validated.data : undefined;
  const entry =
    loaded ??
    (suppliedDrawing
      ? {
          document: suppliedDrawing,
          title:
            title ||
            suppliedDrawing.metadata.title ||
            editorRegistry[suppliedDrawing.editorType].name,
        }
      : undefined);
  return {
    entry,
    loading,
    error:
      error ||
      (validated && !validated.success && !loaded
        ? '参考图纸加载失败，图纸数据不符合几何契约'
        : ''),
    async load(file: File) {
      const ticket = ++request.current;
      setLoading(true);
      setError('');
      try {
        const next = await loadReferenceDrawing(file);
        if (ticket === request.current) setLoaded(next);
      } catch (cause) {
        if (ticket === request.current)
          setError(
            '参考图纸加载失败，' + (cause instanceof Error ? cause.message : '文件内容无效'),
          );
      } finally {
        if (ticket === request.current) setLoading(false);
      }
    },
    clear() {
      request.current++;
      setLoaded(undefined);
      setError('');
      setLoading(false);
    },
  };
}
