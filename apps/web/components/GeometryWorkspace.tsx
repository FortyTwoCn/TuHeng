'use client';
import { useState } from 'react';
import type { EditorType } from '@tuheng/contracts';
import { GeometryEditor } from '@tuheng/geometry-editor';
import { editorRegistry } from '@tuheng/geometry-core';
export function GeometryWorkspace() {
  const [type, setType] = useState<EditorType>('VHW_PROJECTION');
  return (
    <>
      <label>
        图纸类型
        <select
          aria-label="图纸类型"
          value={type}
          onChange={(e) => {
            if (window.confirm('切换图纸将开始一份新文档，请先导出需要保留的作图。'))
              setType(e.target.value as EditorType);
          }}
        >
          {Object.entries(editorRegistry).map(([key, def]) => (
            <option key={key} value={key}>
              {def.name}
            </option>
          ))}
        </select>
      </label>
      <GeometryEditor key={type} editorType={type} />
    </>
  );
}
