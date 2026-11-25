import type { CadEntity } from '@tuheng/contracts';
import { add, sub } from './vectors';
import { readRoughnessDetails, readToleranceRows } from './engineering-parameters';

/** Names are shared by precise property inputs, snapshots and commit validation. */
export function cadPropertyValues(e: CadEntity): Record<string, string> {
  if (e.kind === 'ellipse')
    return {
      majorRadius: String(e.majorRadius),
      minorRadius: String(e.minorRadius),
      angle: String(e.angle),
      startAngle: String(e.startAngle),
      sweep: String(e.sweep),
    };
  if (e.kind === 'hatch')
    return {
      angle: String(e.angle),
      spacing: String(e.spacing),
      u: String(e.origin.x),
      v: String(e.origin.y),
    };
  const anchor = { u: String(e.position.x), v: String(e.position.y) };
  if (e.kind === 'dimension')
    return {
      ...anchor,
      precision: String(e.precision),
      textOverride: e.textOverride,
      textSize: String(e.textSize),
      arrowStyle: e.arrowStyle,
      toleranceCode: e.tolerance?.code ?? '', toleranceUpper: e.tolerance?.upper ?? '', toleranceLower: e.tolerance?.lower ?? '',
      showToleranceCode: String(e.tolerance?.showCode ?? true), showToleranceDeviation: String(e.tolerance?.showDeviation ?? true),
      ...(e.dimensionType === 'LINEAR'
        ? { linearAngle: String(e.linearAngle ?? (e.linearAxis === 'Y' ? 90 : 0)) }
        : {}),
    };
  const common = { ...anchor, size: String(e.size), angle: String(e.angle) };
  if (e.kind === 'text') return { ...common, content: e.content };
  if (e.kind === 'symbol') return {
    ...common, symbolType: e.symbolType, label: e.label ?? '',
    labelU: e.labelPosition ? String(e.labelPosition.x) : '',
    labelV: e.labelPosition ? String(e.labelPosition.y) : '',
    arrowLength: e.arrowLength ? String(e.arrowLength) : '',
  };
  return {
    ...common,
    fields: JSON.stringify(e.fields),
    leaderU:e.leader ? String(e.leader.x) : '', leaderV:e.leader ? String(e.leader.y) : '',
    toleranceRows:e.toleranceRows ? JSON.stringify(e.toleranceRows) : '',
    ...(e.annotationType==='ROUGHNESS' ? e.roughnessDetails ?? {accessory:'NONE',texture:'NONE',method:'',extent:'NONE'} : {}),
    ...(e.annotationType === 'ROUGHNESS' ? { roughnessMode: e.roughnessMode ?? 'BASIC' } : {}),
  };
}
export function changeCadProperties(
  e: CadEntity,
  v: Record<string, string>,
  number: (key: string) => number,
) {
  if (e.kind === 'ellipse') {
    e.majorRadius = number('majorRadius');
    e.minorRadius = number('minorRadius');
    e.angle = number('angle');
    e.startAngle = number('startAngle');
    e.sweep = number('sweep');
    return;
  }
  const position = { x: number('u'), y: number('v') };
  if (e.kind === 'hatch') {
    e.origin = position;
    e.angle = number('angle');
    e.spacing = number('spacing');
    return;
  }
  const delta = sub(position,e.position);
  e.position = position;
  if (e.kind === 'dimension') {
    e.precision = number('precision');
    e.textSize = number('textSize');
    e.textOverride = v.textOverride;
    const code=(v.toleranceCode ?? '').trim(), upper=(v.toleranceUpper ?? '').trim(), lower=(v.toleranceLower ?? '').trim();
    if (code || upper || lower) e.tolerance={code,upper,lower,showCode:v.showToleranceCode!=='false',showDeviation:v.showToleranceDeviation!=='false'};
    else delete e.tolerance;
    if (v.arrowStyle !== 'CLOSED' && v.arrowStyle !== 'OPEN') throw Error('请选择箭头样式');
    e.arrowStyle = v.arrowStyle;
    if (e.dimensionType === 'LINEAR') {
      const angle=number('linearAngle');
      if (angle !== (e.linearAngle ?? (e.linearAxis === 'Y' ? 90 : 0))) {
        e.linearAngle = angle;
        delete e.linearAxis;
      }
    }
    return;
  }
  e.angle = number('angle');
  e.size = number('size');
  if (e.kind === 'text') e.content = v.content;
  else if (e.kind === 'symbol') {
    if (
      v.symbolType !== 'DIRECTION' &&
      v.symbolType !== 'LEFT_ROTATION' &&
      v.symbolType !== 'RIGHT_ROTATION'
    )
      throw Error('未知方向符号');
    e.symbolType = v.symbolType;
    if (v.label?.trim()) e.label=v.label.trim();
    else delete e.label;
    if (v.labelU?.trim() || v.labelV?.trim()) {
      const p={x:number('labelU'),y:number('labelV')};
      e.labelPosition=e.labelPosition && p.x===e.labelPosition.x && p.y===e.labelPosition.y ? add(p,delta) : p;
    } else delete e.labelPosition;
    if (v.arrowLength?.trim() && e.symbolType==='DIRECTION') e.arrowLength=number('arrowLength');
    else delete e.arrowLength;
  } else {
    const result: unknown = JSON.parse(v.fields);
    if (!Array.isArray(result) || !result.every((s: unknown) => typeof s === 'string'))
      throw Error('工程标注字段无效');
    e.fields = result;
    if (v.leaderU?.trim() || v.leaderV?.trim()) e.leader={x:number('leaderU'),y:number('leaderV')};
    else delete e.leader;
    if (v.toleranceRows) e.toleranceRows=readToleranceRows(v.toleranceRows);
    else delete e.toleranceRows;
    if (e.annotationType === 'ROUGHNESS') {
      if (
        v.roughnessMode !== 'BASIC' &&
        v.roughnessMode !== 'REMOVAL_REQUIRED' &&
        v.roughnessMode !== 'REMOVAL_PROHIBITED'
      )
        throw Error('未知表面加工方式');
      e.roughnessMode = v.roughnessMode;
      if (e.roughnessDetails || v.accessory || v.texture || v.method || v.extent) e.roughnessDetails=readRoughnessDetails(v);
    }
  }
}
