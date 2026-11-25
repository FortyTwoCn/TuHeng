'use client';
import { useRef, useState } from 'react';
import type { EditorType } from '@tuheng/contracts';
import { GeometryEditor, type GeometryEditorHandle } from '@tuheng/geometry-editor';
export function GeometryWorkspace() {
  const editor = useRef<GeometryEditorHandle>(null);
  const [sheet, setSheet] = useState<{ type: EditorType; revision: number }>({
    type: 'VHW_PROJECTION',
    revision: 0,
  });
  return (
    <GeometryEditor
      standalone
      ref={editor}
      key={sheet.revision}
      editorType={sheet.type}
      documentName="独立作图"
      onEditorTypeChange={(type) => {
        const current = editor.current?.getDocument();
        if (current?.editorType === type) return;
        if (
          (current?.entities.length || current?.auxiliarySystems?.length) &&
          !window.confirm('切换图纸将开始一份新文档，请先导出需要保留的作图。')
        )
          return;
        setSheet((previous) => ({ type, revision: previous.revision + 1 }));
      }}
    />
  );
}
