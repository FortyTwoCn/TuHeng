'use client';
import { useState, useEffect } from 'react';
import { Field } from './AIFields';
export function InvocationList() {
  const [page, setPage] = useState(0),
    [school, setSchool] = useState(''),
    [user, setUser] = useState(''),
    [task, setTask] = useState('');
  const [data, setData] = useState<{
      items: {
        id: string;
        taskKey: string;
        schoolId: string | null;
        actorId: string;
        status: string;
        errorCode: string | null;
        inputTokens: number | null;
        outputTokens: number | null;
        durationMs: number | null;
        estimatedCost: number | null;
        costCurrency: string | null;
        billingUncertain: boolean;
        attempts: number;
        snapshot: unknown;
        callAttempts: unknown[];
      }[];
      total: number;
    }>({ items: [], total: 0 }),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void fetch(
      `/api/ai?view=invocations&page=${page}&schoolId=${encodeURIComponent(school)}&actorId=${encodeURIComponent(user)}&taskKey=${encodeURIComponent(task)}`,
    )
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        if (active) setData(d);
      })
      .catch((e) => setError(e.message));
    return () => {
      active = false;
    };
  }, [page, school, user, task]);
  return (
    <section>
      <h3>调用与用量</h3>
      <p>Token 和费用未知时保留“未知”；费用为配置单价估算。重试逐次记录，超时可能已被计费。</p>
      <div className="identity-form">
        <Field title="学校 ID">
          <input
            value={school}
            onChange={(e) => {
              setSchool(e.target.value);
              setPage(0);
            }}
          />
        </Field>
        <Field title="账号 ID">
          <input
            value={user}
            onChange={(e) => {
              setUser(e.target.value);
              setPage(0);
            }}
          />
        </Field>
        <Field title="任务">
          <select
            value={task}
            onChange={(e) => {
              setTask(e.target.value);
              setPage(0);
            }}
          >
            <option value="">全部</option>
            <option>grading.assignment</option>
            <option>grading.selftest</option>
            <option>admin.model-test</option>
          </select>
        </Field>
      </div>
      {error && <p role="alert">{error}</p>}
      {data.items.map((i) => (
        <article className="panel" key={i.id}>
          <strong>
            {i.taskKey} · {i.status}
          </strong>
          <p>
            {i.errorCode} · 请求 {i.attempts} 次 · 输入 {i.inputTokens ?? '未知'} / 输出{' '}
            {i.outputTokens ?? '未知'} Token · {i.durationMs ?? '未知'} ms · 估算费用{' '}
            {i.estimatedCost === null ? '未知' : `${i.estimatedCost.toFixed(6)} ${i.costCurrency}`}
            {i.billingUncertain && ' · 存在计费状态未知的请求'}
          </p>
          <details>
            <summary>版本快照与逐次记录</summary>
            <pre>
              {JSON.stringify(
                {
                  invocationId: i.id,
                  schoolId: i.schoolId,
                  actorId: i.actorId,
                  snapshot: i.snapshot,
                  attempts: i.callAttempts,
                },
                null,
                2,
              )}
            </pre>
          </details>
        </article>
      ))}
      <div className="identity-pagination">
        <button disabled={!page} onClick={() => setPage(page - 1)}>
          上一页
        </button>
        <span>共 {data.total} 次调用</span>
        <button disabled={(page + 1) * 30 >= data.total} onClick={() => setPage(page + 1)}>
          下一页
        </button>
      </div>
    </section>
  );
}
