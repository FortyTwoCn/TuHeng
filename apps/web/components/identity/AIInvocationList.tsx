'use client';
import { useState, useEffect } from 'react';
import type { listAIInvocations } from '../../../../packages/infrastructure/src/ai-records';
import { identityMessage } from './client';
type Result = Awaited<ReturnType<typeof listAIInvocations>>;
const taskNames: Record<string, string> = {
  'grading.assignment': '作业批改建议',
  'grading.selftest': '自测与错题练习',
  'admin.model-test': '管理员协议测试',
};
const states: Record<string, string> = {
  BLOCKED_CONFIG: '等待配置',
  QUEUED: '排队',
  RUNNING: '执行中',
  RETRYING: '等待重试',
  SUCCEEDED: '请求成功',
  FAILED: '请求失败',
};
export function InvocationList({ initialRunId = '' }: { initialRunId?: string }) {
  const [page, setPage] = useState(0),
    [filters, setFilters] = useState({
      schoolId: '',
      actorId: '',
      taskKey: '',
      providerId: '',
      status: '',
      from: '',
      to: '',
      runId: initialRunId,
    });
  const [data, setData] = useState<Result>(),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  function change(key: keyof typeof filters, value: string) {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(0);
  }
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ view: 'invocations', page: String(page), ...filters });
      if (filters.from) params.set('from', new Date(filters.from).toISOString());
      if (filters.to) params.set('to', new Date(filters.to).toISOString());
      void fetch('/api/ai?' + params, { signal: controller.signal, cache: 'no-store' })
        .then(async (r) => {
          const value = await r.json();
          if (!r.ok) throw new Error(value.error);
          setData(value);
          setError('');
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(e.message);
        });
    }, 180);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [filters, page, revision]);
  return (
    <section>
      <div className="configuration-toolbar">
        <h3>调用记录</h3>
        <button onClick={() => setRevision((v) => v + 1)}>刷新调用记录</button>
      </div>
      <p className="muted">
        记录每次外部请求尝试。Token
        未返回时显示“未知”；费用按快照单价估算。请求成功不代表教师已发布成绩。
      </p>
      <div className="invocation-filters">
        <label>
          调用模块
          <select value={filters.taskKey} onChange={(e) => change('taskKey', e.target.value)}>
            <option value="">全部模块</option>
            {Object.entries(taskNames).map(([key, title]) => (
              <option value={key} key={key}>
                {title}
              </option>
            ))}
          </select>
        </label>
        <label>
          调用供应商
          <select value={filters.providerId} onChange={(e) => change('providerId', e.target.value)}>
            <option value="">全部供应商</option>
            {data?.providers.map((p) => (
              <option value={p.id} key={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          调用状态
          <select value={filters.status} onChange={(e) => change('status', e.target.value)}>
            <option value="">全部状态</option>
            {Object.entries(states).map(([key, title]) => (
              <option key={key} value={key}>
                {title}
              </option>
            ))}
          </select>
        </label>
      </div>
      <details>
        <summary>时间与精确编号筛选</summary>
        <div className="invocation-filters">
          <label>
            开始时间
            <input
              type="datetime-local"
              value={filters.from}
              onChange={(e) => change('from', e.target.value)}
            />
          </label>
          <label>
            结束时间
            <input
              type="datetime-local"
              value={filters.to}
              onChange={(e) => change('to', e.target.value)}
            />
          </label>
          {(
            [
              ['schoolId', '学校 ID'],
              ['actorId', '账号 ID'],
              ['runId', '运行 ID'],
            ] as const
          ).map(([key, title]) => (
            <label key={key}>
              {title}
              <input value={filters[key]} onChange={(e) => change(key, e.target.value)} />
            </label>
          ))}
        </div>
      </details>
      <p className="muted">
        {data
          ? '更新于 ' +
            new Date(data.updatedAt).toLocaleString() +
            ' · 当前筛选共 ' +
            data.total +
            ' 次调用'
          : '正在读取调用记录…'}
      </p>
      {error && (
        <p role="alert" className="configuration-alert">
          读取失败，下面保留的记录可能不是最新：{error}
        </p>
      )}
      {data?.items.map((i) => (
        <details className="invocation-row" key={i.id}>
          <summary>
            <strong>{taskNames[i.taskKey] ?? i.taskKey}</strong>
            <span>{new Date(i.createdAt).toLocaleString()}</span>
            <span>
              {i.providerName} · {i.snapshot?.model ?? '未形成模型快照'}
            </span>
            <span>{states[i.status] ?? i.status}</span>
          </summary>
          <div className="invocation-detail">
            {i.errorCode && (
              <p className="configuration-alert">
                {identityMessage(i.errorCode)} · <code>{i.errorCode}</code>
              </p>
            )}
            <p>
              请求 {i.attempts} 次 · 输入 {i.inputTokens ?? '未知'} / 输出{' '}
              {i.outputTokens ?? '未知'} Token · 耗时 {i.durationMs ?? '未知'} ms
            </p>
            <p>
              估算费用：
              {i.estimatedCost === null
                ? '未知'
                : i.estimatedCost.toFixed(6) + ' ' + i.costCurrency}
              {i.snapshot?.pricing
                ? '（按模型配置 v' + i.snapshot.modelVersion + ' 单价估算）'
                : ''}
              {i.billingUncertain ? ' · 存在计费状态未知的请求' : ''}
            </p>
            <p className="code-ref">
              调用 {i.id}
              <br />
              运行 {i.runId ?? '无独立评分运行（如协议测试）'}
            </p>
            <details>
              <summary>版本快照与逐次记录</summary>
              <pre>
                {JSON.stringify(
                  {
                    invocationId: i.id,
                    runId: i.runId,
                    resourceId: i.resourceId,
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
          </div>
        </details>
      ))}
      {data && !data.items.length && <p className="empty-inline">当前筛选下没有调用记录。</p>}
      <div className="choice-pagination">
        <button disabled={!page} onClick={() => setPage((v) => v - 1)}>
          上一页调用
        </button>
        <span>第 {page + 1} 页</span>
        <button
          disabled={!data || (page + 1) * 30 >= data.total}
          onClick={() => setPage((v) => v + 1)}
        >
          下一页调用
        </button>
      </div>
    </section>
  );
}
