'use client';
import { forwardRef, useImperativeHandle, useMemo, useRef, useState, useEffect } from 'react';
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
} from '@tuheng/geometry-core';
import { Viewport } from './Viewport';
import { ConnectionTools } from './ConnectionTools';
import { ToolPicker } from './ToolPicker';
import { Inspector, PlaneCreator } from './Inspector';
import { RelatedPlaneTools } from './PlaneTools';
import type { Ruler, Tool } from './types';
import './styles.css';
import { RulerControls } from './RulerControls';
import { ProjectionSettings } from './ProjectionSettings';
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
    const parsed = useMemo(
      () =>
        GeometryDocument.safeParse(
          (() => {
            try {
              return upgradeGeometryDocument(input);
            } catch {
              return input;
            }
          })(),
        ),
      [input],
    );
    const doc = parsed.success ? parsed.data : createDocument(editorType);
    const narrative = useMemo(
      () => (parsed.success ? exportGeometryNarrative(parsed.data) : ''),
      [parsed],
    );
    const history = useRef<DocumentHistory | null>(null);
    if (!history.current) history.current = new DocumentHistory(doc);
    const [tool, setTool] = useState<Tool>('select'),
      [selected, select] = useState<string[]>([]),
      [message, report] = useState('选择工具开始作图'),
      [active, setActive] = useState(doc.views[0].id),
      [snapping, setSnapping] = useState(true),
      [gridSnap, setGridSnap] = useState(false),
      [projectionSnap, setProjectionSnap] = useState(false),
      [focusKey, setFocusKey] = useState(0),
      [skipSnap, setSkipSnap] = useState(false),
      [fingerDraw, setFingerDraw] = useState(false),
      [hiddenLayers, setHiddenLayers] = useState<string[]>([]),
      [grid, setGrid] = useState(true),
      [axes, setAxes] = useState(true),
      [labels, setLabels] = useState(doc.settings.labels),
      [zoom, setZoom] = useState(1),
      [fitKey, setFitKey] = useState(0),
      [expanded, setExpanded] = useState(false),
      [exported, setExported] = useState(''),
      [ruler, setRuler] = useState<Ruler>({
        visible: false,
        origin: { x: 5, y: 5 },
        angle: 0,
        length: 60,
      });
    const root = useRef<HTMLDivElement>(null);
    useEffect(() => {
      if (JSON.stringify(history.current!.current) !== JSON.stringify(doc)) {
        history.current = new DocumentHistory(doc);
      }
    }, [doc]);
    const update = (next: GeometryDocument) => {
      if (readOnly) return;
      setInternal(next);
      onChange?.(next);
    };
    const commit = (next: GeometryDocument) => {
      if (readOnly) return;
      try {
        if (role === 'student') {
          const stem = doc.entities.filter(
            (e) => doc.layers.find((l) => l.id === e.layerId)?.role === 'PROBLEM_STEM',
          );
          const stemIds = new Set(stem.map((e) => e.id));
          if (problemDocument || stem.length)
            next = combineAnswer(
              problemDocument ?? {
                ...doc,
                entities: stem,
                constraints: doc.constraints.filter((r) =>
                  r.entityIds.every((id) => stemIds.has(id)),
                ),
                projectionGroups: doc.projectionGroups.filter((r) =>
                  r.entityIds.every((id) => stemIds.has(id)),
                ),
              },
              next,
            );
        }
        history.current!.current = doc;
        update(history.current!.commit(next));
        report('文档已更新');
      } catch (error) {
        report((error as Error).message);
      }
    };
    const undo = () => update(history.current!.undo()),
      redo = () => update(history.current!.redo());
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
    const perform = (operation: () => GeometryDocument) => {
      try {
        commit(operation());
      } catch (error) {
        report((error as Error).message);
      }
    };
    const output = (kind: 'json' | 'narrative' | 'svg') => {
      let text = kind === 'json' ? serializeGeometryDocument(doc) : exportGeometryNarrative(doc);
      if (kind === 'svg') text = exportSheetSvg(doc);
      setExported(text);
      onExport?.(text, kind);
      const url = URL.createObjectURL(
        new Blob([text], {
          type:
            kind === 'svg' ? 'image/svg+xml' : kind === 'json' ? 'application/json' : 'text/plain',
        }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = `tuheng.${kind === 'narrative' ? 'txt' : kind}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
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
    const activeView = doc.views.some((v) => v.id === active) ? active : doc.views[0].id;
    return (
      <div
        ref={root}
        className={`geometry-editor ${expanded ? 'geo-expanded' : ''}`}
        onKeyDown={(e) => {
          if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) return;
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
            perform(() => deleteEntities(doc, selected, role));
          }
          if (e.key === 'Escape') {
            select([]);
            setTool('select');
          }
        }}
        tabIndex={0}
        aria-label={`${editorRegistry[doc.editorType].name}编辑器`}
      >
        <div className="geo-heading">
          <strong>{editorRegistry[doc.editorType].name}</strong>
          <span>mm</span>
          <button type="button" onClick={() => setExpanded((v) => !v)}>
            {expanded ? '退出展开' : '展开编辑'}
          </button>
        </div>
        {!readOnly && <ToolPicker tool={tool} setTool={setTool} select={select} report={report} />}
        <div className="geo-toolbar">
          {!readOnly && (
            <>
              <button type="button" onClick={undo}>
                撤销
              </button>
              <button type="button" onClick={redo}>
                恢复
              </button>
              <button
                type="button"
                disabled={!selected.length}
                onClick={() => perform(() => deleteEntities(doc, selected, role))}
              >
                删除
              </button>
              <button
                type="button"
                disabled={!selected.length}
                onClick={() => perform(() => copyEntities(doc, selected, role))}
              >
                复制
              </button>
              <label>
                <input
                  type="checkbox"
                  checked={snapping}
                  onChange={(e) => setSnapping(e.target.checked)}
                />
                吸附
              </label>
              <button type="button" aria-pressed={skipSnap} onClick={() => setSkipSnap(true)}>
                下一次不吸附
              </button>
            </>
          )}
          <button type="button" onClick={() => setZoom((z) => Math.min(8, z * 1.25))}>
            放大
          </button>
          <button type="button" onClick={() => setZoom((z) => Math.max(0.25, z / 1.25))}>
            缩小
          </button>
          <button type="button" onClick={fit}>
            适应画布
          </button>
          <label>
            <input type="checkbox" checked={grid} onChange={(e) => setGrid(e.target.checked)} />
            网格
          </label>
          <label>
            <input type="checkbox" checked={axes} onChange={(e) => setAxes(e.target.checked)} />
            坐标轴
          </label>
          <label>
            <input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} />
            点名称
          </label>
        </div>
        {tool === 'pen' && (
          <RulerControls
            ruler={ruler}
            setRuler={setRuler}
            fingerDraw={fingerDraw}
            setFingerDraw={setFingerDraw}
          />
        )}
        <div className="geo-toolbar">
          {doc.layers.map((layer) => (
            <label key={layer.id}>
              <input
                type="checkbox"
                checked={!hiddenLayers.includes(layer.id)}
                onChange={(event) =>
                  setHiddenLayers(
                    event.target.checked
                      ? hiddenLayers.filter((id) => id !== layer.id)
                      : [...hiddenLayers, layer.id],
                  )
                }
              />
              {
                { PROBLEM_STEM: '题干图层', STUDENT_ANSWER: '答案图层', CONSTRUCTION: '辅助图层' }[
                  layer.role
                ]
              }
            </label>
          ))}
        </div>
        <div className="geo-tabs">
          <button type="button" onClick={fit}>
            完整展开图
          </button>
          {doc.views.map((v) => (
            <button
              type="button"
              key={v.id}
              aria-pressed={activeView === v.id}
              onClick={() => setActive(v.id)}
            >
              {v.name}
            </button>
          ))}
        </div>
        <div className="geo-toolbar">
          <button type="button" onClick={() => setFocusKey((k) => k + 1)}>
            聚焦当前投影
          </button>
          <label>
            <input
              type="checkbox"
              checked={gridSnap}
              onChange={(e) => setGridSnap(e.target.checked)}
            />
            网格吸附
          </label>
          {orthographic(doc) && (
            <label>
              <input
                type="checkbox"
                checked={projectionSnap}
                onChange={(e) => setProjectionSnap(e.target.checked)}
              />
              投影对齐吸附
            </label>
          )}
        </div>
        <div className="geo-views">
          <Viewport
            document={doc}
            viewId={activeView}
            active={true}
            activate={() => {}}
            focusKey={focusKey}
            gridSnap={gridSnap}
            projectionSnap={projectionSnap}
            replace={(next) => update(history.current!.replaceCurrent(next))}
            role={role}
            readOnly={readOnly}
            tool={tool}
            selected={selected}
            select={select}
            commit={commit}
            report={report}
            snapping={snapping}
            skipSnap={skipSnap}
            consumeSnap={() => setSkipSnap(false)}
            fingerDraw={fingerDraw}
            ruler={ruler}
            onRulerChange={setRuler}
            labels={labels}
            grid={grid}
            axes={axes}
            zoom={zoom}
            highlighted={[...highlightedEntityIds, ...linked]}
            hiddenLayers={hiddenLayers}
            fitKey={fitKey}
          />
        </div>
        <p className="geo-status" role="status">
          {message} · {doc.entities.length} 个对象
        </p>
        {!readOnly && (
          <ConnectionTools
            doc={doc}
            selected={selected}
            role={role}
            commit={commit}
            report={report}
          />
        )}
        <Inspector
          document={doc}
          selected={selected}
          role={role}
          readOnly={readOnly}
          commit={commit}
          report={report}
        />
        {!readOnly && !orthographic(doc) && (
          <PlaneCreator
            document={doc}
            viewId={activeView}
            role={role}
            commit={commit}
            report={report}
          />
        )}
        {!readOnly && !orthographic(doc) && (
          <RelatedPlaneTools document={doc} role={role} commit={commit} report={report} />
        )}
        {!readOnly &&
          !orthographic(doc) &&
          (role === 'teacher' ||
            (!problemDocument &&
              !doc.entities.some(
                (e) => doc.layers.find((l) => l.id === e.layerId)?.role === 'PROBLEM_STEM',
              ))) && <ProjectionSettings document={doc} perform={perform} />}
        <div className="geo-toolbar">
          <button type="button" onClick={() => output('json')}>
            导出 JSON
          </button>
          <button type="button" onClick={() => output('narrative')}>
            导出关系描述
          </button>
          <button type="button" onClick={() => output('svg')}>
            导出展开图 SVG
          </button>
          {!readOnly && (
            <label>
              加载 JSON
              <input
                aria-label="加载几何 JSON"
                type="file"
                accept=".json,application/json"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    if (file.size > 2_000_000) throw new Error('文档超过 2MB');
                    const text = await file.text();
                    const input = JSON.parse(text);
                    const next =
                      input?.schemaVersion === 'tuheng.stroke/1.0.0'
                        ? importPenStroke(doc, input, activeView, role)
                        : loadGeometryDocument(text);
                    commit(upgradeGeometryDocument(next));
                    fit();
                  } catch (error) {
                    report(`加载失败，${(error as Error).message}`);
                  }
                  e.target.value = '';
                }}
              />
            </label>
          )}
        </div>
        <details>
          <summary>查看 JSON 与几何关系</summary>
          <pre className="geo-export">{exported || narrative}</pre>
        </details>
      </div>
    );
  },
);
