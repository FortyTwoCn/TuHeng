import { editable, setCadAppearance, type ObjectSnapType } from '@tuheng/geometry-core';
import type { GeometryDocument, GeometryEntity } from '@tuheng/contracts';
import { draftingInk, type EditorTheme } from './theme';

export const objectSnaps: { id: ObjectSnapType; name: string }[] = [
  { id: 'endpoint', name: '端点' },
  { id: 'midpoint', name: '中点' },
  { id: 'center', name: '中心' },
  { id: 'intersection', name: '交点' },
  { id: 'perpendicular', name: '垂足' },
  { id: 'tangent', name: '切点' },
  { id: 'quadrant', name: '象限点' },
  { id: 'nearest', name: '轮廓就近点' },
];
export function ObjectSnapChoices({
  selected,
  change,
}: {
  selected: readonly ObjectSnapType[];
  change: (types: ObjectSnapType[]) => void;
}) {
  return (
    <div className="cad-snap-choices" role="group" aria-label="对象捕捉类型">
      {objectSnaps.map(({ id, name }, index) => (
        <label key={id}>
          <input
            type="checkbox"
            data-initial-focus={index === 0 ? true : undefined}
            checked={selected.includes(id)}
            onChange={(e) =>
              change(e.target.checked ? [...selected, id] : selected.filter((v) => v !== id))
            }
          />
          {name}
        </label>
      ))}
    </div>
  );
}
export type Appearance = NonNullable<GeometryEntity['appearance']>;
export const patternNames = {
  SOLID: '实线',
  DASHED: '虚线',
  CENTER: '点划线',
  PHANTOM: '双点划线',
  GUIDE: '辅助线',
} satisfies Record<NonNullable<Appearance['pattern']>, string>;

export const linePresets = {
  SOLID: { widthMm: 0.5 },
  DASHED: { widthMm: 0.25 },
  CENTER: { color: '#d16666', widthMm: 0.25 },
  PHANTOM: { color: '#c78235', widthMm: 0.25 },
  GUIDE: { color: '#a37eda', widthMm: 0.25 },
} satisfies Record<NonNullable<Appearance['pattern']>, Appearance>;
export function styleNewGeometry(
  base: GeometryDocument,
  next: GeometryDocument,
  appearance: Appearance,
) {
  if (!Object.keys(appearance).length) return next;
  const existing = new Set(base.entities.map((e) => e.id));
  return {
    ...next,
    entities: next.entities.map((e) =>
      existing.has(e.id) || e.appearance ? e : { ...e, appearance },
    ),
  };
}

export function DrawingAppearance({
  theme,
  initial,
  doc,
  selected,
  role,
  readOnly,
  commit,
  change,
  report,
}: {
  theme: EditorTheme;
  initial: Appearance;
  doc: GeometryDocument;
  selected: string[];
  role: 'teacher' | 'student';
  readOnly: boolean;
  commit: (d: GeometryDocument, label?: string) => void;
  change: (v: Appearance) => void;
  report: (s: string) => void;
}) {
  const entities = doc.entities.filter((e) => selected.includes(e.id));
  const allowed =
    !readOnly &&
    selected.length === entities.length &&
    entities.every((e) => editable(doc, e, role));
  const { ink, axis, stem } = draftingInk[theme];
  const defaultColor = (style: GeometryEntity['lineStyle']) =>
    style.startsWith('PROBLEM') ? stem : style === 'CONSTRUCTION' ? axis : ink;
  const resolve = (entity: GeometryEntity, key: keyof Appearance) =>
    entity.appearance?.[key] ??
    (key === 'color'
      ? defaultColor(entity.lineStyle)
      : key === 'pattern'
        ? entity.lineStyle.includes('HIDDEN') || entity.lineStyle.includes('CONSTRUCTION')
          ? 'DASHED'
          : 'SOLID'
        : undefined);
  function value(key: keyof Appearance) {
    if (!entities.length) return String(initial[key] ?? '');
    const first = resolve(entities[0], key);
    return entities.every((e) => resolve(e, key) === first) ? String(first ?? '') : 'mixed';
  }
  function apply(patch: Appearance) {
    if (!allowed) return;
    if (!selected.length) {
      change({ ...initial, ...patch });
      return;
    }
    try {
      commit(setCadAppearance(doc, selected, patch, role), '更改绘图样式');
    } catch (error) {
      report(error instanceof Error ? error.message : '无法应用样式');
    }
  }
  const color = value('color'),
    width = value('widthMm'),
    pattern = value('pattern');
  return (
    <div
      className="cad-style-fields"
      role="group"
      aria-label={selected.length ? '所选对象的样式' : '新图形的默认样式'}
    >
      <label title={color === 'mixed' ? '所选颜色混合' : '绘图颜色'}>
        颜色
        {color === 'mixed' && <span>混合</span>}
        <input
          type="color"
          aria-label="绘图颜色"
          disabled={!allowed}
          value={
            color && color !== 'mixed'
              ? color
              : defaultColor(role === 'teacher' ? 'PROBLEM_VISIBLE' : 'ANSWER_VISIBLE')
          }
          onChange={(e) => apply({ color: e.target.value })}
        />
      </label>
      <select
        aria-label="绘图线型"
        title="绘图线型"
        disabled={!allowed}
        value={pattern || 'SOLID'}
        onChange={(e) => {
          const pattern = e.target.value as keyof typeof linePresets;
          apply({ pattern, ...linePresets[pattern] });
        }}
      >
        {pattern === 'mixed' && (
          <option value="mixed" disabled>
            线型混合
          </option>
        )}
        {Object.entries(patternNames).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <select
        aria-label="绘图线宽"
        title="线宽（mm）"
        disabled={!allowed}
        value={width}
        onChange={(e) => apply({ widthMm: Number(e.target.value) })}
      >
        {width === 'mixed' && (
          <option value="mixed" disabled>
            线宽混合
          </option>
        )}
        {!width && (
          <option value="" disabled>
            默认线宽
          </option>
        )}
        {[
          ...new Set([
            0.13,
            0.18,
            0.25,
            0.35,
            0.5,
            0.7,
            1,
            ...(Number(width) > 0 ? [Number(width)] : []),
          ]),
        ]
          .sort((a, b) => a - b)
          .map((n) => (
            <option key={n} value={n}>
              {n === 0.25 ? '细线 · ' : n === 0.5 ? '粗线 · ' : ''}
              {n} mm
            </option>
          ))}
      </select>
    </div>
  );
}
