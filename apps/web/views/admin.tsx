import Link from 'next/link';
import { JobsConsole } from '../components/identity/JobsConsole';
import { AICenter } from '../components/identity/AICenter';
import { prisma, database } from '@tuheng/database';
import { requireRole, type Actor } from '@tuheng/domain';
import { storageHealth } from '@tuheng/infrastructure';
import { Panel, PageTitle, Badge } from '@tuheng/ui';
import { Stat, date } from './shared';
export async function AdminDashboard({ a }: { a: Actor }) {
  requireRole(a, 'ADMIN', 'PLATFORM_OPERATOR');
  const [users, jobs, failed, classes] = await Promise.all([
    prisma.user.count(),
    prisma.backgroundJob.count(),
    prisma.backgroundJob.count({ where: { status: { in: ['FAILED', 'BLOCKED_CONFIG'] } } }),
    prisma.teachingClass.count(),
  ]);
  return (
    <>
      <PageTitle
        eyebrow="PLATFORM OPERATIONS"
        title="管理概览"
        description="维护账号、教学组织与任务运行。管理身份不默认开放学生原始作答。"
      />
      <div className="stats">
        <Stat title="平台用户" value={users} unit="人" foot="账户元信息统计" />
        <Stat title="教学班" value={classes} unit="个" foot="按课程开课实例组织" />
        <Stat title="批改任务" value={jobs} unit="个" foot="数据库权威任务记录" />
        <Stat title="需处理任务" value={failed} unit="个" foot="失败或配置阻塞" />
      </div>
      <div className="two-col">
        <Panel title="教学组织与账号">
          <Link className="list-item" href="/admin/users">
            <strong>用户管理</strong>
            <span>创建、导入、停用、角色与密码恢复 →</span>
          </Link>
          <Link className="list-item" href="/admin/organization">
            <strong>课程与教学组织</strong>
            <span>课程、学期、授课与选课关系 →</span>
          </Link>
        </Panel>
        <Panel title="运行与审计">
          <Link className="list-item" href="/admin/jobs">
            <strong>AI 任务管理</strong>
            <span>定位排队与失败原因 →</span>
          </Link>
          <Link className="list-item" href="/admin/models">
            <strong>模型状态</strong>
            <span>查看配置状态与视觉连接测试 →</span>
          </Link>
        </Panel>
      </div>
    </>
  );
}
export async function ModelsView({
  a,
  search = {},
}: {
  a: Actor;
  search?: Record<string, string | undefined>;
}) {
  requireRole(a, 'ADMIN');
  const returnTo =
    search.returnTo?.startsWith('/admin/jobs') && !search.returnTo.includes('\\\\')
      ? search.returnTo
      : undefined;
  return (
    <AICenter
      initialTab={search.tab}
      initialRunId={search.runId}
      initialTaskKey={search.taskKey}
      returnTo={returnTo}
    />
  );
}
export async function JobsView({
  a,
  search,
}: {
  a: Actor;
  search: Record<string, string | undefined>;
}) {
  requireRole(a, 'ADMIN', 'PLATFORM_OPERATOR');
  return <JobsConsole key={JSON.stringify(search)} initialSearch={search} />;
}
export async function AuditView({ a }: { a: Actor }) {
  requireRole(a, 'ADMIN', 'PLATFORM_OPERATOR');
  const logs = await database.list('auditLog', {}, { orderBy: 'createdAt', desc: true, take: 100 });
  return (
    <>
      <PageTitle
        eyebrow="AUDIT TRAIL"
        title="操作审计"
        description="记录业务状态变更，不记录密码、密钥、图像或完整模型响应。"
      />
      <Panel title="最近100条审计">
        <div className="table-scroll">
          <table className="score-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>操作</th>
                <th>操作者</th>
                <th>资源编号</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td>{date(l.createdAt)}</td>
                  <td>{l.action}</td>
                  <td className="code-ref">{l.actorId}</td>
                  <td className="code-ref">{l.resourceId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
export async function SystemView({ a }: { a: Actor }) {
  requireRole(a, 'ADMIN', 'PLATFORM_OPERATOR');
  const { Redis } = await import('ioredis');
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: 1,
    connectTimeout: 3000,
    lazyConnect: true,
  });
  const health = await Promise.allSettled([
    prisma.$queryRaw`SELECT 1`,
    storageHealth(),
    redis.ping(),
  ]);
  redis.disconnect();
  return (
    <>
      <PageTitle
        eyebrow="SYSTEM HEALTH"
        title="系统状态"
        description="当前依赖连接状态与运行限制。生产配置在服务端管理。"
      />
      <div className="two-col">
        <Panel title="依赖健康">
          {['PostgreSQL', 'S3 私有存储', 'Redis'].map((name, i) => (
            <div className="list-item" key={name}>
              <strong className="grow">{name}</strong>
              <Badge tone={health[i].status === 'fulfilled' ? 'green' : 'red'}>
                {health[i].status === 'fulfilled' ? '连接正常' : '连接异常'}
              </Badge>
            </div>
          ))}
        </Panel>
        <Panel title="基础限制与恢复">
          <p>单文件上限：{Number(process.env.UPLOAD_MAX_BYTES ?? 15728640) / 1024 / 1024} MB</p>
          <p>自测每日配额：{process.env.SELFTEST_DAILY_QUOTA ?? 20} 次</p>
          <p>支持 JPG、PNG 与 PDF 资料；学生作答使用图片。</p>
          <p className="muted small">
            备份：PostgreSQL pg_dump + 对象存储全量/版本备份。Redis
            为可恢复任务缓存。恢复时先还原数据库和对象，再启动 Worker，检查 outbox
            与过期租约。完整步骤见 docs/OPERATIONS.md。
          </p>
        </Panel>
      </div>
    </>
  );
}
