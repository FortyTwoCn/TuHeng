import Link from 'next/link';
import { prisma, database } from '@tuheng/database';
import { requireRole, type Actor } from '@tuheng/domain';
import { modelStatus, storageHealth } from '@tuheng/infrastructure';
import { Panel, PageTitle, Empty, Badge } from '@tuheng/ui';
import { ActionButton, ModelTest } from '../components/Actions';
import { UserCreate, UserManage, OrganizationForm, ImportUsers } from '../components/AdminForms';
import { Stat, Status, date } from './shared';
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
export async function UsersView({
  a,
  search,
}: {
  a: Actor;
  search: Record<string, string | undefined>;
}) {
  requireRole(a, 'ADMIN');
  const users = await prisma.user.findMany({
    where: {
      ...(search.q
        ? {
            OR: [
              { email: { contains: search.q, mode: 'insensitive' } },
              { name: { contains: search.q } },
            ],
          }
        : {}),
      ...(search.role ? { roles: { has: search.role } } : {}),
    },
    select: { id: true, email: true, name: true, active: true, roles: true },
    take: 100,
    orderBy: { createdAt: 'desc' },
  });
  return (
    <>
      <PageTitle
        eyebrow="IDENTITY & ACCESS"
        title="用户管理"
        description="密码仅保存哈希。停用或调整权限后，旧会话立即失效。"
      />
      <form className="filterbar">
        <input
          name="q"
          placeholder="搜索姓名或邮箱"
          aria-label="搜索用户"
          defaultValue={search.q}
        />
        <select name="role" defaultValue={search.role} aria-label="筛选角色">
          <option value="">全部角色</option>
          {[
            'STUDENT',
            'TEACHER',
            'TEACHING_ASSISTANT',
            'COURSE_MANAGER',
            'ADMIN',
            'PLATFORM_OPERATOR',
          ].map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
        <button className="button secondary">搜索</button>
      </form>
      <Panel title={`用户列表 · 显示 ${users.length} 条（最多100条）`}>
        {users.map((u) => (
          <div className="list-item" key={u.id}>
            <div className="grow">
              <strong>
                {u.name} · {u.email}
              </strong>
              <p>{u.roles.join(' · ')}</p>
              {u.id !== a.id && <UserManage id={u.id} roles={u.roles} />}
            </div>
            <Badge tone={u.active ? 'green' : 'gray'}>{u.active ? '已启用' : '已停用'}</Badge>
            {u.id !== a.id && (
              <ActionButton
                name="user-update"
                data={{ id: u.id, active: !u.active }}
                confirm={u.active ? '停用后该用户会话立即失效，是否继续？' : undefined}
              >
                {u.active ? '停用' : '启用'}
              </ActionButton>
            )}
          </div>
        ))}
      </Panel>
      <UserCreate />
      <ImportUsers />
    </>
  );
}
export async function OrganizationView({ a }: { a: Actor }) {
  requireRole(a, 'ADMIN');
  const [courses, offerings, classes, users] = await Promise.all([
    database.list('course'),
    database.list('courseOffering'),
    database.list('teachingClass'),
    prisma.user.findMany({ select: { id: true, name: true } }),
  ]);
  return (
    <>
      <PageTitle
        eyebrow="COURSES & ORGANIZATION"
        title="课程与教学组织"
        description="课程、学期中的开课实例、教学班、授课授权和选课关系分开维护。"
      />
      <div className="two-col">
        <OrganizationForm courses={courses} offerings={offerings} classes={classes} users={users} />
        <Panel title="教学组织结构">
          {courses.map((c) => (
            <div key={c.id}>
              <h3>
                {c.title} <Badge>{c.code}</Badge>
              </h3>
              {offerings
                .filter((o) => o.courseId === c.id)
                .map((o) => (
                  <div className="criterion-editor" key={o.id}>
                    <strong>{o.term}</strong>
                    {classes
                      .filter((c) => c.offeringId === o.id)
                      .map((c) => (
                        <p key={c.id}>{c.name}</p>
                      ))}
                  </div>
                ))}
            </div>
          ))}
        </Panel>
      </div>
    </>
  );
}
export async function ModelsView({ a }: { a: Actor }) {
  const c = await modelStatus(a);
  return (
    <>
      <PageTitle
        eyebrow="VISION MODEL CONFIGURATION"
        title="AI 模型配置"
        description="模型配置按版本固定在运行中。密钥只读取服务端环境变量。"
      />
      <div className="two-col">
        <Panel title="当前配置">
          <table className="score-table">
            <tbody>
              {[
                ['Provider', c.provider],
                ['API Base URL', c.baseUrl],
                ['模型 ID', c.model || '尚未设置'],
                ['结构化输出', c.outputMode],
                ['超时', `${c.timeoutMs} ms`],
                ['正式作业并发预算', String(c.concurrency)],
                ['密钥状态', c.keyConfigured ? '已配置（不返回密钥）' : '尚未配置'],
              ].map(([k, v]) => (
                <tr key={k}>
                  <td>{k}</td>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="alert">
            未配置视觉模型时，不生成 AI 分数。当前环境的其他模型凭据不会被自动当作视觉凭据使用。
          </div>
          <ModelTest />
        </Panel>
        <Panel title="调用状态统计">
          {c.usage.map((row) => (
            <div className="list-item" key={row.status}>
              <Status status={row.status} />
              <strong>{row._count} 次</strong>
            </div>
          ))}
          <p className="muted small">
            模型配置从环境建立版本快照。切换配置请按运维文档执行配置同步命令。
          </p>
        </Panel>
      </div>
    </>
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
  const jobs = await prisma.backgroundJob.findMany({
    where: {
      ...(search.status ? { status: search.status } : {}),
      ...(search.q ? { OR: [{ runId: search.q }, { run: { attemptId: search.q } }] } : {}),
    },
    include: {
      run: {
        select: {
          attemptId: true,
          startedAt: true,
          finishedAt: true,
          configId: true,
          promptVersion: true,
          strategyVersion: true,
        },
      },
    },
    orderBy: { updatedAt: 'desc' },
    take: 100,
  });
  return (
    <>
      <PageTitle
        eyebrow="QUEUE & RECOVERY"
        title="AI 任务管理"
        description="依据运行编号或作答编号定位。重试沿用原始题目与模型配置版本。"
      />
      <form className="filterbar">
        <input name="q" placeholder="精确运行编号或作答编号" defaultValue={search.q} />
        <select name="status" defaultValue={search.status}>
          <option value="">全部状态</option>
          {['QUEUED', 'RUNNING', 'SUCCEEDED', 'BLOCKED_CONFIG', 'FAILED', 'RETRYING'].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <button className="button secondary">筛选</button>
      </form>
      <Panel title="后台任务（最近100条）">
        {jobs.length ? (
          jobs.map((job) => (
            <details className="details-card" key={job.id}>
              <summary>
                <Status status={job.status} /> {job.lane === 'formal' ? '正式作业' : '个人自测'} ·
                运行 {job.runId.slice(0, 8)}
              </summary>
              <div>
                <p className="code-ref">
                  运行 {job.runId}
                  <br />
                  作答 {job.run.attemptId}
                </p>
                <p>
                  执行 {job.attempts} 次 · 错误 {job.errorCode ?? '无'} · 最近更新{' '}
                  {date(job.updatedAt)}
                </p>
                <p className="code-ref">
                  {job.run.promptVersion} · {job.run.strategyVersion}
                  <br />
                  配置 {job.run.configId}
                </p>
                {job.run.startedAt && job.run.finishedAt && (
                  <p>
                    最近运行耗时 {job.run.finishedAt.getTime() - job.run.startedAt.getTime()} ms
                  </p>
                )}
                {['FAILED', 'BLOCKED_CONFIG'].includes(job.status) && (
                  <ActionButton name="run-retry" data={{ id: job.runId }}>
                    安全重试原配置
                  </ActionButton>
                )}
                {['FAILED', 'BLOCKED_CONFIG', 'SUCCEEDED'].includes(job.status) && (
                  <ActionButton
                    name="run-current-config"
                    data={{ id: job.runId }}
                    confirm="将使用当前模型配置创建新运行；历史建议与正式成绩保留。"
                  >
                    使用当前配置新建运行
                  </ActionButton>
                )}
              </div>
            </details>
          ))
        ) : (
          <Empty title="没有匹配的任务" description="学生正式提交后，后台任务会显示在这里。" />
        )}
      </Panel>
    </>
  );
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
