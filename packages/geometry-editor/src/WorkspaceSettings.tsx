import type { Dispatch, SetStateAction } from 'react';
import type { GeometryDocument } from '@tuheng/contracts';
import { orthographic, type DocumentHistory } from '@tuheng/geometry-core';
import { PlaneCreator } from './PlaneCreator';
import { RelatedPlaneTools } from './PlaneTools';
import { ProjectionSettings } from './ProjectionSettings';
import { RulerControls } from './RulerControls';
import { ObjectSnapChoices, objectSnaps } from './CadPreferences';
import { entityNames } from './PropertyFields';
import type { Ruler } from './types';
export function initialSettings(doc: GeometryDocument) {
  return {
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
    objectSnap: true,
    objectTypes: objectSnaps.map((s) => s.id),
    direction: true,
    tracking: false,
    ortho: false,
    selectionMode: 'replace' as 'replace' | 'add' | 'remove',
    typeFilter: '',
    touchOffset: false,
    theme: 'dark' as 'light' | 'dark',
    inputLayout: 'auto',
  };
}
interface SettingsProps {
  settings: ReturnType<typeof initialSettings>;
  setSettings: Dispatch<SetStateAction<ReturnType<typeof initialSettings>>>;
  doc: GeometryDocument;
  history: Pick<DocumentHistory, 'operations'>;
  setZoom: Dispatch<SetStateAction<number>>;
  fit: () => void;
  setFocusKey: Dispatch<SetStateAction<number>>;
  skipSnap: boolean;
  setSkipSnap: (v: boolean) => void;
  ruler: Ruler;
  setRuler: Dispatch<SetStateAction<Ruler>>;
  readOnly: boolean;
  role: 'student' | 'teacher';
  commit: (d: GeometryDocument) => void;
  report: (s: string) => void;
  perform: (fn: () => GeometryDocument) => void;
  problemDocument?: GeometryDocument;
  activeView: string;
}
export function WorkspaceSettings({
  doc,
  settings,
  setSettings,
  history,
  setZoom,
  fit,
  setFocusKey,
  skipSnap,
  setSkipSnap,
  ruler,
  setRuler,
  readOnly,
  role,
  commit,
  report,
  perform,
  problemDocument,
  activeView,
}: SettingsProps) {
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

  return (
    <>
      {' '}
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
      {checkbox('snapping', '启用作图吸附')}
      {checkbox('axesSnap', '参考轴吸附')}
      {checkbox('gridSnap', '网格吸附')}
      {checkbox('projectionSnap', '投影对齐吸附')}
      {checkbox('grid', '显示网格')}
      {checkbox('axes', '显示坐标轴')}
      {checkbox('labels', '点名称')}
      {checkbox('referenceFilter', '框选包含参考轴')}
      <details className="cad-settings">
        <summary>捕捉类型与追踪</summary>
        {(['objectSnap', 'direction', 'tracking', 'ortho', 'touchOffset'] as const).map(
          (key, i) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={settings[key]}
                onChange={(e) => setSettings((s) => ({ ...s, [key]: e.target.checked }))}
              />
              {['对象捕捉', '方向追踪', '对象捕捉追踪', '正交绘图', '手指使用偏移十字光标'][i]}
            </label>
          ),
        )}
        <ObjectSnapChoices
          selected={settings.objectTypes}
          change={(objectTypes) => setSettings((s) => ({ ...s, objectTypes }))}
        />
      </details>
      <label>
        选择模式
        <select
          value={settings.selectionMode}
          onChange={(e) =>
            setSettings((s) => ({
              ...s,
              selectionMode: e.target.value as typeof s.selectionMode,
            }))
          }
        >
          <option value="replace">替换选集</option>
          <option value="add">加选</option>
          <option value="remove">减选</option>
        </select>
      </label>
      <label>
        选择类型
        <select
          value={settings.typeFilter}
          onChange={(e) => setSettings((s) => ({ ...s, typeFilter: e.target.value }))}
        >
          <option value="">全部对象</option>
          {Array.from(new Set(doc.entities.map((e) => e.kind))).map((kind) => (
            <option key={kind} value={kind}>
              {entityNames[kind]}
            </option>
          ))}
        </select>
      </label>
      <label>
        画布主题
        <select
          value={settings.theme}
          onChange={(e) =>
            setSettings((s) => ({ ...s, theme: e.target.value === 'light' ? 'light' : 'dark' }))
          }
        >
          <option value="light">明亮</option>
          <option value="dark">深色</option>
        </select>
      </label>
      <label>
        操作布局
        <select
          value={settings.inputLayout}
          onChange={(e) => setSettings((s) => ({ ...s, inputLayout: e.target.value }))}
        >
          <option value="auto">跟随输入设备</option>
          <option value="touch">触屏与电子笔</option>
          <option value="mouse">鼠标与键盘</option>
        </select>
      </label>
      <details className="cad-settings">
        <summary>撤销历史（{history.operations.length}）</summary>
        <ol>
          {history.operations.map((op, i) => (
            <li key={i}>
              {op.label} · {op.applied ? '已应用' : '已撤销'}
            </li>
          ))}
        </ol>
      </details>
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
            (!problemDocument && !doc.entities.some((e) => e.lineStyle.startsWith('PROBLEM')))) && (
            <ProjectionSettings document={doc} perform={perform} />
          )}
        </>
      )}
    </>
  );
}
