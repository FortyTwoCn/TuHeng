'use client';
import {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useEffect,
  useReducer,
} from 'react';
import { GeometryDocument, type EditorType } from '@tuheng/contracts';
import {
  createDocument,
  DocumentHistory,
  serializeGeometryDocument,
  exportGeometryNarrative,
  loadGeometryDocument,
  deleteEntities,
  copyEntities,
  editorRegistry,
  combineAnswer,
  upgradeGeometryDocument,
  orthographic,
  exportSheetSvg,
  importPenStroke,
  targetFromKey,
  targetCapabilities,
  deleteProjectionAxis,
  resolveReference,
} from '@tuheng/geometry-core';
import { Viewport } from './Viewport';
import { ToolPicker } from './ToolPicker';
import { PlaneCreator } from './Inspector';
import { RelatedPlaneTools } from './PlaneTools';
import { ProjectionSettings } from './ProjectionSettings';
import { RulerControls } from './RulerControls';
import { EditorToolbar } from './EditorToolbar';
import { EditorPopover } from './EditorPopover';
import { commandRegistry, commandUnavailable, textEntry, type CommandId } from './commands';
import { sessionReducer } from './session';
import type { Ruler } from './types';
import './styles.css';
export interface GeometryEditorHandle {
  getDocument: () => GeometryDocument;
  exportJSON: () => string;
  exportNarrative: () => string;
  undo: () => void;
  redo: () => void;
  fitToContent: () => void;
}
export interface GeometryEditorProps {
  editorType?: EditorType;
  value?: unknown;
  defaultValue?: unknown;
  onChange?: (doc: GeometryDocument) => void;
  role?: 'teacher' | 'student';
  readOnly?: boolean;
  problemDocument?: GeometryDocument;
  highlightedEntityIds?: string[];
  onExport?: (text: string, kind: 'json' | 'narrative' | 'svg') => void;
}

