import { GEOMETRY_DOCUMENT_MAX_BYTES, GeometryDocument } from '@tuheng/contracts';

const utf8 = new TextEncoder();

export const validateGeometryDocument = (input: unknown) => GeometryDocument.safeParse(input);

export function readGeometryJson(text: string): unknown {
  if (utf8.encode(text).length > GEOMETRY_DOCUMENT_MAX_BYTES) {
    throw new Error('几何文档超过 2MB');
  }
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw new Error('JSON 语法无效，请检查引号、逗号和括号。');
  }
}

export function parseGeometryDocument(input: unknown): GeometryDocument {
  const result = validateGeometryDocument(input);
  if (result.success) return result.data;

  // 字段路径便于从导入错误直接定位 AI 生成内容。数组下标从 0 开始。
  const details = result.error.issues.slice(0, 3).map(({ path, message }) => {
    const location = path.reduce<string>(
      (key, part) => (typeof part === 'number' ? `${key}[${part}]` : `${key}.${String(part)}`),
      '$',
    );
    return `${location} ${message}`;
  });
  throw new Error(details.join('；'));
}

export function loadGeometryDocument(text: string): GeometryDocument {
  return parseGeometryDocument(readGeometryJson(text));
}

function isScalar(value: unknown) {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function formatJson(value: unknown, depth = 0): string {
  const indent = '  '.repeat(depth);
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    if (value.length <= 8 && value.every(isScalar)) {
      const inline = `[${value.map((item) => JSON.stringify(item)).join(', ')}]`;
      if (inline.length <= 72) return inline;
    }
    const items = value.map((item) => `${indent}  ${formatJson(item, depth + 1)}`);
    return `[\n${items.join(',\n')}\n${indent}]`;
  }
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';

  const fields = Object.entries(value).filter(([, field]) => field !== undefined);
  if (!fields.length) return '{}';
  // 坐标和笔迹采样按点成行，便于对照多段线和样条的形状。
  const vector =
    'x' in value &&
    'y' in value &&
    fields.length <= 3 &&
    fields.every(
      ([key, number]) => ['x', 'y', 'z', 'pressure'].includes(key) && typeof number === 'number',
    );
  const entries = fields.map(
    ([key, field]) => `${JSON.stringify(key)}: ${formatJson(field, depth + 1)}`,
  );
  if (vector) return `{ ${entries.join(', ')} }`;
  return `{\n${entries.map((entry) => `${indent}  ${entry}`).join(',\n')}\n${indent}}`;
}

/** 字段值、数字精度和数组顺序保持原样。文件中的实体优先展示 ID 和类型。 */
export function serializeGeometryDocument(document: GeometryDocument): string {
  const validated = GeometryDocument.parse(document);
  const entities = validated.entities.map(({ id, kind, ...fields }) => ({ id, kind, ...fields }));
  const formatted = `${formatJson({ ...validated, entities })}\n`;
  if (utf8.encode(formatted).length <= GEOMETRY_DOCUMENT_MAX_BYTES) return formatted;

  // 临近大小上限的图纸使用紧凑排版，使同一文件仍能导入。
  return JSON.stringify({ ...validated, entities });
}
