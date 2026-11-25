import type { CadEntity, GeometryDocument } from '@tuheng/contracts';
import { dimensionValue, roughnessAccessories, roughnessExtents, roughnessTextures } from '@tuheng/geometry-core';
import { ToleranceRows } from './ToleranceRows';
import type { ReactNode } from 'react';

export function CadFields({
  doc,
  e,
  field,
  values,
  change,
  locked,
}: {
  doc: GeometryDocument;
  e: CadEntity;
  field: (key: string, label: string) => ReactNode;
  values: Record<string, string>;
  change: (key: string, value: string) => void;
  locked: boolean;
}) {
  const select = (key: string, label: string, options: readonly (readonly [string, string])[]) => (
    <label>
      {label}
      <select
        aria-label={label}
        value={values[key] ?? options[0][0]}
        disabled={locked}
        onChange={(ev) => change(key, ev.target.value)}
      >
        {options.map(([value, title]) => (
          <option key={value} value={value}>
            {title}
          </option>
        ))}
      </select>
    </label>
  );
  const position = (
    <details>
      <summary>位置</summary>
      {field('u', '局部 u (mm)')}
      {field('v', '局部 v (mm)')}
    </details>
  );
  if (e.kind === 'ellipse')
    return (
      <>
        {field('majorRadius', '长半轴 (mm)')}
        {field('minorRadius', '短半轴 (mm)')}
        {field('angle', '轴方向 (°)')}
        <details>
          <summary>椭圆弧区间</summary>
          {field('startAngle', '起始参数角 (°)')}
          {field('sweep', '参数扫角 (°)')}
        </details>
      </>
    );
  if (e.kind === 'hatch')
    return (
      <>
        {field('spacing', '剖面间距 (mm)')}
        {field('angle', '剖面方向 (°)')}
        {position}
      </>
    );
  if (e.kind === 'dimension') {
    let measured = '已失效';
    try { measured=dimensionValue(doc,e).toFixed(e.precision)+(e.dimensionType==='ANGULAR'?'°':' mm'); } catch {}
    return (
      <>
        <span>
          实际测量 {measured}
        </span>
        {field('textOverride', '覆盖文字（可留空）')}
        {e.dimensionType === 'LINEAR' && field('linearAngle', '线性测量方向 (°)')}
        <details>
          <summary>尺寸公差</summary>
          {field('toleranceCode','公差代号')}
          {field('toleranceUpper','上偏差')}
          {field('toleranceLower','下偏差')}
          <label><input type="checkbox" disabled={locked} checked={values.showToleranceCode!=='false'}
            onChange={event=>change('showToleranceCode',String(event.target.checked))}/>显示公差代号</label>
          <label><input type="checkbox" disabled={locked} checked={values.showToleranceDeviation!=='false'}
            onChange={event=>change('showToleranceDeviation',String(event.target.checked))}/>显示上下偏差</label>
        </details>
        <details>
          <summary>尺寸显示</summary>
          {field('precision', '小数位数')}
          {field('textSize', '字高 (mm)')}
          {select('arrowStyle', '箭头', [
            ['CLOSED', '闭合箭头'],
            ['OPEN', '开口箭头'],
          ])}
        </details>
        {position}
      </>
    );
  }
  const fields: string[] = e.kind === 'engineeringAnnotation' ? JSON.parse(values.fields) : [];
  const setFields = (parts: string[]) => change('fields', JSON.stringify(parts));
  return (
    <>
      {e.kind === 'text' && field('content', '文字内容')}
      {e.kind === 'symbol' &&
        select('symbolType', '方向符号', [
          ['DIRECTION', '方向'],
          ['LEFT_ROTATION', '左旋'],
          ['RIGHT_ROTATION', '右旋'],
        ])}
      {e.kind === 'symbol' && <>
        {field('label','向视字母')}
        {e.symbolType==='DIRECTION' && field('arrowLength','箭杆长度（mm，留空使用默认值）')}
        <details>
          <summary>向视字母位置</summary>
          {field('labelU','字母 u（mm）')}
          {field('labelV','字母 v（mm）')}
        </details>
      </>}
      {e.kind === 'engineeringAnnotation' && (
        <>
          {e.annotationType === 'ROUGHNESS' &&
            select('roughnessMode', '表面加工方式', [
              ['BASIC', '未指定'],
              ['REMOVAL_REQUIRED', '要求去除材料'],
              ['REMOVAL_PROHIBITED', '禁止去除材料'],
            ])}
          {e.annotationType==='ROUGHNESS' && <details>
            <summary>加工与纹理</summary>
            {select('accessory','附加符号',roughnessAccessories)}
            {select('texture','加工纹理',roughnessTextures)}
            {select('extent','适用范围',roughnessExtents)}
            {field('method','加工方法')}
          </details>}
          {e.annotationType==='GEOMETRIC_TOLERANCE' && <ToleranceRows value={values.toleranceRows}
            first={fields} locked={locked} change={value=>change('toleranceRows',value)} />}
          {e.annotationType!=='TOLERANCE_TEXT' && <details>
            <summary>引线接触点</summary>
            {field('leaderU','接触 u（mm）')}
            {field('leaderV','接触 v（mm）')}
          </details>}
          {!values.toleranceRows && fields.map((v, i) => (
            <label key={i}>
              {e.annotationType === 'TOLERANCE_TEXT'
                ? ['基本尺寸', '上偏差', '下偏差'][i]
                : `标注字段 ${i + 1}`}
              <input
                value={v}
                disabled={locked}
                onChange={(ev) => setFields(fields.map((s, j) => (j === i ? ev.target.value : s)))}
              />
            </label>
          ))}
          {e.annotationType !== 'TOLERANCE_TEXT' && !values.toleranceRows && (
            <button
              type="button"
              disabled={locked || fields.length >= 6}
              onClick={() => setFields([...fields, ''])}
            >
              添加字段
            </button>
          )}
          {e.annotationType !== 'TOLERANCE_TEXT' && !values.toleranceRows && fields.length > 1 && (
            <button type="button" disabled={locked} onClick={() => setFields(fields.slice(0, -1))}>
              移除末字段
            </button>
          )}
        </>
      )}
      {field('size', '尺寸 (mm)')}
      {field('angle', '方向角 (°)')}
      {position}
    </>
  );
}
