import type { CadEntity } from '@tuheng/contracts';

type Mark = Extract<CadEntity, { kind: 'engineeringAnnotation' }>;
export const formFeatures = ['⏤', '⏥', '○', '⌭', '⌒', '⌓', '∥', '⟂', '∠', '⌖', '◎', '⌯', '↗', '⌰'];
export const roughnessTextures = [
  ['NONE', '无'],
  ['PARALLEL', '平行'],
  ['PERPENDICULAR', '垂直'],
  ['CROSSED', '交叉'],
  ['MULTIDIRECTIONAL', '多向'],
  ['CIRCULAR', '近似同心圆'],
  ['RADIAL', '近似放射'],
  ['NON_DIRECTIONAL', '无定向颗粒'],
] as const;
export const roughnessAccessories = [
  ['NONE', '无'],
  ['BAR', '横线'],
  ['ALL_AROUND', '全周边'],
  ['AFTER_WELD', '焊后加工'],
] as const;
export const roughnessExtents = [
  ['NONE', '不指定'],
  ['ALL', '全部'],
  ['REMAINDER', '其余'],
] as const;

export const startingToleranceRow = (first: string, value: string, datum: string) => [
  first,
  value,
  '',
  datum,
  '',
  '',
];

function allowed<T extends string>(
  options: readonly (readonly [T, string])[],
  value: string | undefined,
) {
  return options.find(([id]) => id === value)?.[0] ?? options[0][0];
}

export function readRoughnessDetails(
  fields: Record<string, string>,
): NonNullable<Mark['roughnessDetails']> {
  return {
    accessory: allowed(roughnessAccessories, fields.accessory),
    texture: allowed(roughnessTextures, fields.texture),
    method: (fields.method ?? '').trim(),
    extent: allowed(roughnessExtents, fields.extent),
  };
}

export function readToleranceRows(value: string): NonNullable<Mark['toleranceRows']> {
  const rows: unknown = JSON.parse(value);
  if (
    !Array.isArray(rows) ||
    rows.length < 1 ||
    rows.length > 3 ||
    rows.some(
      (row) =>
        !Array.isArray(row) ||
        row.length !== 6 ||
        !row.every((part: unknown) => typeof part === 'string') ||
        !row[0].trim() ||
        !row[1].trim(),
    )
  )
    throw Error('每行需填写形位特征和公差值');
  return rows;
}

export function engineeringPlacement(id: string) {
  return id === 'datum' || id === 'roughness' || id === 'toleranceFrame';
}
