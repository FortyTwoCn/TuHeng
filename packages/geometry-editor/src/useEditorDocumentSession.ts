import { useEffect, useReducer, useState } from 'react';
import type { GeometryDocument } from '@tuheng/contracts';
import { targetCapabilities, targetFromKey } from '@tuheng/geometry-core';
import { sessionReducer, viewportSession } from './session';
import { useDrawingDocument } from './useDrawingDocument';

// 与宿主文档同步选择、命令及单步历史。镜头和外围模块不参与文档事务。
export function useEditorDocumentSession({
  locked,
  ...options
}: Parameters<typeof useDrawingDocument>[0] & { locked: boolean }) {
  const drawing = useDrawingDocument(options);
  const { role, readOnly } = options;
  const { doc, synchronize } = drawing;
  const [workspace, dispatch] = useReducer(sessionReducer, {
    activity: { kind: 'tool', tool: 'select' },
    selected: [],
    panel: null,
    active: doc.views[0].id,
    expanded: false,
  });
  const [message, report] = useState('选择对象，或从空白拖动框选');
  const session = viewportSession(workspace);
  const activeView = doc.views.some((view) => view.id === session.active)
    ? session.active
    : doc.views[0].id;
  const selectable = (document: GeometryDocument, ids: string[]) =>
    ids.filter((id) => targetCapabilities(document, targetFromKey(id), role, readOnly).selectable);
  const selected = selectable(doc, session.selected);
  const select = (ids: string[]) => dispatch({ type: 'select', ids });
  const resetCommand = () => dispatch({ type: 'tool', tool: 'select' });
  const resetSelection = () => {
    resetCommand();
    select([]);
  };
  useEffect(() => {
    if (synchronize()) {
      dispatch({ type: 'tool', tool: 'select' });
      dispatch({ type: 'select', ids: [] });
    }
  }, [synchronize]);

  function commit(next: GeometryDocument, label?: string) {
    try {
      const applied = drawing.commit(next, label);
      if (!applied) return;
      select(selectable(applied, selected));
      report('已保存到当前文档');
      return applied;
    } catch (error) {
      report(error instanceof Error ? error.message : '无法保存图纸');
    }
  }
  function replace(next: GeometryDocument) {
    try {
      return drawing.replace(next);
    } catch (error) {
      report(error instanceof Error ? error.message : '无法恢复当前操作');
    }
  }
  function stepHistory(direction: 'undo' | 'redo', count = 1) {
    if (locked) return;
    const restored = drawing.stepHistory(direction, count);
    if (!restored) return;
    dispatch({
      type: 'tool',
      tool: workspace.activity.kind === 'tool' ? workspace.activity.tool : 'select',
    });
    select(selectable(restored, selected));
    report((direction === 'undo' ? '已撤销 ' : '已恢复 ') + count + ' 步');
  }
  const undo = () => stepHistory('undo');
  const redo = () => stepHistory('redo');
  return {
    drawing,
    doc,
    workspace,
    session,
    dispatch,
    message,
    report,
    activeView,
    selected,
    select,
    resetCommand,
    resetSelection,
    commit,
    replace,
    stepHistory,
    undo,
    redo,
  };
}
