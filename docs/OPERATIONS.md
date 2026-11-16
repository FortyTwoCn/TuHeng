# 运行、部署与恢复

Node 22+，PostgreSQL 17、Redis 7、私有 S3。`docker compose up -d` 仅启动本地依赖，端口只绑定回环地址。当前沙箱无法拉取 MinIO 镜像，因此 Compose 的 `minio` 服务实际使用固定 digest 的 RustFS；应用为标准 S3 适配器，可配置真实 MinIO。生产须选择经组织验证的 S3 实现、私有网络和独立凭据，不直接公开本地控制台。

Prisma 6.19.3 采用 JS/WASM query compiler + pg driver，避开受限网络中的原生引擎下载。当前迁移 CLI 的 JS adapter 在本环境 PostgreSQL `name` 类型反序列化失败；因此 `npm run db:migrate` 使用 pg 执行 Prisma 生成的 SQL。迁移 runner 通过 advisory lock、事务、名称和 SHA-256 校验防止并发和历史脚本改写；记录表 `_tuheng_migrations`，不与 `_prisma_migrations` 混用。后续迁移用 `prisma migrate diff` 生成新目录的 SQL，审查后运行，绝不 reset。

## 局域网开发与平板访问

`npm run dev` 已监听 `0.0.0.0:3000`。本机与平板连接同一局域网，在本机忽略的 `.env` 配置实际可访问的地址，例如：

```dotenv
NEXTAUTH_URL=http://localhost:3000
APP_ALLOWED_ORIGINS=http://192.168.1.100:3000
```

重启开发服务器，平板打开 `http://192.168.1.100:3000/login`；这里的 IP 必须换成本机实际 IPv4。可用逗号添加多个明确的应用源，包含协议和端口；不接受通配符、账号信息或路径。不从 Host / X-Forwarded-Host 自动授予信任。IP 改变后更新配置并重启；不同地址的浏览器会话 Cookie 独立，需要分别登录。生产环境继续配置实际 HTTPS 主地址，保留原有安全 Cookie、CSRF 和账号/资源权限检查。

“网页能显示但登录无反应”先检查开发终端和浏览器的 HMR / `_next` 连接。Next 16.4 的开发来源检查使用 hostname；`next.config.ts` 从应用地址配置提供 `allowedDevOrigins`。保存/上传 API 则由 `lib/app-origins.ts` 按完整 origin 检查，未列入的源、缺失 Origin、不同端口继续拒绝。登录与退出使用当前页面的地址，NextAuth 只允许明确配置的目标，避免把平板重定向到它自己的 localhost。

普通 HTTP 局域网不是浏览器安全上下文，可能没有 `crypto.randomUUID`。公共 `createId` 使用 `crypto.getRandomValues` 生成 UUID v4，编辑器绘制/复制/拟合、建题、提交和教师批注复用该入口；不采用 Math.random，也不修改几何契约或历史对象 ID。登录表单明确使用 POST，防止脚本未启用时把密码写入 URL。

局域网回归可以使用已有的 Playwright 测试入口（先配置受信任源并准备隔离测试库/桶/队列）。例如 PowerShell：

```powershell
$env:TEST_APP_ORIGIN = 'http://192.168.1.100:3000'
npm run test:e2e -- --reporter=list
```

`TEST_APP_ORIGIN` 仅改变测试访问地址，不能替代服务器 `APP_ALLOWED_ORIGINS` 配置。网络登录用例覆盖横/竖屏登录、电子笔曲线 JSON、刷新会话、恶意来源拒绝、退出后仍停留在原 IP；完整套件还覆盖草稿、图片上传、正式提交和教师复核。真实平板网络、系统软键盘及手写笔硬件仍须在设备上验证。

## 配置与真实视觉模型

在管理员 AI 中心维护供应商、加密凭据、模型能力和 grading.assignment / grading.selftest 模块绑定。只选择已验证支持所需证据的模型；不因为接口兼容就推断支持图像或 JSON Schema。密钥主密钥由 TUHENG_SECRET_KEYS / TUHENG_SECRET_ACTIVE_KEY 独立部署，不能放进数据库。

model:sync 已停用，运行时无 AI_* 环境回退。AI 中心修改生成新版本并立即生效。管理员模型测试会产生实际调用，必须确认可能计费。历史 run 的配置保持不变；任务页“安全重试原配置”不切换版本，“使用当前配置新建运行”保留题目/答案/评分依据并生成新的 run。已发布教师成绩始终保留。

生产命令：`npm ci && npm run db:generate && npm run db:migrate && npm run build`，分别用进程管理器运行 `npm start` 和 `npm run worker`，健康检查 `/api/actions/health`（需管理员会话）。需要 TLS、请求体/上传频率限制、日志聚合与备份告警。默认保守并发：正式作业2，自测1；多 Worker 部署前配置全局预算，当前仅按进程控制并发。

## 备份与恢复

1. 定期 `pg_dump --format=custom`，加密保留并验证恢复；同时备份私有 bucket，保持对象与 DB 恢复点一致。
2. 恢复演练在空的隔离数据库用 `pg_restore`；恢复对象数据，验证 object key 引用后启动 web。
3. 再启动 Redis/Worker。未投递 outbox 重发，过期租约恢复，已投递但队列缺失的排队任务由补偿扫描重新投递。runId 确定 jobId，结果唯一约束避免重复建议。
4. 失败任务在管理员页核对错误码。不可读图片、无效输出进入人工复核；模型限流/超时有限退避重试3次。队列与 DB 都需要持久化；不要以清空数据库解决故障。
5. 审计记录保留教师决策、发布和更正。原始模型响应保存在受限 DB；未来需增加机构数据保留/删除策略。

## 集中提交压测

仅在无真实视觉 key 的本地数据库运行：

```sh
LOAD_CONFIRM=local-test-only LOAD_USERS=20 LOAD_CONCURRENCY=5 npm run load
# 本地容量实验可逐步增加至2000，不把小样本结果当作容量承诺
```

会真实建立 `[压测]` 独立课程、账号、S3 文件、不可变作答及任务，输出成功数和事务 p50/p95；不会创建模拟分数。测试数据明确标记，不自动删除其他业务数据。停止压测后可在管理员页停用测试账号。

Prisma JS adapter 的提交冲突释放行为由 `SafePrismaPg` 集中保护，`40001`/P2034 采用有限退避重试。此前压测发现 COMMIT 冲突后连接未释放，现有补丁保证仅释放一次；升级 ORM/驱动时应先跑提交压测与脚本退出检查，再评估移除补丁。尝试 Prisma 7.10.1 的 generate 仍需本环境被阻断的原生 schema-engine 下载，因此本轮固定使用已验证的 6.19.3，并在后续可联网环境重新评估升级。
