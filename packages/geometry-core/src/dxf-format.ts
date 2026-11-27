import type { Vec2 } from '@tuheng/contracts';

export const DXF_MAX_BYTES = 8_000_000;
export const DXF_MAX_ENTITIES = 20_000;
const maxGroups = 400_000;
export const dxfAppId = 'TUHENG';
export const dxfAxisLayer = 'TH_AXIS';

export type DxfPair = readonly [code: number, value: string | number];
export type DxfTags = readonly (readonly [code: number, value: string])[];
export type DxfRecord = { type: string; tags: DxfTags };

export const dxfValue = (tags: DxfTags, code: number) => tags.find(([c]) => c === code)?.[1];
export const dxfName = (tags: DxfTags, code: number) => dxfValue(tags, code)?.trim().toUpperCase();

export function dxfNumeric(raw: string, code: number) {
  const value = Number(raw);
  if (
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw.trim()) ||
    !Number.isFinite(value) ||
    Math.abs(value) > 1e14
  )
    throw Error(`DXF 组码 ${code} 的数值无效`);
  return value;
}

export function dxfNumber(tags: DxfTags, code: number, fallback?: number): number {
  const raw = dxfValue(tags, code);
  if (raw !== undefined) return dxfNumeric(raw, code);
  if (fallback !== undefined) return fallback;
  throw Error(`DXF 缺少组码 ${code}`);
}

export function dxfPoint(tags: DxfTags, code = 10): Vec2 {
  return { x: dxfNumber(tags, code), y: dxfNumber(tags, code + 10) };
}

export function dxfPointTags(code: number, point: Vec2, z?: number): DxfPair[] {
  const xy: DxfPair[] = [
    [code, point.x],
    [code + 10, point.y],
  ];
  if (z !== undefined) xy.push([code + 20, z]);
  return xy;
}

/** 重复的点和边以同一组码起头。保留原有顺序及各组的附加字段。 */
export function dxfGroups(tags: DxfTags, startCode: number): DxfTags[] {
  const groups: DxfTags[] = [];
  let start = tags.findIndex(([code]) => code === startCode);
  if (start < 0) return groups;
  for (let index = start + 1; index < tags.length; index++) {
    if (tags[index][0] !== startCode) continue;
    groups.push(tags.slice(start, index));
    start = index;
  }
  groups.push(tags.slice(start));
  return groups;
}

export function dxfRecords(tags: DxfTags): DxfRecord[] {
  return dxfGroups(tags, 0).map((record) => ({
    type: record[0][1].trim().toUpperCase(),
    tags: record.slice(1),
  }));
}

export function dxfAppData(tags: DxfTags): DxfTags {
  return dxfGroups(tags, 1001).find((group) => dxfName(group, 1001) === dxfAppId) ?? [];
}

export function dxfAppValue(tags: DxfTags, key: string) {
  return tags
    .find(([code, value]) => code === 1000 && value.startsWith(key + '='))?.[1]
    .slice(key.length + 1);
}

