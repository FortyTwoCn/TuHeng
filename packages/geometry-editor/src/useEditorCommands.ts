import type { Dispatch } from 'react';
import type { GeometryDocument } from '@tuheng/contracts';
import {
  CAD_COMMANDS,
  copyEntities,
  deleteEntities,
  deleteProjectionAxis,
  deletionSet,
  resolveReference,
  targetCapabilities,
  targetFromKey,
} from '@tuheng/geometry-core';
import { commandRegistry, commandUnavailable, type CommandId } from './commands';
import { linePresets } from './CadPreferences';
import { useCadCommand, type CadId } from './useCadCommand';
import type { EditorSession, SessionAction, WorkspaceSession } from './session';
import type { useEditorChrome } from './useEditorChrome';

type WorkspaceCommandOptions = {
  doc: GeometryDocument;
  fingerprint: string;
  role: 'teacher' | 'student';
  locked: boolean;
  activity: WorkspaceSession['activity'];
  session: EditorSession;
  dispatch: Dispatch<SessionAction>;
  activeView: string;
  selected: string[];
  select: (ids: string[]) => void;
  commit: (doc: GeometryDocument, label?: string) => GeometryDocument | undefined;
  report: (message: string) => void;
  chrome: ReturnType<typeof useEditorChrome>;
};

// 工具栏、快捷键、命令和属性菜单共用工作区的选择与事务入口。
export function useEditorCommands({
  doc,
  fingerprint,
  role,
  locked,
  activity,
  session,
  dispatch,
  activeView,
  selected,
  select,
  commit,
  report,
  chrome,
}: WorkspaceCommandOptions) {
  const { tool, panel } = session;
  const { appearance, setAppearance, settings, setSettings, focusCanvas } = chrome;
  const perform = (op: () => GeometryDocument) => {
    try {
      commit(op());
    } catch (e) {
      report((e as Error).message);
    }
  };
  const deleteSelection = () =>
    perform(() => {
      if (
        selected.some((id) => !targetCapabilities(doc, targetFromKey(id), role, locked).deletable)
      )
        throw Error('选择含只读或有依赖对象，不能删除');
      const ids = selected.filter((id) => targetFromKey(id).kind === 'entity');
      const affected = deletionSet(doc, ids, role).size - ids.length;
      if (affected > 0 && !window.confirm('同时删除依赖所选节点的 ' + affected + ' 个对象？'))
        return doc;
      let d = doc;
      for (const id of selected) {
        const r = targetFromKey(id);
        if (r.kind === 'projectionAxis') d = deleteProjectionAxis(d, r.systemId, role);
      }
      d = deleteEntities(
        d,
        selected.filter((id) => targetFromKey(id).kind === 'entity'),
        role,
      );
      select([]);
      return d;
    });
  const copySelection = () => perform(() => copyEntities(doc, selected, role));
  const cad = useCadCommand(
    activity,
    dispatch,
    doc,
    fingerprint,
    activeView,
    role,
    locked,
    selected,
    commit,
    report,
    appearance,
  );
  function startCad(id: CadId) {
    if (locked) return;
    const group = CAD_COMMANDS.find((command) => command.id === id)?.group;
    if (id === 'point') setAppearance({ pattern: 'SOLID', ...linePresets.SOLID });
    if (group === '尺寸标注' || group === '高级标注')
      setAppearance({ pattern: 'GUIDE', ...linePresets.GUIDE });
    cad.start(id);
    focusCanvas();
  }
  const runCommand = (id: CommandId) => {
    const entry = commandRegistry.find((e) => e.id === id);
    if (!entry) return;
    const reason = commandUnavailable(entry, locked, doc.editorType);
    if (reason) {
      report(reason);
      return;
    }
    if (entry.kind === 'tool') {
      dispatch({ type: 'tool', tool: id as typeof tool });
      if (id === 'projection' || id === 'pen') select([]);
      report(
        id === 'box'
          ? '点击或拖动两个对角点'
          : id === 'projection'
            ? '选择不同投影中的对应对象'
            : entry.name,
      );
      return;
    }
    if (id === 'new-axis') {
      dispatch({ type: 'patch', patch: { panel: 'axis', construction: null, tool: 'select' } });
      return;
    }
    const mode = id.startsWith('construct') ? 'create' : 'adjust',
      directionMode = id.endsWith('parallel') ? 'PARALLEL' : 'PERPENDICULAR';
    let reference;
    try {
      const r = selected[0] ? targetFromKey(selected[0]) : undefined;
      if (r && resolveReference(doc, r).direction) reference = r;
    } catch {}
    dispatch({
      type: 'patch',
      patch: {
        tool: 'select',
        panel: null,
        construction: {
          mode,
          spec: { directionMode, geometryExtent: 'line', semanticStyle: 'visible', length: 10 },
          reference,
          keep: false,
          phase: reference ? (mode === 'create' ? 'position' : 'target') : 'reference',
        },
      },
    });
    report(
      reference
        ? mode === 'create'
          ? '选择通过点或位置；参考对象保持不动'
          : '选择待修改答案线'
        : '请选择参考线或投影轴',
    );
  };
  const activeCommand =
    cad.session?.commandId ??
    (panel === 'axis'
      ? 'new-axis'
      : session.construction
        ? (session.construction.mode === 'create' ? 'construct-' : 'relation-') +
          (session.construction.spec.directionMode === 'PARALLEL' ? 'parallel' : 'perpendicular')
        : tool);
  const railProps = {
    active: activeCommand,
    readOnly: locked,
    editorType: doc.editorType,
    run: runCommand,
    start: startCad,
    selectionMode: settings.selectionMode,
    setSelectionMode: (selectionMode: typeof settings.selectionMode) =>
      setSettings((s) => ({ ...s, selectionMode })),
  };
  return {
    cad,
    railProps,
    activeCommand,
    startCad,
    runCommand,
    deleteSelection,
    copySelection,
    perform,
  };
}
