import type { Vec2 } from '@tuheng/contracts';
import { add, arcPoint, angle, distance, sub } from './math';

const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
/** Presentation only. Keep full precision in the underlying drawing and measurements. */
export function formatCadAngle(degrees: number, decimals?: number): string {
  if (decimals === undefined) return Math.abs(degrees) < 1e-12 ? '0' : String(degrees);
  const rounded = degrees.toFixed(decimals);
  return Number(rounded) === 0 ? (0).toFixed(decimals) : rounded;
}
export function cadNumber(value: string | undefined, label: string, unit = '') {
  let text = (value ?? '').trim();
  if (unit && text.endsWith(unit)) text = text.slice(0, -unit.length).trim();
  if (!decimal.test(text) || !Number.isFinite(Number(text))) throw Error(`请输入有效的${label}`);
  return Number(text);
}
export function cadLength(value: string | undefined, label: string) {
  const text = (value ?? '').trim().toLowerCase();
  const unit = /(mm|cm|m)$/.exec(text)?.[0] ?? '';
  const factor = unit === 'cm' ? 10 : unit === 'm' ? 1000 : 1;
  const n = cadNumber(text, label, unit) * factor;
  if (n <= 0 || n > 10000) throw Error(`${label}须大于 0 且不超过 10000 mm`);
  return n;
}
/** Typed measurements are expressed in the active frame. The unspecified
 * component follows the located cursor (including orthogonal tracking). */
export function cadLineEndpoint(anchor: Vec2, cursor: Vec2, fields: { length?: string; angle?: string }) {
  if (fields.length === undefined && fields.angle === undefined) return cursor;
  const length = fields.length === undefined ? distance(anchor, cursor) : cadLength(fields.length, '长度');
  if (length <= 1e-8) throw Error('移动光标或输入大于零的长度');
  const degrees = fields.angle === undefined ? angle(sub(cursor, anchor)) : cadNumber(fields.angle, '角度', '°');
  return arcPoint(anchor, length, degrees);
}
export function parseCadCoordinate(value: string, anchor?: Vec2): Vec2 {
  const input = value.trim().replaceAll('，', ',').replaceAll('＠', '@').replaceAll('＜', '<');
  const relative = input.startsWith('@');
  const raw = relative ? input.slice(1) : input;
  if (relative && !anchor) throw Error('相对坐标需要先确定基点');
  let pos: Vec2;
  if (relative && raw.includes('<')) {
    const parts = raw.split('<');
    if (parts.length !== 2) throw Error('极坐标格式为 @距离<角度');
    pos = arcPoint(anchor!, cadLength(parts[0], '距离'), cadNumber(parts[1], '角度', '°'));
  } else {
    const parts = raw.split(',');
    if (parts.length !== 2) throw Error('坐标格式为 u,v 或 @du,dv');
    pos = { x: cadNumber(parts[0], 'u 坐标', 'mm'), y: cadNumber(parts[1], 'v 坐标', 'mm') };
    if (relative) pos = add(anchor!, pos);
  }
  if (Math.abs(pos.x) > 10000 || Math.abs(pos.y) > 10000) throw Error('坐标超出图纸范围');
  return pos;
}
