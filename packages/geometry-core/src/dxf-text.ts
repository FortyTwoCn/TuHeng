import type { CadText } from './cad-geometry';
import {
  dxfNormal,
  dxfNumber,
  dxfPoint,
  dxfPointTags,
  dxfValue,
  type DxfPair,
  type DxfTags,
} from './dxf-format';
import { angleVector, dxfDegrees, ocsPoint, type DxfShape } from './dxf-shapes';
import { add, angle, distance, dot, length, scale, sub, unit } from './vectors';

function decodeDxfText(value: string, multiline = false) {
  const symbols = { d: '°', p: '±', c: '⌀', u: '', o: '' };
  const content = value.replace(
    /%%([dpcuo])/gi,
    (_, letter: string) => symbols[letter.toLowerCase() as keyof typeof symbols],
  );
  if (!multiline)
    return content.replace(/\\U\+([\da-f]{4})/gi, (_, hex: string) =>
      String.fromCharCode(parseInt(hex, 16)),
    );
  return content.replace(
    /\\[Uu]\+([\da-fA-F]{4})|\\([\\{}P~])|\\[LlOoKk]|\\([AaCcFfHhQqTtWwSsp])([^;{}\\]*);|[{}]/g,
    (
      _,
      hex: string | undefined,
      escaped: string | undefined,
      control: string | undefined,
      value: string | undefined,
    ) => {
      if (hex) return String.fromCharCode(parseInt(hex, 16));
      if (escaped === 'P') return '\n';
      if (escaped === '~') return ' ';
      if (escaped) return escaped;
      return control?.toUpperCase() === 'S' ? (value ?? '').replace(/[\^#]/g, '/') : '';
    },
  );
}

// 字符串组码按行存储。转义字面反斜线和旧式 %% 命令，防止文字内容被当作格式。
function encodeDxfText(text: string) {
  return text
    .replace(/\\/g, '\\U+005C')
    .replace(/%%/g, '\\U+0025\\U+0025')
    .replace(/[\u0000-\u0009\u000B\u000C\u000E-\u001F]/gu, ' ');
}

export function dxfTextTags(label: CadText): { type: string; tags: DxfPair[] } {
  const content = encodeDxfText(label.text);
  if (/[\r\n]/.test(content)) {
    const lines = content.replace(/[{}]/g, '\\$&').replace(/\r\n?|\n/g, '\\P');
    const chunks = [];
    const encoder = new TextEncoder();
    let chunk = '',
      size = 0;
    for (const character of lines) {
      const bytes = encoder.encode(character).length;
      if (size + bytes > 240) {
        chunks.push(chunk);
        chunk = '';
        size = 0;
      }
      chunk += character;
      size += bytes;
    }
    chunks.push(chunk);
    return {
      type: 'MTEXT',
      tags: [
        [100, 'AcDbMText'],
        ...dxfPointTags(10, label.at, 0),
        [40, label.size],
        [41, 0],
        [71, label.anchor === 'end' ? 9 : 7],
        [72, 1],
        [7, 'STANDARD'],
        ...chunks.map((value, index): DxfPair => [index === chunks.length - 1 ? 1 : 3, value]),
        ...dxfPointTags(11, angleVector(label.angle), 0),
      ],
    };
  }
  return {
    type: 'TEXT',
    tags: [
      [100, 'AcDbText'],
      ...dxfPointTags(10, label.at, 0),
      [40, label.size],
      [1, content],
      [50, label.angle],
      [7, 'STANDARD'],
      [72, label.anchor === 'end' ? 2 : 0],
      ...dxfPointTags(11, label.at, 0),
      [100, 'AcDbText'],
      [73, 0],
    ],
  };
}

export function readDxfText(type: 'TEXT' | 'MTEXT', tags: DxfTags): DxfShape {
  const multiline = type === 'MTEXT';
  const content = multiline
    ? tags
        .filter(([code]) => code === 1 || code === 3)
        .map(([, value]) => value)
        .join('')
    : (dxfValue(tags, 1) ?? '');
  const normal = dxfNormal(tags);
  const anchor =
    !multiline &&
    (dxfNumber(tags, 72, 0) || dxfNumber(tags, 73, 0)) &&
    dxfValue(tags, 11) !== undefined
      ? 11
      : 10;
  const degrees = dxfNumber(tags, 50, 0);
  const vectorIndex = tags.findIndex(([code]) => code === 11);
  const angleIndex = tags.findIndex(([code]) => code === 50);
  const rotation =
    multiline && vectorIndex > angleIndex
      ? angle(dxfPoint(tags, 11))
      : normal < 0
        ? 180 - degrees
        : degrees;
  return {
    kind: 'text',
    position: ocsPoint(dxfPoint(tags, anchor), multiline ? 1 : normal),
    angle: rotation,
    size: dxfNumber(tags, 40, 2.5),
    content: decodeDxfText(content, multiline).trim(),
  };
}

/** 基础 DIMENSION 转换为可编辑的尺寸文字及可计算的线性标注线。 */
export function readDxfDimension(tags: DxfTags): DxfShape[] {
  const type = dxfNumber(tags, 70, 0) & 7;
  const normal = dxfNormal(tags);
  const at = (code: number) =>
    dxfValue(tags, code) === undefined ? undefined : dxfPoint(tags, code);
  const placement = at(10),
    first = at(13),
    second = at(14);
  const textAt = at(11);
  const strokes: DxfShape[] = [];
  let measurement: number | undefined;
  if ((type === 0 || type === 1) && first && second) {
    const direction = type === 0 ? angleVector(dxfNumber(tags, 50, 0)) : unit(sub(second, first));
    measurement = Math.abs(dot(sub(second, first), direction));
    if (placement && length(direction) > 0) {
      const perpendicular = { x: -direction.y, y: direction.x };
      const offset = (p: typeof first) =>
        add(p, scale(perpendicular, dot(sub(placement, p), perpendicular)));
      const a = offset(first),
        b = offset(second);
      strokes.push(
        { kind: 'segment', start: first, end: a },
        { kind: 'segment', start: a, end: b },
        { kind: 'segment', start: second, end: b },
      );
    }
  }
  const radialPoint = at(15);
  if ((type === 3 || type === 4) && placement && radialPoint)
    measurement = distance(placement, radialPoint);
  if (dxfValue(tags, 42) !== undefined) measurement = dxfNumber(tags, 42);
  const angular = type === 2 || type === 5;
  const formattedValue =
    measurement === undefined
      ? ''
      : Number((angular ? measurement * dxfDegrees : measurement).toFixed(4)).toString();
  const measuredText = formattedValue
    ? (type === 3 ? '⌀' : type === 4 ? 'R' : '') + formattedValue + (angular ? '°' : '')
    : '';
  const override = dxfValue(tags, 1);
  const content =
    override === ' '
      ? ''
      : decodeDxfText((override || '<>').replaceAll('<>', measuredText), true).trim();
  const position = textAt ? ocsPoint(textAt, normal) : (placement ?? first);
  if (position && content)
    strokes.push({ kind: 'text', position, angle: dxfNumber(tags, 53, 0), size: 2.5, content });
  return strokes;
}
