import type { DxfPair, DxfTags } from './dxf-format';
import { dxfAppValue, dxfName, dxfNumber, dxfNumeric, dxfRecords } from './dxf-format';
import { semanticLineStyles } from './svg';
import type { GeometryEntity, LayerRole } from '@tuheng/contracts';

type Appearance = NonNullable<GeometryEntity['appearance']>;
type Pattern = NonNullable<Appearance['pattern']>;
type RGB = [number, number, number];
export const dxfLayerNames = {
  PROBLEM_STEM: 'TH_PROBLEM_STEM',
  STUDENT_ANSWER: 'TH_STUDENT_ANSWER',
  CONSTRUCTION: 'TH_CONSTRUCTION',
} satisfies Record<LayerRole, string>;
export const dxfReferenceLayer = 'TH_REFERENCE';
export const dxfAnnotationSuffix = '_ANNOTATION';

export const dxfLinePatterns = {
  SOLID: { name: 'CONTINUOUS', dashes: [] },
  DASHED: { name: 'DASHED', dashes: [3.5, -2] },
  CENTER: { name: 'CENTER', dashes: [6, -1.5, 1, -1.5] },
  PHANTOM: { name: 'PHANTOM', dashes: [6, -1.5, 1, -1.5, 1, -1.5] },
  GUIDE: { name: 'TH_GUIDE', dashes: [1.5, -1.5] },
} satisfies Record<Pattern, { name: string; dashes: number[] }>;

const primaryColors: RGB[] = [
  [0, 0, 0],
  [255, 0, 0],
  [255, 255, 0],
  [0, 255, 0],
  [0, 255, 255],
  [0, 0, 255],
  [255, 0, 255],
  [0, 0, 0],
  [128, 128, 128],
  [192, 192, 192],
];
function aciColor(index: number): RGB | undefined {
  if (index <= 9) return primaryColors[index];
  if (index >= 250) {
    const grey = [51, 80, 105, 130, 190, 255][index - 250];
    return grey === undefined ? undefined : [grey, grey, grey];
  }
  const hue = Math.floor((index - 10) / 10),
    shade = (index - 10) % 10,
    t = (hue % 4) / 4;
  const primary: RGB[] = [
    [1, t, 0],
    [1 - t, 1, 0],
    [0, 1, t],
    [0, 1 - t, 1],
    [t, 0, 1],
    [1, 0, 1 - t],
  ];
  const value = [255, 165, 127, 76, 38][Math.floor(shade / 2)];
  const rgb = primary[Math.floor(hue / 4)];
  return rgb.map((channel) => Math.floor((shade % 2 ? (channel + 1) / 2 : channel) * value)) as RGB;
}
const aciPalette = Array.from({ length: 255 }, (_, index) => aciColor(index + 1)!);
const colorHex = (color: number) => '#' + color.toString(16).padStart(6, '0');
function nearestAci(color: number) {
  const rgb = [color >> 16, (color >> 8) & 255, color & 255];
  let best = 7,
    gap = Infinity;
  for (const [index, candidate] of aciPalette.entries()) {
    const distance =
      (candidate[0] - rgb[0]) ** 2 + (candidate[1] - rgb[1]) ** 2 + (candidate[2] - rgb[2]) ** 2;
    if (distance >= gap) continue;
    best = index + 1;
    gap = distance;
  }
  return best;
}
const lineWeights = [
  0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200,
  211,
];
function nearestLineWeight(widthMm: number) {
  return lineWeights.reduce((nearest, width) =>
    Math.abs(width - widthMm * 100) < Math.abs(nearest - widthMm * 100) ? width : nearest,
  );
}

export function dxfEntityStyle(
  entity: Pick<GeometryEntity, 'lineStyle' | 'appearance'>,
): DxfPair[] {
  const pattern =
    entity.appearance?.pattern ??
    (entity.lineStyle === 'CONSTRUCTION' || entity.lineStyle.endsWith('HIDDEN')
      ? 'DASHED'
      : 'SOLID');
  const color = Number.parseInt(
    (entity.appearance?.color ?? semanticLineStyles[entity.lineStyle].stroke).slice(1),
    16,
  );
  const tags: DxfPair[] = [
    [6, dxfLinePatterns[pattern].name],
    [62, nearestAci(color)],
    [420, color],
  ];
  if (entity.appearance?.widthMm !== undefined)
    tags.push([370, nearestLineWeight(entity.appearance.widthMm)]);
  return tags;
}