export const GeometryEditor = forwardRef<GeometryEditorHandle, GeometryEditorProps>(
  function GeometryEditor(
    {
      editorType = 'VHW_PROJECTION',
      value,
      defaultValue,
      onChange,
      role = 'student',
      readOnly = false,
      problemDocument,
      highlightedEntityIds = [],
      onExport,
    },
    ref,
  ) {
    const [internal, setInternal] = useState<unknown>(
      () => defaultValue ?? createDocument(editorType),
    );
    const input = value ?? internal;
    const parsed = useMemo(() => {
      try {
        return GeometryDocument.safeParse(upgradeGeometryDocument(input));
      } catch {
        return GeometryDocument.safeParse(input);
      }
    }, [input]);
    const doc = useMemo(
      () => (parsed.success ? parsed.data : createDocument(editorType)),
      [parsed, editorType],
    );
    // The fingerprint is computed once at the controlled boundary, never on pointermove.
    const fingerprint = useMemo(() => JSON.stringify(doc), [doc]);
    const revision = useMemo(() => ({ fingerprint }), [fingerprint]);
    const history = useRef(new DocumentHistory(doc));
    const [session, dispatch] = useReducer(sessionReducer, {
      tool: 'select',
      selected: [],
      panel: null,
      construction: null,
      active: doc.views[0].id,
      expanded: false,
    });
    const { tool, expanded, panel } = session;
    const selected = session.selected.filter(
      (id) => targetCapabilities(doc, targetFromKey(id), role, readOnly).selectable,
    );
    const select = (ids: string[]) => dispatch({ type: 'select', ids });
    const [message, report] = useState('选择对象，或从空白拖动框选');
    const [settings, setSettings] = useState({
      snapping: true,
      gridSnap: false,
      projectionSnap: false,
      axesSnap: true,
      referenceFilter: false,
      fingerDraw: false,
      grid: true,
      axes: true,
      labels: doc.settings.labels,
      hiddenLayers: [] as string[],
    });
    const [skipSnap, setSkipSnap] = useState(false),
      [zoom, setZoom] = useState(1),
      [fitKey, setFitKey] = useState(0),
      [focusKey, setFocusKey] = useState(0);
    const [ruler, setRuler] = useState<Ruler>({
      visible: false,
      origin: { x: 5, y: 5 },
      angle: 0,
      length: 60,
    });
    const [exported, setExported] = useState('');
    const root = useRef<HTMLDivElement>(null);
    const [compact, setCompact] = useState(false);
    useEffect(() => {
      const el = root.current;
      if (!el) return;
      const observer = new ResizeObserver(([e]) => setCompact(e.contentRect.width < 700));
      observer.observe(el);
      return () => observer.disconnect();
    }, []);
    useEffect(() => {
      if (JSON.stringify(history.current.current) !== fingerprint) {
        history.current = new DocumentHistory(doc);
        dispatch({ type: 'patch', patch: { selected: [], construction: null } });
      }
    }, [fingerprint, doc]);
    const update = (next: GeometryDocument) => {
      if (readOnly) return;
      setInternal(next);
      onChange?.(next);
    };
    const validate = (next: GeometryDocument) => {
      next = GeometryDocument.parse(next);
      if (role === 'student') {
        const stem = doc.entities.filter(
            (e) => doc.layers.find((l) => l.id === e.layerId)?.role === 'PROBLEM_STEM',
          ),
          ids = new Set(stem.map((e) => e.id));
        if (problemDocument || stem.length)
          next = combineAnswer(
            problemDocument ?? {
              ...doc,
              entities: stem,
              constraints: doc.constraints.filter((r) => r.entityIds.every((id) => ids.has(id))),
              projectionGroups: doc.projectionGroups.filter((r) =>
                r.entityIds.every((id) => ids.has(id)),
              ),
              referenceRelations: doc.referenceRelations?.filter((r) => ids.has(r.targetId)),
            },
            next,
          );
      }
      return next;
    };
    const commit = (next: GeometryDocument) => {
      if (readOnly) return;
      try {
        history.current.current = doc;
        const valid = validate(next);
        update(history.current.commit(valid));
        select(
          selected.filter((id) => {
            const r = targetFromKey(id);
            return r.kind === 'entity'
              ? valid.entities.some((e) => e.id === r.entityId)
              : r.kind === 'projectionAxis'
                ? valid.auxiliarySystems?.some((a) => a.id === r.systemId)
                : r.kind === 'origin'
                  ? valid.views.some((v) => v.id === r.frameId)
                  : true;
          }),
        );
        report('已保存到当前文档');
      } catch (e) {
        report((e as Error).message);
      }
    };
    const replace = (next: GeometryDocument) => {
      try {
        update(history.current.replaceCurrent(validate(next)));
      } catch (e) {
        report((e as Error).message);
      }
    };
    const undo = () => update(history.current.undo()),
      redo = () => update(history.current.redo());
    const fit = () => {
      setZoom(1);
      setFitKey((k) => k + 1);
    };
    useImperativeHandle(ref, () => ({
      getDocument: () => doc,
      exportJSON: () => serializeGeometryDocument(doc),
      exportNarrative: () => exportGeometryNarrative(doc),
      undo,
      redo,
      fitToContent: fit,
    }));
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
          selected.some(
            (id) => !targetCapabilities(doc, targetFromKey(id), role, readOnly).deletable,
          )
        )
          throw Error('选择含只读或有依赖对象，不能删除');
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
    const copySelection = () =>
      perform(() =>
        copyEntities(
          doc,
          selected.filter((id) => targetFromKey(id).kind === 'entity'),
          role,
        ),
      );
    const activeView = doc.views.some((v) => v.id === session.active)
      ? session.active
      : doc.views[0].id;
    const runCommand = (id: CommandId) => {
      const entry = commandRegistry.find((e) => e.id === id);
      if (!entry) return;
      const reason = commandUnavailable(entry, readOnly, doc.editorType);
      if (reason) {
        report(reason);
        return;
      }
      if (entry.kind === 'tool') {
        dispatch({ type: 'tool', tool: id as typeof tool });
        if (id === 'projection') select([]);
        report(
          entry.name +
            (id === 'box'
              ? '：点击或拖动两个对角点'
              : id === 'circle'
                ? '：选择圆心，再选择圆周点'
                : id === 'arc'
                  ? '：选择圆心、起点、终点'
                  : ''),
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
    const output = (kind: 'json' | 'narrative' | 'svg') => {
      const text =
        kind === 'json'
          ? serializeGeometryDocument(doc)
          : kind === 'svg'
            ? exportSheetSvg(doc)
            : exportGeometryNarrative(doc);
      setExported(text);
      onExport?.(text, kind);
      const url = URL.createObjectURL(
          new Blob([text], {
            type:
              kind === 'svg'
                ? 'image/svg+xml'
                : kind === 'json'
                  ? 'application/json'
                  : 'text/plain',
          }),
        ),
        a = document.createElement('a');
      a.href = url;
      a.download = `tuheng.${kind === 'narrative' ? 'txt' : kind}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    const checkbox = (
      key:
        | 'snapping'
        | 'gridSnap'
        | 'projectionSnap'
        | 'axesSnap'
        | 'referenceFilter'
        | 'grid'
        | 'axes'
        | 'labels',
      label: string,
    ) => (
      <label key={key}>
        <input
          type="checkbox"
          checked={settings[key]}
          onChange={(e) => setSettings((s) => ({ ...s, [key]: e.target.checked }))}
        />
        {label}
      </label>
    );
    if (!parsed.success)
      return (
        <div role="alert">
          几何文档加载失败。
          {parsed.error.issues
            .slice(0, 3)
            .map((i) => i.message)
            .join('；')}
        </div>
      );
    const linked = doc.projectionGroups
      .filter((g) => g.entityIds.some((id) => selected.includes(id)))
      .flatMap((g) => g.entityIds);
    return (
      <div
        ref={root}
        className={`geometry-editor ${expanded ? 'geo-expanded' : ''}`}
        tabIndex={0}
        aria-label={`${editorRegistry[doc.editorType].name}编辑器`}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing || textEntry(e.target) || e.defaultPrevented) return;
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            if (e.shiftKey) redo();
            else undo();
          }
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
            e.preventDefault();
            redo();
          }
          if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            deleteSelection();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            if (panel) dispatch({ type: 'patch', patch: { panel: null } });
            else if (session.construction)
              dispatch({ type: 'patch', patch: { construction: null } });
            else if (selected.length) select([]);
            else dispatch({ type: 'tool', tool: 'select' });
          }
        }}
      >
        <div className="geo-heading">
          <strong>{editorRegistry[doc.editorType].name}</strong>
          <label>
            框架{' '}
            <select
              aria-label="当前作图框架"
              value={activeView}
              onChange={(e) => dispatch({ type: 'patch', patch: { active: e.target.value } })}
            >
              {doc.views.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={fit}>
            完整展开图
          </button>
          <button
            type="button"
            onClick={() => dispatch({ type: 'patch', patch: { expanded: !expanded } })}
          >
            {expanded ? '退出展开' : '展开编辑'}
          </button>
        </div>
        <EditorToolbar>
          <div className="geo-tool-scroll">
            <ToolPicker
              editorType={doc.editorType}
              tool={tool}
              run={runCommand}
              readOnly={readOnly}
              compact={compact}
            />
          </div>
          <button type="button" disabled={readOnly || !history.current.canUndo} onClick={undo}>
            撤销
          </button>
          <button type="button" disabled={readOnly || !history.current.canRedo} onClick={redo}>
            恢复
          </button>
          {compact ? (
            <EditorPopover label="更多">
              {/* Shared settings and file commands */}{' '}
              <button
                type="button"
                aria-pressed={settings.snapping}
                aria-label="吸附开关"
                onClick={() => setSettings((s) => ({ ...s, snapping: !s.snapping }))}
              >
                吸附
              </button>
              <button
                type="button"
                onClick={() =>
                  dispatch({
                    type: 'patch',
                    patch: { panel: panel === 'settings' ? null : 'settings' },
                  })
                }
                aria-label="视图/设置"
              >
                视图/设置
              </button>
              <button
                type="button"
                disabled={readOnly}
                onClick={() =>
                  root.current?.querySelector<HTMLInputElement>('.geo-file-input')?.click()
                }
              >
                导入 JSON
              </button>
              <button type="button" onClick={() => output('json')}>
                导出 JSON
              </button>
              <button type="button" onClick={() => output('narrative')}>
                导出关系描述
              </button>
              <button type="button" onClick={() => output('svg')}>
                导出展开图 SVG
              </button>
              <button
                type="button"
                onClick={() => dispatch({ type: 'patch', patch: { panel: 'file' } })}
              >
                查看文档
              </button>
            </EditorPopover>
          ) : (
            <>
              {' '}
              <button
                type="button"
                aria-pressed={settings.snapping}
                aria-label="吸附开关"
                onClick={() => setSettings((s) => ({ ...s, snapping: !s.snapping }))}
              >
                吸附
              </button>
              <button
                type="button"
                onClick={() =>
                  dispatch({
                    type: 'patch',
                    patch: { panel: panel === 'settings' ? null : 'settings' },
                  })
                }
                aria-label="视图/设置"
              >
                视图/设置
              </button>
              <EditorPopover label="文件">
                <button
                  type="button"
                  disabled={readOnly}
                  onClick={() =>
                    root.current?.querySelector<HTMLInputElement>('.geo-file-input')?.click()
                  }
                >
                  导入 JSON
                </button>
                <button type="button" onClick={() => output('json')}>
                  导出 JSON
                </button>
                <button type="button" onClick={() => output('narrative')}>
                  导出关系描述
                </button>
                <button type="button" onClick={() => output('svg')}>
                  导出展开图 SVG
                </button>
                <button
                  type="button"
                  onClick={() => dispatch({ type: 'patch', patch: { panel: 'file' } })}
                >
                  查看文档
                </button>
              </EditorPopover>
            </>
          )}
          <input
            className="geo-file-input"
            tabIndex={-1}
            aria-label="加载几何 JSON"
            type="file"
            accept=".json,application/json"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file || readOnly) return;
              try {
                if (file.size > 2_000_000) throw Error('文档超过 2MB');
                const text = await file.text(),
                  input = JSON.parse(text);
                const next =
                  input?.schemaVersion === 'tuheng.stroke/1.0.0'
                    ? importPenStroke(doc, input, activeView, role)
                    : loadGeometryDocument(text);
                commit(upgradeGeometryDocument(next));
                select([]);
                fit();
              } catch (error) {
                report(`加载失败，${(error as Error).message}`);
              }
              e.target.value = '';
            }}
          />
        </EditorToolbar>
        <div className="geo-views">
          <Viewport
            document={doc}
            revision={revision}
            viewId={activeView}
            active
            activate={() => {}}
            focusKey={focusKey}
            replace={replace}
            role={role}
            readOnly={readOnly}
            tool={tool}
            selected={selected}
            select={select}
            commit={commit}
            report={report}
            {...settings}
            skipSnap={skipSnap}
            consumeSnap={() => setSkipSnap(false)}
            ruler={ruler}
            onRulerChange={setRuler}
            zoom={zoom}
            highlighted={[...highlightedEntityIds, ...linked]}
            fitKey={fitKey}
            session={session}
            dispatch={dispatch}
            runCommand={runCommand}
            deleteSelection={deleteSelection}
            copySelection={copySelection}
          />
        </div>
        <div className="geo-status" role="status">
          {message} · {doc.entities.length} 个对象 · mm
        </div>
        {(panel === 'settings' || panel === 'file') && (
          <aside
            className="geo-panel"
            role="dialog"
            aria-label={panel === 'settings' ? '视图与设置' : '文档与文件'}
          >
            <div className="geo-card-heading">
              <strong>{panel === 'settings' ? '视图与设置' : '文档与文件'}</strong>
              <button
                type="button"
                onClick={() => dispatch({ type: 'patch', patch: { panel: null } })}
              >
                关闭面板
              </button>
            </div>
            {panel === 'settings' ? (
              <>
                <div className="geo-context-actions">
                  <button type="button" onClick={() => setZoom((z) => Math.min(8, z * 1.25))}>
                    放大
                  </button>
                  <button type="button" onClick={() => setZoom((z) => Math.max(0.25, z / 1.25))}>
                    缩小
                  </button>
                  <button type="button" onClick={fit}>
                    适应画布
                  </button>
                  <button type="button" onClick={() => setFocusKey((k) => k + 1)}>
                    聚焦当前投影
                  </button>
                </div>
                {checkbox('snapping', '吸附')}
                {checkbox('axesSnap', '参考轴吸附')}
                {checkbox('gridSnap', '网格吸附')}
                {checkbox('projectionSnap', '投影对齐吸附')}
                {checkbox('grid', '显示网格')}
                {checkbox('axes', '显示坐标轴')}
                {checkbox('labels', '点名称')}
                {checkbox('referenceFilter', '框选包含参考轴')}
                <p>显示与吸附单独设置；隐藏的轴不参与吸附。坐标与角度按当前局部框架记录。</p>
                {doc.layers.map((layer) => (
                  <label key={layer.id}>
                    <input
                      type="checkbox"
                      checked={!settings.hiddenLayers.includes(layer.id)}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          hiddenLayers: e.target.checked
                            ? s.hiddenLayers.filter((id) => id !== layer.id)
                            : [...s.hiddenLayers, layer.id],
                        }))
                      }
                    />
                    {
                      {
                        PROBLEM_STEM: '题干图层',
                        STUDENT_ANSWER: '答案图层',
                        CONSTRUCTION: '辅助图层',
                      }[layer.role]
                    }
                  </label>
                ))}
                <button type="button" aria-pressed={skipSnap} onClick={() => setSkipSnap(true)}>
                  下一次不吸附
                </button>
                <RulerControls
                  ruler={ruler}
                  setRuler={setRuler}
                  fingerDraw={settings.fingerDraw}
                  setFingerDraw={(fingerDraw) => setSettings((s) => ({ ...s, fingerDraw }))}
                />
                {!readOnly && !orthographic(doc) && (
                  <>
                    <PlaneCreator
                      document={doc}
                      viewId={activeView}
                      role={role}
                      commit={commit}
                      report={report}
                    />
                    <RelatedPlaneTools document={doc} role={role} commit={commit} report={report} />
                    {(role === 'teacher' ||
                      (!problemDocument &&
                        !doc.entities.some((e) => e.lineStyle.startsWith('PROBLEM')))) && (
                      <ProjectionSettings document={doc} perform={perform} />
                    )}
                  </>
                )}
              </>
            ) : (
              <>
                <button
                  type="button"
                  disabled={readOnly}
                  onClick={() =>
                    root.current?.querySelector<HTMLInputElement>('.geo-file-input')?.click()
                  }
                >
                  加载 JSON
                </button>
                <pre className="geo-export">{exported || serializeGeometryDocument(doc)}</pre>
              </>
            )}
          </aside>
        )}
      </div>
    );
  },
);
