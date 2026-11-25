import { useCallback, useMemo, useRef, useState } from 'react';
import { GeometryDocument, type EditorType } from '@tuheng/contracts';
import {
  combineAnswer,
  createDocument,
  DocumentHistory,
  upgradeGeometryDocument,
} from '@tuheng/geometry-core';

type DocumentOptions = {
  editorType: EditorType;
  value?: unknown;
  defaultValue?: unknown;
  onChange?: (doc: GeometryDocument) => void;
  problemDocument?: GeometryDocument;
  role: 'teacher' | 'student';
  readOnly: boolean;
};

type HistorySummary = Pick<DocumentHistory, 'canUndo' | 'canRedo' | 'operations'>;
const emptyHistory: HistorySummary = { canUndo: false, canRedo: false, operations: [] };

function parseInput(input: unknown) {
  const parsed = GeometryDocument.safeParse(input);
  if (!parsed.success || parsed.data.schemaVersion !== 'tuheng.geometry/1.0.0') return parsed;
  try {
    return { success: true, data: upgradeGeometryDocument(parsed.data) } as const;
  } catch {
    return parsed;
  }
}

/** 管理正式文档与撤销历史。选择、镜头和未确认预览由工作区另外管理。 */
export function useDrawingDocument({
  editorType,
  value,
  defaultValue,
  onChange,
  problemDocument,
  role,
  readOnly,
}: DocumentOptions) {
  const [internal, setInternal] = useState(() => defaultValue ?? createDocument(editorType));
  const input = value ?? internal;
  const parsed = useMemo(() => parseInput(input), [input]);
  const doc = useMemo(
    () => (parsed.success ? parsed.data : createDocument(editorType)),
    [parsed, editorType],
  );
  // 只在文档变化时计算内容标识。父级原样回传已提交文档时，保留撤销栈。
  const fingerprint = useMemo(() => JSON.stringify(doc), [doc]);
  const revision = useMemo(() => ({ fingerprint }), [fingerprint]);
  const scope = `${role}:${readOnly}`;
  // 事务更新历史实例。React 只读取用于显示的历史摘要。
  const historyRef = useRef<{ manager: DocumentHistory; scope: string }>(null);
  const [history, setHistory] = useState(emptyHistory);

  const synchronize = useCallback(() => {
    const previous = historyRef.current;
    if (previous?.scope === scope && JSON.stringify(previous.manager.current) === fingerprint)
      return false;
    historyRef.current = { manager: new DocumentHistory(doc), scope };
    setHistory(emptyHistory);
    return !!previous;
  }, [doc, fingerprint, scope]);

  function getHistory() {
    historyRef.current ??= { manager: new DocumentHistory(doc), scope };
    return historyRef.current.manager;
  }

  function publish(next: GeometryDocument, manager: DocumentHistory) {
    const { canUndo, canRedo, operations } = manager;
    setHistory({ canUndo, canRedo, operations });
    setInternal(next);
    onChange?.(next);
    return next;
  }

  function validate(next: GeometryDocument) {
    const valid = GeometryDocument.parse(next);
    if (role !== 'student') return valid;

    // 教学宿主传入冻结题干。独立图纸也允许已有题干，需保护原对象及其关系。
    const lockedLayers = new Set(
      doc.layers.filter((layer) => layer.role === 'PROBLEM_STEM').map((layer) => layer.id),
    );
    const stem = doc.entities.filter((entity) => lockedLayers.has(entity.layerId));
    if (!problemDocument && !stem.length) return valid;
    const ids = new Set(stem.map((entity) => entity.id));
    return combineAnswer(
      problemDocument ?? {
        ...doc,
        entities: stem,
        constraints: doc.constraints.filter((relation) =>
          relation.entityIds.every((id) => ids.has(id)),
        ),
        projectionGroups: doc.projectionGroups.filter((group) =>
          group.entityIds.every((id) => ids.has(id)),
        ),
        referenceRelations: doc.referenceRelations?.filter((relation) =>
          ids.has(relation.targetId),
        ),
      },
      valid,
    );
  }

  function commit(next: GeometryDocument, label?: string) {
    if (readOnly || next === doc) return;
    const valid = validate(next);
    const manager = getHistory();
    manager.current = doc;
    return publish(manager.commit(valid, label), manager);
  }

  // 恢复原笔迹或取消吸附属于当前操作，因此替换历史顶项。
  function replace(next: GeometryDocument) {
    if (readOnly) return;
    const manager = getHistory();
    return publish(manager.replaceCurrent(validate(next)), manager);
  }

  function load(next: GeometryDocument) {
    if (readOnly) return;
    const valid = validate(next);
    const manager = new DocumentHistory(valid);
    historyRef.current = { manager, scope };
    return publish(valid, manager);
  }

  function stepHistory(direction: 'undo' | 'redo', count: number) {
    if (readOnly) return;
    const manager = getHistory();
    if (!(direction === 'undo' ? manager.canUndo : manager.canRedo)) return;
    for (let step = 0; step < count; step++) manager[direction]();
    return publish(manager.current, manager);
  }

  return {
    doc,
    parsed,
    fingerprint,
    revision,
    history,
    synchronize,
    commit,
    replace,
    load,
    stepHistory,
  };
}
