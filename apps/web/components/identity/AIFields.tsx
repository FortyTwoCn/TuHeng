'use client';
import type { ReactNode } from 'react';
import type { aiCenter } from '../../../../packages/infrastructure/src/ai-admin';
export type Center = Awaited<ReturnType<typeof aiCenter>>;
export const number = (f: FormData, key: string) => Number(f.get(key));
export const string = (f: FormData, key: string) => String(f.get(key) ?? '').trim();
export const yes = (f: FormData, key: string) => f.get(key) === 'on';
export function Field({ title, children }: { title: string; children: ReactNode }) {
  return (
    <label>
      {title}
      {children}
    </label>
  );
}
export function Num({
  name,
  value,
  title,
  min = 1,
  max = 1000000,
}: {
  name: string;
  value: number;
  title: string;
  min?: number;
  max?: number;
}) {
  return (
    <Field title={title}>
      <input name={name} type="number" min={min} max={max} defaultValue={value} required />
    </Field>
  );
}
export function Check({ name, value, title }: { name: string; value: boolean; title: string }) {
  return (
    <label className="checkbox-label">
      <input name={name} type="checkbox" defaultChecked={value} />
      {title}
    </label>
  );
}
export function Protocol({ value, inherit = false }: { value: string; inherit?: boolean }) {
  return (
    <Field title="API 协议">
      <select name="protocol" defaultValue={value}>
        {inherit && <option value="">继承供应商</option>}
        <option value="OPENAI_CHAT_COMPLETIONS">OpenAI Chat Completions</option>
        <option value="ANTHROPIC_MESSAGES">Anthropic Messages</option>
      </select>
    </Field>
  );
}
export function OutputMode({ value, name = 'outputMode' }: { value: string; name?: string }) {
  return (
    <Field title="输出模式">
      <select name={name} defaultValue={value}>
        <option value="json_schema">原生 JSON Schema</option>
        <option value="json_object">JSON 模式（OpenAI 协议）</option>
        <option value="prompt_json">提示词约定 JSON</option>
      </select>
    </Field>
  );
}