function asColor(tags: DxfTags) {
  const rgb = dxfNumber(tags, 420, -1);
  if (Number.isInteger(rgb) && rgb >= 0 && rgb <= 0xffffff) return colorHex(rgb);
  const aci = Math.abs(dxfNumber(tags, 62, 256));
  if (!Number.isInteger(aci) || aci < 1 || aci > 255) return;
  const [r, g, b] = aciPalette[aci - 1];
  return colorHex((r << 16) | (g << 8) | b);
}

export function readDxfStyles(tables: DxfTags) {
  const layers = new Map<string, DxfTags>(),
    lineTypes = new Map<string, DxfTags>();
  for (const { type, tags } of dxfRecords(tables)) {
    const name = dxfName(tags, 2);
    if (!name) continue;
    if (type === 'LAYER') layers.set(name, tags);
    if (type === 'LTYPE') lineTypes.set(name, tags);
  }
  function patternFor(name: string): Pattern | undefined {
    if (name === 'CONTINUOUS') return 'SOLID';
    if (name === dxfLinePatterns.GUIDE.name) return 'GUIDE';
    if (name.includes('PHANTOM')) return 'PHANTOM';
    if (/CENTER|CENTRE|DASHDOT/.test(name)) return 'CENTER';
    if (/DASH|HIDDEN|DOT/.test(name)) return 'DASHED';
    const definition = lineTypes.get(name) ?? [];
    const dashes = definition
      .filter(([code]) => code === 49)
      .map(([, value]) => dxfNumeric(value, 49));
    if (dashes.some((dash) => dash < 0)) {
      const marks = dashes.filter((dash) => dash >= 0).length;
      return marks > 2 ? 'PHANTOM' : marks === 2 ? 'CENTER' : 'DASHED';
    }
  }
  const inheritedType = (type: string | undefined) =>
    type && type !== 'BYLAYER' && type !== 'BYBLOCK' ? type : undefined;
  return (
    tags: DxfTags,
    metadata: DxfTags,
    layerName: string,
    role: 'teacher' | 'student',
    polylineWidth: number,
    block?: { tags: DxfTags; layer: string },
  ) => {
    const layer = layers.get(layerName) ?? [];
    const blockLayer = block ? (layers.get(block.layer) ?? []) : [];
    const declaredType = dxfName(tags, 6);
    const blockType =
      block &&
      declaredType === 'BYBLOCK' &&
      (inheritedType(dxfName(block.tags, 6)) ?? dxfName(blockLayer, 6));
    const name = inheritedType(declaredType) || blockType || dxfName(layer, 6) || 'CONTINUOUS';
    const pattern = patternFor(name);
    const construction = /CONSTRUCTION|REFERENCE|GUIDE|AUXILIARY|辅助|参考/.test(layerName);
    const layerRole =
      role === 'teacher' ? 'PROBLEM_STEM' : construction ? 'CONSTRUCTION' : 'STUDENT_ANSWER';
    const lineStyle: GeometryEntity['lineStyle'] =
      role === 'teacher'
        ? pattern === 'DASHED'
          ? 'PROBLEM_HIDDEN'
          : 'PROBLEM_VISIBLE'
        : construction
          ? 'CONSTRUCTION'
          : pattern === 'DASHED'
            ? 'ANSWER_HIDDEN'
            : 'ANSWER_VISIBLE';
    const explicit = dxfNumber(tags, 370, -1);
    const byBlockWeight = block && explicit === -2 ? dxfNumber(block.tags, 370, -1) : -1;
    const weight =
      explicit >= 0
        ? explicit
        : byBlockWeight >= 0
          ? byBlockWeight
          : dxfNumber(block && explicit === -2 ? blockLayer : layer, 370, -1);
    const storedWidth = Number(dxfAppValue(metadata, 'WIDTH_MM'));
    const sourceWidth =
      storedWidth >= 0.05 && storedWidth <= 5
        ? storedWidth
        : weight > 0
          ? weight / 100
          : polylineWidth;
    const widthMm = sourceWidth > 0 ? Math.min(5, Math.max(0.05, sourceWidth)) : undefined;
    const inheritedColor =
      block && dxfNumber(tags, 62, 256) === 0
        ? (asColor(block.tags) ?? asColor(blockLayer))
        : undefined;
    const appearance: Appearance = {
      pattern,
      color: asColor(tags) ?? inheritedColor ?? asColor(layer),
      widthMm,
    };
    return { layerRole, lineStyle, appearance } as const;
  };
}
