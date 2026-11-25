import type { GeometryDocument, GeometryEntity } from '@tuheng/contracts';
import { resolveReference, targetFromKey, type SnapCandidate } from '@tuheng/geometry-core';
import { entityNames } from './PropertyFields';
import { patternNames } from './CadPreferences';
import type { Hit } from './interaction-controller';

const snapNames: Partial<Record<SnapCandidate['kind'], string>> = {
  COINCIDENT: '端点',
  MIDPOINT: '中点',
  INTERSECTION: '交点',
  POINT_ON_LINE: '线上点',
  AXIS_DIRECTION: '沿轴方向',
  GRID: '网格',
  PROJECTION_ALIGNMENT: '投影对齐',
};

export function SnapFeedback({
  candidate,
  paused,
  toggle,
}: {
  candidate?: SnapCandidate | null;
  paused: boolean;
  toggle: () => void;
}) {
  return (
    <div className="geo-snap-feedback" data-snap-feedback={candidate ? 'true' : undefined}>
      {candidate && <>吸附：{candidate.label ?? snapNames[candidate.kind] ?? candidate.kind}</>}
      <button type="button" onPointerDown={(e) => e.preventDefault()} onClick={toggle}>
        {paused ? '恢复当前吸附' : '暂停当前吸附'}
      </button>
      <span>按 Alt 暂停</span>
    </div>
  );
}

export function OverlappingTargets({
  doc,
  hits,
  selectedId,
  select,
}: {
  doc: GeometryDocument;
  hits: Hit[];
  selectedId: string;
  select: (ids: string[]) => void;
}) {
  return (
    <select
      className="geo-overlaps"
      aria-label="重叠对象"
      value={selectedId}
      onChange={(e) => select([e.target.value])}
    >
      {hits.map((hit, index) => {
        const entity = doc.entities.find((e) => e.id === hit.id);
        const label =
          hit.kind === 'reference'
            ? resolveReference(doc, targetFromKey(hit.id)).name
            : `对象 ${index + 1} · ${entity ? entityNames[entity.kind] : '图形'}`;
        return (
          <option key={hit.id} value={hit.id}>
            {label}
          </option>
        );
      })}
    </select>
  );
}

export function EntityStyleHint({ entity }: { entity: GeometryEntity }) {
  const pattern = entity.appearance?.pattern;
  const label = pattern
    ? patternNames[pattern]
    : entity.lineStyle === 'CONSTRUCTION'
      ? '辅助线'
      : entity.lineStyle.endsWith('HIDDEN')
        ? '虚线'
        : '实线';
  return (
    <output className="cad-hover-style">
      {entityNames[entity.kind]} · {label} · {entity.appearance?.widthMm ?? 0.42} mm ·{' '}
      {entity.appearance?.color ?? '图层默认颜色'}
    </output>
  );
}
