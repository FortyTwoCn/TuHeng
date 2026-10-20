import Link from 'next/link';
import { Badge, Panel, Empty } from '@tuheng/ui';
import { formatPoints, type GradingResult } from '@tuheng/contracts';
import { ClipboardList, ArrowUpRight, Clock3 } from 'lucide-react';
export const date = (d: Date | string) =>
  new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(d));
export function Status({ status }: { status: string }) {
  const labels: Record<string, [string, string]> = {
    DRAFT: ['草稿', 'gray'],
    PUBLISHED: ['已发布', 'green'],
    QUEUED: ['排队中', 'blue'],
    RUNNING: ['分析中', 'blue'],
    SUCCEEDED: ['建议已生成', 'green'],
    FAILED: ['处理失败', 'red'],
    BLOCKED_CONFIG: ['待配置视觉模型', 'amber'],
    RETRYING: ['等待重试', 'amber'],
    OPEN: ['待处理', 'amber'],
    RESOLVED: ['已处理', 'green'],
  };
  const [label, tone] = labels[status] ?? [status, 'gray'];
  return <Badge tone={tone}>{label}</Badge>;
}
export function AssignmentCard({
  assignment,
  area,
  className,
  count,
  completed,
}: {
  assignment: { id: string; title: string; status: string; startsAt: Date; dueAt: Date };
  area: string;
  className: string;
  count?: number;
  completed?: number;
}) {
  return (
    <article className="assignment-card">
      <div className="card-meta">
        <Badge>课程作业</Badge>
        <Status status={assignment.status} />
        <span className="muted">{className}</span>
      </div>
      <h3>
        <Link href={`/${area}/assignments/${assignment.id}`}>{assignment.title}</Link>
      </h3>
      <p>
        开始 {date(assignment.startsAt)} · 截止 {date(assignment.dueAt)}（北京时间）
      </p>
      <div className="card-footer">
        <span>
          <Clock3 size={12} /> {new Date() > assignment.dueAt ? '已截止' : '进行中'}
        </span>
        {count !== undefined && (
          <span>
            {count} 道题目 · 已提交 {completed ?? 0} 题
          </span>
        )}
        <Link className="button secondary" href={`/${area}/assignments/${assignment.id}`}>
          {area === 'teacher' ? '管理作业' : '查看作业'}
          <ArrowUpRight size={13} />
        </Link>
      </div>
    </article>
  );
}
export function Stat({
  title,
  value,
  unit,
  foot,
}: {
  title: string;
  value: string | number;
  unit?: string;
  foot: string;
}) {
  return (
    <div className="stat">
      <div className="stat-top">
        <span>{title}</span>
        <ClipboardList />
      </div>
      <div className="stat-value">
        {value}
        <small>{unit}</small>
      </div>
      <div className="stat-foot">{foot}</div>
    </div>
  );
}
export function SuggestionReport({ result }: { result: GradingResult }) {
  return (
    <>
      <div className="panel-heading">
        <h2>AI 批改建议</h2>
        <Badge tone="amber">待教师确认</Badge>
      </div>
      <div className="result-score">
        {formatPoints(result.totalPoints)} <small>/ {formatPoints(result.maxPoints)}</small>
      </div>
      <div className="alert">{result.reviewReasons.join('；')}</div>
      <ScoreTable items={result.items} />
      <h3>识别到的正确部分</h3>
      {result.correctParts.length ? (
        <ul>
          {result.correctParts.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      ) : (
        <p className="muted">没有足够证据。</p>
      )}
      <h3>错误诊断与修改建议</h3>
      {result.errors.map((e) => (
        <div className="diagnosis" key={e.id}>
          <h3>
            {e.name} <Badge tone="amber">{e.severity}</Badge>
          </h3>
          <p>
            <strong>作答证据：</strong>
            {e.evidence}
          </p>
          <p>
            <strong>原因：</strong>
            {e.explanation}
          </p>
          <p>
            <strong>正确关系：</strong>
            {e.correctRelation}
          </p>
          <p>
            <strong>建议：</strong>
            {e.suggestion}
          </p>
        </div>
      ))}
      <p>{result.guidance}</p>
      <details>
        <summary>题意理解与版本依据</summary>
        <p>{result.analysis.requirements.join('；')}</p>
        <p>{result.analysis.relations.join('；')}</p>
        <p>等价解法：{result.analysis.equivalentMethods.join('；')}</p>
        <p className="code-ref">
          模型 {result.versions.model} · 提示词 {result.versions.prompt} · 策略{' '}
          {result.versions.strategy} · 耗时 {result.usage.durationMs}ms
        </p>
      </details>
    </>
  );
}
export function ScoreTable({
  items,
}: {
  items: {
    criterionId: string;
    points: number | null;
    maxPoints?: number;
    evidence: string;
    explanation?: string;
  }[];
}) {
  return (
    <div className="table-scroll">
      <table className="score-table">
        <thead>
          <tr>
            <th>评分项</th>
            <th>判分证据</th>
            <th>得分</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.criterionId}>
              <td>{i.criterionId}</td>
              <td>
                {i.evidence}
                {i.explanation && <p className="small muted">{i.explanation}</p>}
              </td>
              <td>
                {formatPoints(i.points)}
                {i.maxPoints !== undefined && ` / ${formatPoints(i.maxPoints)}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function NoAssignments() {
  return (
    <Panel>
      <Empty
        title="暂时没有作业"
        description="教师发布后，作业会出现在这里。所有状态来自实际教学记录。"
      />
    </Panel>
  );
}
