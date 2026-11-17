'use client';
import { useState } from 'react';
import { type Center } from './AIFields';
export function ModelTests({
  model,
  providerVersion,
  command,
  disabled,
}: {
  model: Center['models'][number];
  command: (body: Record<string, unknown>) => Promise<unknown>;
  disabled: boolean;
  providerVersion: number;
}) {
  const [cost, setCost] = useState(false),
    [mode, setMode] = useState('prompt_json');
  const tests = model.versions[0].testStatus as Record<
    string,
    { status: string; at: string; errorCode?: string; providerVersion: number; outputMode: string }
  >;
  return (
    <section className="configuration-tests">
      <h3>协议测试</h3>
      <p className="configuration-version">
        测试目标：{model.name} · 模型 v{model.currentVersion} · 供应商 v{providerVersion}
      </p>
      <p>发送无个人信息的最小样本，可能产生费用。测试通过仅证明此项协议行为，不能证明评分正确。</p>
      <label>
        <input type="checkbox" checked={cost} onChange={(e) => setCost(e.target.checked)} />
        我确认发起可能计费的真实请求
      </label>
      <label>
        测试输出模式
        <select value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="prompt_json">提示词 JSON</option>
          <option value="json_schema">原生 JSON Schema</option>
          <option value="json_object">JSON 模式</option>
        </select>
      </label>
      {[
        ['connection', '连通'],
        ['text', '最小文本'],
        ['image', '图片输入'],
        ['structured', '结构化输出'],
      ].map(([kind, label]) => (
        <div className="list-item" key={kind}>
          <span>
            {label}：
            {tests[kind]
              ? `${tests[kind].status} · ${tests[kind].at} · 供应商 v${tests[kind].providerVersion} · ${tests[kind].outputMode} · ${tests[kind].providerVersion !== providerVersion ? '历史证据，供应商配置已变化，需重新测试' : '对应当前版本'} · ${tests[kind].errorCode ?? ''}`
              : '未测试'}
          </span>
          <button
            disabled={disabled || !cost}
            onClick={() =>
              command({
                operation: 'test',
                modelId: model.id,
                kind,
                costConfirmed: true,
                outputMode: mode,
              })
            }
          >
            测试{label}
          </button>
        </div>
      ))}
    </section>
  );
}