/** 只解析文本 DXF。保留字符串原样，裁剪组码和关键字两侧的空格。 */
export function parseDxfSections(text: string) {
  if (text.length > DXF_MAX_BYTES || new TextEncoder().encode(text).length > DXF_MAX_BYTES)
    throw Error('DXF 文件超过 8 MB');
  if (text.includes('\0') || /^\uFEFF?AutoCAD Binary DXF/i.test(text))
    throw Error('请选择 ASCII 文本 DXF 文件');
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n?|\n/);
  const tags: [number, string][] = [];
  for (let index = 0; index < lines.length; index += 2) {
    const group = lines[index].trim();
    if (!group && index >= lines.length - 1) break;
    const code = Number(group);
    if (!/^\d{1,4}$/.test(group) || code > 1071 || index + 1 >= lines.length)
      throw Error(`DXF 第 ${index + 1} 行的组码无效或文件已截断`);
    if (code === 999) continue;
    tags.push([code, lines[index + 1]]);
    if (tags.length > maxGroups) throw Error('DXF 组码数量超过导入上限');
    if (code === 0 && lines[index + 1].trim().toUpperCase() === 'EOF') {
      if (lines.slice(index + 2).some((line) => line.trim()))
        throw Error('DXF 在 EOF 后含有额外内容');
      break;
    }
  }
  const sections = new Map<string, DxfTags>();
  const marker = (index: number, name: string) =>
    tags[index]?.[0] === 0 && tags[index][1].trim().toUpperCase() === name;
  let index = 0;
  while (marker(index, 'SECTION')) {
    const header = tags[index + 1];
    if (header?.[0] !== 2 || !header[1].trim()) throw Error('DXF 缺少段名称');
    const name = header[1].trim().toUpperCase();
    if (sections.has(name)) throw Error(`DXF 包含重复的 ${name} 段`);
    const start = index + 2;
    index = start;
    while (index < tags.length && !marker(index, 'ENDSEC')) {
      if (marker(index, 'SECTION') || marker(index, 'EOF')) throw Error(`DXF 的 ${name} 段已截断`);
      index++;
    }
    if (index >= tags.length) throw Error(`DXF 的 ${name} 段已截断`);
    sections.set(name, tags.slice(start, index));
    index++;
  }
  if (!marker(index, 'EOF') || !sections.has('ENTITIES') || index !== tags.length - 1)
    throw Error('DXF 缺少有效的 ENTITIES 段或 EOF，文件可能已截断');
  return sections;
}

// $INSUNITS 未指定时按毫米读入。其余单位换算到统一纸面毫米坐标。
const millimeters = [
  1,
  25.4,
  304.8,
  1_609_344,
  1,
  10,
  1_000,
  1_000_000,
  0.000_025_4,
  0.0254,
  914.4,
  1e-7,
  1e-6,
  1e-3,
  100,
  10_000,
  100_000,
  1e12,
  149_597_870_700_000,
  9.4607304725808e18,
  3.0856775814913673e19,
  1_200_000 / 3937,
  100_000 / 3937,
  3_600_000 / 3937,
  6_336_000_000 / 3937,
];
export function dxfUnitScale(header: DxfTags) {
  const index = header.findIndex(
    ([code, value]) => code === 9 && value.trim().toUpperCase() === '$INSUNITS',
  );
  if (index === -1) return 1;
  const units = dxfNumber(header.slice(index + 1, index + 2), 70);
  if (millimeters[units] === undefined) throw Error('DXF 使用了无法换算的图纸单位');
  return millimeters[units];
}

/** 旧版中文 CAD 可能按 $DWGCODEPAGE 保存文本。先尝试 UTF-8，再按文件声明解码。 */
export function decodeDxfBytes(bytes: Uint8Array) {
  if (bytes.byteLength > DXF_MAX_BYTES) throw Error('DXF 文件超过 8 MB');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    const latin = new TextDecoder('windows-1252').decode(bytes);
    const page =
      /(?:^|\n)[ \t]*9[ \t]*\r?\n[ \t]*\$DWGCODEPAGE[ \t]*\r?\n[ \t]*3[ \t]*\r?\n[ \t]*ANSI_(\d+)/i.exec(
        latin,
      )?.[1];
    const legacy: Record<string, string> = {
      '936': 'gb18030',
      '950': 'big5',
      '932': 'shift_jis',
      '949': 'euc-kr',
    };
    const encoding =
      page && (legacy[page] ?? (/^125[0-8]$/.test(page) ? 'windows-' + page : undefined));
    return encoding ? new TextDecoder(encoding).decode(bytes) : latin;
  }
}

export class UnsupportedDxfEntity extends Error {}

/** 与纸面平行的 OCS 使用 +Z 或 -Z；后者的 X 方向与 WCS 相反。 */
export function dxfNormal(tags: DxfTags): 1 | -1 {
  const x = dxfNumber(tags, 210, 0),
    y = dxfNumber(tags, 220, 0),
    z = dxfNumber(tags, 230, 1);
  if (!z || Math.hypot(x, y) > Math.abs(z) * 1e-8)
    throw new UnsupportedDxfEntity('对象不在二维纸面上');
  return z < 0 ? -1 : 1;
}
