'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { createId } from '@tuheng/contracts';
import { PageTitle } from '@tuheng/ui';
import type { listGradingJobs } from '../../../../packages/infrastructure/src/job-records';
import { Status, date } from '../../views/shared';
import { identityRequest, IdentityRequestError } from './client';
import { jobMessage } from './job-presentation';
import { Dialog } from './Dialog';
import { Reauthentication, type ReauthenticationHandle } from './Reauthentication';

type Data = Awaited<ReturnType<typeof listGradingJobs>>;
type Job = Data['items'][number];
type Filters = {
  q: string;
  lane: string;
  status: string;
  schoolId: string;
  from: string;
  to: string;
};
const blank: Filters = { q: '', lane: '', status: '', schoolId: '', from: '', to: '' };
const states = {
  QUEUED: '排队',
  RUNNING: '执行中',
  RETRYING: '等待重试',
  SUCCEEDED: '建议已生成',
  FAILED: '失败',
  BLOCKED_CONFIG: '待配置',
};
type Operation = { job: Job; kind: 'run-retry' | 'run-current-config'; requestId: string };
export function JobsConsole({
  initialSearch,
}: {
  initialSearch: Record<string, string | undefined>;
}) {
  const [filters, setFilters] = useState<Filters>({
      ...blank,
      ...Object.fromEntries(Object.keys(blank).map((key) => [key, initialSearch[key] ?? ''])),
    }),
    [page, setPage] = useState(Math.max(0, Number(initialSearch.page) || 0)),
    [data, setData] = useState<Data>(),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0),
    [selected, setSelected] = useState<Job | null>(null),
    [operation, setOperation] = useState<Operation | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [operationError, setOperationError] = useState('');
  const selectedRef = useRef<Job | null>(null);
  function selectJob(job: Job | null) {
    selectedRef.current = job;
    setSelected(job);
  }
  const pending = useRef(false),
    auth = useRef<ReauthenticationHandle>(null);
  const params = new URLSearchParams({ ...filters, page: String(page) });
  const returnTo = '/admin/jobs?' + params;
  const configLink = (job: Job) =>
    '/admin/models?' + new URLSearchParams({ tab: 'bindings', taskKey: job.taskKey, returnTo });
  const detail = data?.items.find((j) => j.id === selected?.id) ?? selected;
  useEffect(() => {
    let canceled = false,
      delay = 10000,
      timer: ReturnType<typeof setTimeout>,
      request: AbortController;
    async function load() {
      clearTimeout(timer);
      request?.abort();
      const controller = new AbortController();
      request = controller;
      if (document.hidden) return;
      try {
        const query = new URLSearchParams({ ...filters, page: String(page) });
        if (filters.from) query.set('from', new Date(filters.from).toISOString());
        if (filters.to) query.set('to', new Date(filters.to).toISOString());
        const next: Data = await identityRequest(
          '/api/admin/jobs?' + query,
          undefined,
          'STAFF',
          controller.signal,
        );
        if (!canceled && !controller.signal.aborted) {
          setData(next);
          setError('');
          const viewed = selectedRef.current;
          if (viewed && !next.items.some((item) => item.id === viewed.id)) {
            const current: Data = await identityRequest(
              '/api/admin/jobs?q=' + encodeURIComponent(viewed.runId),
              undefined,
              'STAFF',
              controller.signal,
            );
            if (!canceled && selectedRef.current?.id === viewed.id && current.items[0])
              selectJob(current.items[0]);
          }
          delay = 10000;
        }
      } catch (e) {
        if (!canceled && !controller.signal.aborted) {
          setError((e as Error).message);
          delay = Math.min(60000, delay * 2);
        }
      } finally {
        if (!canceled && !controller.signal.aborted && !document.hidden)
          timer = setTimeout(() => void load(), delay);
      }
    }
    const visibility = () => {
      if (document.hidden) {
        clearTimeout(timer);
        request?.abort();
      } else void load();
    };
    window.history.replaceState(
      window.history.state,
      '',
      '/admin/jobs?' + new URLSearchParams({ ...filters, page: String(page) }),
    );
    void load();
    document.addEventListener('visibilitychange', visibility);
    return () => {
      canceled = true;
      clearTimeout(timer);
      request?.abort();
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [filters, page, revision]);
  function ask(job: Job, kind: Operation['kind']) {
    setOperationError('');
    setOperation({ job, kind, requestId: createId() });
  }
  async function execute() {
    if (!operation || pending.current) return;
    pending.current = true;
    setBusy(true);
    setOperationError('');
    try {
      const proof = await auth.current?.request();
      if (!proof) return;
      const result = await identityRequest(
        '/api/actions/' + operation.kind,
        { id: operation.job.runId, requestId: operation.requestId, proof },
        'STAFF',
      );
      setMessage(
        operation.kind === 'run-retry'
          ? '已请求按原快照重试；实际进度请查看任务状态。'
          : '已创建新运行 ' + result.id + '，旧运行和正式成绩保持不变。',
      );
      setOperation(null);
      setRevision((v) => v + 1);
    } catch (e) {
      if (e instanceof IdentityRequestError && e.code === 'RECENT_AUTH_REQUIRED') {
        auth.current?.invalidate();
        void auth.current?.request();
      }
      setOperationError(
        e instanceof IdentityRequestError
          ? jobMessage(e.code)
          : '请求结果暂不明确，请先刷新核对。再次确认会复用同一操作编号，避免重复创建。',
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const actions = (job: Job, compact = false) => (
    <div className="identity-inline job-actions">
      {job.actions.retryOriginal.allowed && (
        <button type="button" disabled={busy} onClick={() => ask(job, 'run-retry')}>
          按原配置重试
        </button>
      )}
      {job.actions.newCurrent.allowed && (!compact || !job.actions.retryOriginal.allowed) && (
        <button type="button" disabled={busy} onClick={() => ask(job, 'run-current-config')}>
          使用当前配置新建运行
        </button>
      )}
      {data?.manageable &&
        (!compact || (!job.actions.retryOriginal.allowed && !job.actions.newCurrent.allowed)) && (
          <Link className="button secondary" href={configLink(job)}>
            核对模块配置
          </Link>
        )}
    </div>
  );
  return (
    <section className="identity-console jobs-console">
      <PageTitle
        eyebrow="后台运行"
        title="AI 任务管理"
        description="跟踪建议生成与运行诊断。AI 执行成功不代表教师已发布正式成绩。"
      />
      <div className="configuration-toolbar">
        <p className="muted">
          数据更新时间：{data ? date(data.updatedAt) + '（北京时间）' : '等待读取'} · 页面可见时每
          10 秒刷新，失败时退避。
        </p>
        <div className="identity-inline">
          <button onClick={() => setRevision((v) => v + 1)}>刷新任务</button>
          <Reauthentication ref={auth} />
        </div>
      </div>
      {error && (
        <p role="alert" className="configuration-alert">
          读取失败：{error}。{data ? '以下缓存记录可能不是最新。' : '尚未取得任务记录。'}
        </p>
      )}
      {message && (
        <p role="status" className="configuration-alert">
          {message}
        </p>
      )}
      <form
        className="job-filters invocation-filters"
        key={JSON.stringify(filters)}
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setFilters(
            Object.fromEntries(
              Object.keys(blank).map((key) => [key, String(f.get(key) ?? '')]),
            ) as Filters,
          );
          setPage(0);
        }}
      >
        <label>
          运行或作答编号（精确）
          <input name="q" defaultValue={filters.q} />
        </label>
        <label>
          任务来源
          <select name="lane" defaultValue={filters.lane}>
            <option value="">全部来源</option>
            <option value="formal">课程作业</option>
            <option value="selftest">自测与错题</option>
          </select>
        </label>
        <label>
          任务状态
          <select name="status" defaultValue={filters.status}>
            <option value="">全部状态</option>
            {Object.entries(states).map(([value, name]) => (
              <option key={value} value={value}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <details className="job-filter-more">
          <summary>创建时间与学校范围</summary>
          <div className="invocation-filters">
            <label>
              创建时间起（当前设备时区）
              <input name="from" type="datetime-local" defaultValue={filters.from} />
            </label>
            <label>
              创建时间止（当前设备时区）
              <input name="to" type="datetime-local" defaultValue={filters.to} />
            </label>
            <label>
              学校 ID（精确）
              <input name="schoolId" defaultValue={filters.schoolId} />
            </label>
          </div>
        </details>
        <div className="identity-inline">
          <button className="button primary">筛选任务</button>
          <button
            type="button"
            onClick={() => {
              setFilters({ ...blank });
              setPage(0);
            }}
          >
            重置筛选
          </button>
        </div>
      </form>
      {data && (
        <>
          <div className="job-counts" aria-label="当前筛选统计">
            <strong>当前筛选共 {data.total} 个任务</strong>
            {data.counts.map((c) => (
              <span key={c.status}>
                <Status status={c.status} /> {c.count}
              </span>
            ))}
          </div>
          <div className="job-list">
            {data.items.map((job) => (
              <article className="job-row" key={job.id} data-run-id={job.runId}>
                <button
                  className="job-select"
                  aria-expanded={selected?.id === job.id}
                  onClick={() => selectJob(job)}
                >
                  <strong>{job.title}</strong>
                  <span>
                    {job.taskName} · {job.schoolName}
                  </span>
                  <small>
                    运行 {job.runId.slice(0, 8)} · 作答 {job.attemptId.slice(0, 8)}
                  </small>
                </button>
                <div>
                  <Status status={job.status} />
                  <p className="muted">
                    {job.snapshot
                      ? job.snapshot.model + ' · 模型 v' + job.snapshot.modelVersion
                      : '尚无模型快照'}
                  </p>
                </div>
                <div>
                  <small>更新 {date(job.updatedAt)}</small>
                  <p>本轮执行 {job.attempts} 次</p>
                  {job.errorCode && <p className="job-error">{jobMessage(job.errorCode)}</p>}
                </div>
                {actions(job, true)}
              </article>
            ))}
          </div>
          {!data.items.length && <p>当前筛选下没有任务。</p>}
          <div className="identity-inline">
            <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              上一页任务
            </button>
            <span>第 {page + 1} 页 · 每页 30 项</span>
            <button disabled={(page + 1) * 30 >= data.total} onClick={() => setPage((p) => p + 1)}>
              下一页任务
            </button>
          </div>
        </>
      )}
      <Dialog open={!!detail} title="任务详情" drawer onClose={() => selectJob(null)}>
        {detail && (
          <div className="job-detail">
            <div className="configuration-toolbar">
              <h3>{detail.title}</h3>
              <button onClick={() => setRevision((v) => v + 1)}>刷新此任务</button>
            </div>
            <Status status={detail.status} />
            {!data?.items.some((j) => j.id === detail.id) && (
              <p className="configuration-alert">
                此任务已不在当前页或筛选范围中，详情已按运行编号单独读取。列表筛选保持不变。
              </p>
            )}
            <p>
              {detail.taskName} · {detail.schoolName}
            </p>
            <dl>
              <dt>运行编号</dt>
              <dd>{detail.runId}</dd>
              <dt>作答编号 / 版本</dt>
              <dd>
                {detail.attemptId} / v{detail.attemptVersion}
              </dd>
              <dt>模块</dt>
              <dd>{detail.taskKey}</dd>
              <dt>创建 / 开始 / 结束（北京时间）</dt>
              <dd>
                {date(detail.createdAt)} / {detail.startedAt ? date(detail.startedAt) : '尚未开始'}{' '}
                / {detail.finishedAt ? date(detail.finishedAt) : '尚未结束'}
              </dd>
              <dt>题目版本</dt>
              <dd>
                v{detail.questionVersion} · {detail.questionVersionId}
              </dd>
              <dt>输入 / 输出契约</dt>
              <dd>
                {detail.inputVersion} / {detail.outputVersion}
              </dd>
              <dt>策略 / 提示词版本</dt>
              <dd>
                {detail.strategyVersion} / {detail.promptVersion}
              </dd>
              <dt>实际模型</dt>
              <dd>
                {detail.snapshot
                  ? detail.snapshot.model +
                    ' · 模型 v' +
                    detail.snapshot.modelVersion +
                    ' · 供应商 v' +
                    detail.snapshot.providerVersion +
                    ' · 规则 v' +
                    detail.snapshot.bindingVersion
                  : '没有可用快照'}
              </dd>
              <dt>正式成绩</dt>
              <dd>
                {detail.officialGradePublished
                  ? '已有正式成绩；以下操作不会覆盖。'
                  : '尚未发布；AI 操作不会自动发布。'}
              </dd>
            </dl>
            {detail.errorCode && (
              <div className="configuration-alert">
                <p>{jobMessage(detail.errorCode)}</p>
                <label>
                  错误码
                  <input readOnly value={detail.errorCode} onFocus={(e) => e.target.select()} />
                </label>
              </div>
            )}
            {!detail.actions.retryOriginal.allowed && (
              <p>原配置重试：{jobMessage(detail.actions.retryOriginal.reason)}</p>
            )}
            {!detail.actions.newCurrent.allowed && (
              <p>新运行：{jobMessage(detail.actions.newCurrent.reason)}</p>
            )}
            {actions(detail)}
            <Link
              className="button secondary"
              href={
                '/admin/models?' +
                new URLSearchParams({ tab: 'calls', runId: detail.runId, returnTo })
              }
            >
              查看对应调用记录
            </Link>
            <details>
              <summary>配置引用与关联运行</summary>
              <p>
                {detail.snapshot
                  ? '供应商 ' +
                    detail.snapshot.providerId +
                    ' · 模型 ' +
                    detail.snapshot.modelId +
                    ' · 规则 ' +
                    detail.snapshot.bindingId
                  : '无快照引用'}
              </p>
              {detail.previousRunId && (
                <p>
                  原运行：
                  <Link href={'/admin/jobs?q=' + detail.previousRunId}>{detail.previousRunId}</Link>
                </p>
              )}
              {detail.nextRunIds.map((id) => (
                <p key={id}>
                  后续运行：<Link href={'/admin/jobs?q=' + id}>{id}</Link>
                </p>
              ))}
            </details>
          </div>
        )}
      </Dialog>
      <Dialog
        open={!!operation}
        title={operation?.kind === 'run-retry' ? '确认按原配置重试' : '确认新建运行'}
        busy={busy}
        onClose={() => setOperation(null)}
      >
        {operation && (
          <>
            <p>运行 {operation.job.runId}</p>
            <p>
              {operation.kind === 'run-retry'
                ? '保留原题目、模型和策略快照，再次请求执行。'
                : '以当前模块配置创建新运行 ID；原运行和历史建议继续保留。'}
            </p>
            <p>可能产生新的模型调用费用，不覆盖教师正式成绩。服务器会重新核对状态、权限与凭据。</p>
            {operationError && <p role="alert">{operationError}</p>}
            <div className="dialog-actions">
              <button disabled={busy} onClick={() => setOperation(null)}>
                取消
              </button>
              <button className="button primary" disabled={busy} onClick={() => void execute()}>
                确认执行
              </button>
            </div>
          </>
        )}
      </Dialog>
    </section>
  );
}
