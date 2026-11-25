'use client';
import { useState } from 'react';
import type { GeometryDocument } from '@tuheng/contracts';
import { isCadEntity } from '@tuheng/contracts';
import { CadFields } from './CadFields';
import {
  availableLineStyles,
  propertyValues,
  applyProperties,
  editable,
  angle,
  formatCadAngle,
  length,
  lineGeometry,
  unbindReferences,
  bindToReference,
} from '@tuheng/geometry-core';
export const styleLabels = {
  ANSWER_VISIBLE: '答案实线',
  ANSWER_HIDDEN: '答案虚线',
  CONSTRUCTION: '辅助线',
  PROBLEM_VISIBLE: '题干实线',
  PROBLEM_HIDDEN: '题干虚线',
};
export const entityNames = {
  point: '点',
  segment: '线段',
  line: '无限辅助线',
  circle: '圆',
  arc: '圆弧',
  polyline: '笔迹',
  curve: '插值曲线',
  plane: '历史空间平面',
  ellipse: '椭圆',
  text: '文字',
  symbol: '方向符号',
  dimension: '尺寸标注',
  engineeringAnnotation: '工程标注',
  hatch: '剖面线',
};
export function PropertyFields({
  document: doc,
  selected,
  role,
  readOnly,
  commit,
  report,
}: {
  document: GeometryDocument;
  selected: string[];
  role: 'teacher' | 'student';
  readOnly: boolean;
  commit: (d: GeometryDocument) => void;
  report: (s: string) => void;
}) {
  const e = doc.entities.find((e) => e.id === selected[0]);
  const [values, setValues] = useState<Record<string, string>>(() =>
      e ? propertyValues(doc, e) : {},
    ),
    [error, setError] = useState('');
  const signature = JSON.stringify([e?.id, e ? propertyValues(doc, e) : {}]);
  const [base, setBase] = useState(signature);
  if (base !== signature) {
    setBase(signature);
    setValues(e ? propertyValues(doc, e) : {});
    setError('');
  }
  if (!e) return null;
  const styles = availableLineStyles(doc, [e.id], role);
  const locked = readOnly || !editable(doc, e, role);
  const reset = () => {
    setValues(propertyValues(doc, e));
    setError('');
  };
  const run = (op: () => GeometryDocument) => {
    try {
      commit(op());
      setError('');
    } catch (err) {
      const s = (err as Error).message;
      setError(s);
      report(s);
    }
  };
  const field = (key: string, label: string) => (
    <label key={key}>
      {label}
      <input
        aria-label={label}
        type="text"
        inputMode={['name', 'content', 'textOverride', 'label', 'toleranceCode', 'method'].includes(key) ? 'text' : 'decimal'}
        value={values[key] ?? ''}
        disabled={locked}
        onChange={(event) => setValues((v) => ({ ...v, [key]: event.target.value }))}
      />
    </label>
  );
  const bindings =
    doc.referenceRelations?.filter((r) => r.targetId === e.id && r.mode === 'BINDING') ?? [];
  const placement = doc.referenceRelations
    ?.filter((r) => r.targetId === e.id && r.kind === 'POINT_ON_REFERENCE' && r.mode === 'POSITION')
    .at(-1);
  return (
    <div
      className="geo-property-form"
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
          event.preventDefault();
          event.stopPropagation();
          run(() => applyProperties(doc, e.id, values, role));
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          reset();
          (event.target as HTMLElement).blur();
        }
      }}
    >
      <p className="geo-property-summary">
        {entityNames[e.kind]} · {doc.views.find((v) => v.id === e.viewId)?.name}
        {locked ? ' · 只读' : ''}
        {bindings.length ? ' · 已绑定' : ''}
      </p>
      {e.kind === 'curve' && <p>依次经过 {e.pointIds.length} 个点；拖动经过点可调整曲线。</p>}
      <div className="geo-fields">
        {isCadEntity(e) && (
          <CadFields
            doc={doc}
            e={e}
            field={field}
            values={values}
            locked={locked}
            change={(key, value) => setValues((v) => ({ ...v, [key]: value }))}
          />
        )}
        {e.kind === 'point' && (
          <>
            {field('name', '点名称')}
            {field('u', '局部 u (mm)')}
            {field('v', '局部 v (mm)')}
          </>
        )}
        {e.kind === 'segment' && (
          <>
            {field('length', '长度 (mm)')}
            {field('angle', '局部角度 (°)')}
            <label>
              固定端
              <select
                aria-label="固定端"
                value={values.fixed ?? 'start'}
                disabled={locked}
                onChange={(event) => setValues((v) => ({ ...v, fixed: event.target.value }))}
              >
                <option value="start">固定起点</option>
                <option value="end">固定终点</option>
                <option value="midpoint">固定中点</option>
              </select>
            </label>
          </>
        )}
        {e.kind === 'line' && (
          <>
            {field('angle', '局部角度 (°)')}
            {field('u', '锚点 u (mm)')}
            {field('v', '锚点 v (mm)')}
          </>
        )}
        {(e.kind === 'circle' || e.kind === 'arc') && <>{field('radius', '半径 (mm)')}</>}
        {e.kind === 'arc' && (
          <>
            {field('startAngle', '起始角 (°)')}
            {field('sweep', '有向扫角 (°)')}
            <span>
              弧长 {(((Math.abs(e.sweep) * Math.PI) / 180) * e.radius).toFixed(2)} mm ·{' '}
              {e.sweep > 0 ? '逆时针' : '顺时针'}
            </span>
            <button
              type="button"
              disabled={locked}
              onClick={() =>
                setValues((v) => ({
                  ...v,
                  sweep: String(
                    Math.abs(Number(v.sweep)) === 360
                      ? -Number(v.sweep)
                      : Number(v.sweep) > 0
                        ? Number(v.sweep) - 360
                        : Number(v.sweep) + 360,
                  ),
                }))
              }
            >
              切换弧方向
            </button>
          </>
        )}
        <label>
          线型
          <select
            aria-label="线型"
            value={values.style ?? e.lineStyle}
            disabled={locked || !styles.length}
            onChange={(event) => setValues((v) => ({ ...v, style: event.target.value }))}
          >
            {styles.map((style) => (
              <option key={style} value={style}>
                {styleLabels[style]}
              </option>
            ))}
            {!styles.includes(e.lineStyle) && (
              <option value={e.lineStyle}>{styleLabels[e.lineStyle]}</option>
            )}
          </select>
        </label>
      </div>
      {(e.kind === 'circle' || e.kind === 'arc' || e.kind === 'segment') && (
        <details>
          <summary>更多属性</summary>
          <div className="geo-fields">
            {e.kind === 'segment' ? (
              <>
                <span>
                  起点 u / v　{lineGeometry(doc, e).a.x.toFixed(2)} /{' '}
                  {lineGeometry(doc, e).a.y.toFixed(2)} mm
                </span>
                <span>
                  终点 u / v　{(lineGeometry(doc, e).a.x + lineGeometry(doc, e).d.x).toFixed(2)} /{' '}
                  {(lineGeometry(doc, e).a.y + lineGeometry(doc, e).d.y).toFixed(2)} mm
                </span>
              </>
            ) : (
              <>
                {field('u', '圆心 u (mm)')}
                {field('v', '圆心 v (mm)')}
                <span>直径 {(e.radius * 2).toFixed(2)} mm</span>
              </>
            )}
          </div>
        </details>
      )}
      {error && <p role="alert">{error}</p>}
      {!locked && (
        <div className="geo-form-actions">
          <button type="button" onClick={() => run(() => applyProperties(doc, e.id, values, role))}>
            确认属性
          </button>
          <button type="button" onClick={reset}>
            取消输入
          </button>
        </div>
      )}
      {!locked && bindings.length > 0 && (
        <button type="button" onClick={() => run(() => unbindReferences(doc, e.id, role))}>
          解除绑定
        </button>
      )}
      {!locked && e.kind === 'point' && placement && !bindings.length && (
        <button
          type="button"
          onClick={() => run(() => bindToReference(doc, e.id, placement.reference, role))}
        >
          保持贴轴
        </button>
      )}
      <details>
        <summary>高级详情</summary>
        <code>{e.id}</code>
        {e.kind === 'segment' && (
          <p>
            当前局部方向 {formatCadAngle(angle(lineGeometry(doc, e).d), 2)}°，长度{' '}
            {length(lineGeometry(doc, e).d).toFixed(3)} mm
          </p>
        )}
      </details>
    </div>
  );
}
