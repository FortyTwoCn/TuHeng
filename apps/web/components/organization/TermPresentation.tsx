import type { TermLifecycleStatus } from '@tuheng/contracts';

export const termStatusLabels: Record<TermLifecycleStatus, string> = {
  UPCOMING: '未开始',
  ACTIVE: '进行中',
  ENDED: '已结束',
};

const termTime = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Etc/GMT-8',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function TermPeriod({
  startsAt,
  endsAt,
}: {
  startsAt: Date | string;
  endsAt: Date | string;
}) {
  const start = new Date(startsAt),
    end = new Date(endsAt);
  return (
    <span className="org-term-period">
      <time dateTime={start.toISOString()}>{termTime.format(start)}</time>
      <span>至</span>
      <time dateTime={end.toISOString()}>{termTime.format(end)}</time>
    </span>
  );
}

export function TermStatusBadge({ status }: { status: TermLifecycleStatus }) {
  return (
    <span className="org-status" data-lifecycle={status}>
      {termStatusLabels[status]}
    </span>
  );
}

export function TermSummary({
  startsAt,
  endsAt,
  lifecycleStatus,
}: {
  startsAt: Date;
  endsAt: Date;
  lifecycleStatus: TermLifecycleStatus;
}) {
  return (
    <div className="org-term-summary">
      <TermStatusBadge status={lifecycleStatus} />
      <TermPeriod startsAt={startsAt} endsAt={endsAt} />
      <small>北京时间</small>
    </div>
  );
}
