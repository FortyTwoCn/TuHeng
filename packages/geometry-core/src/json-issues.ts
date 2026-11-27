export type JsonIssue = {
  code: string;
  path: PropertyKey[];
  message: string;
  expected?: string;
  keys?: string[];
};

function jsonPath(parts: PropertyKey[]) {
  return parts.reduce<string>((path, part) => {
    if (typeof part === 'number') return `${path}[${part}]`;
    const key = String(part);
    return /^[\w$]+$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
  }, '$');
}

export function formatJsonIssue(issue: JsonIssue) {
  if (issue.code === 'unrecognized_keys' && issue.keys)
    return issue.keys.map((key) => `${jsonPath([...issue.path, key])} 字段未定义`).join('；');
  const location = jsonPath(issue.path);
  const types: Record<string, string> = {
    string: '字符串',
    number: '数字',
    int: '整数',
    array: '数组',
    object: '对象',
  };
  const details: Record<string, string> = {
    invalid_type: issue.message.endsWith('received undefined')
      ? '缺少必填字段'
      : `应为${types[issue.expected ?? ''] ?? '正确的数据类型'}`,
    invalid_value: '值不在契约允许的范围内，请核对版本或可选值',
    invalid_format: '字段格式无效，请按 Schema 填写',
    too_small: '值或长度小于允许下限，请核对 Schema',
    too_big: '值或长度超过允许上限，请核对 Schema',
  };
  return `${location} ${details[issue.code] ?? issue.message}`;
}
