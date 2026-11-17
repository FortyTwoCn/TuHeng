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

生产命令：`npm ci && npm run db:generate && npm run db:migrate && npm run build`，分别用进程管理器运行 `npm start` 和 `npm run worker`，健康检查 `/api/actions/health`（需管理员会话）。需要 TLS、请求体/上传频率限制、日志聚合与备份告警。默认每进程 Worker 并发：正式作业 4、自测 2；实际模型调用另外受 Redis 共享的供应商总并发及模块/学校/个人日预算限制，多 Worker 不会各自重复放大供应商配额。

## 备份与恢复

1. 定期 `pg_dump --format=custom`，加密保留并验证恢复；同时备份私有 bucket，保持对象与 DB 恢复点一致。
2. 恢复演练在空的隔离数据库用 `pg_restore`；恢复对象数据，验证 object key 引用后启动 web。
3. 再启动 Redis/Worker。未投递 outbox 重发，过期租约恢复，已投递但队列缺失的排队任务由补偿扫描重新投递。runId 确定 jobId，结果唯一约束避免重复建议。
4. 失败任务在管理员页核对错误码。不可读图片、无效输出进入人工复核；模型限流/超时有限退避重试3次。队列与 DB 都需要持久化；不要以清空数据库解决故障。
5. 审计记录保留教师决策、发布和更正。归一化评分与必要模型证据保存在受限 DB；未来需增加机构数据保留/删除策略。

## 集中提交压测

仅在无真实视觉 key 的本地数据库运行：

```sh
LOAD_CONFIRM=local-test-only LOAD_USERS=20 LOAD_CONCURRENCY=5 npm run load
# 本地容量实验可逐步增加至2000，不把小样本结果当作容量承诺
```

会真实建立 `[压测]` 独立课程、账号、S3 文件、不可变作答及任务，输出成功数和事务 p50/p95；不会创建模拟分数。测试数据明确标记，不自动删除其他业务数据。停止压测后可在管理员页停用测试账号。

Prisma JS adapter 的提交冲突释放行为由 `SafePrismaPg` 集中保护，`40001`/P2034 采用有限退避重试。此前压测发现 COMMIT 冲突后连接未释放，现有补丁保证仅释放一次；升级 ORM/驱动时应先跑提交压测与脚本退出检查，再评估移除补丁。尝试 Prisma 7.10.1 的 generate 仍需本环境被阻断的原生 schema-engine 下载，因此本轮固定使用已验证的 6.19.3，并在后续可联网环境重新评估升级。

## 身份安装与密钥恢复

- 新部署：`npm run identity:secrets -- --initialize` 在本机 git 忽略的 .env 初始化随机 32 字节主密钥；已有配置不替换。生产也可由 Secret/KMS 注入同名环境变量。
- `npm run identity:bootstrap -- --output .runtime/admin-delivery.txt` 仅在没有根账号时创建 admin；重复执行拒绝并保持凭据不变。文件以当前 Windows 用户和 SYSTEM 的受限 ACL 创建，安全交付后删除。管理员完成首次改密后直接进入后台，不强制绑定邮箱；SMTP 通过后台“系统设置 → 邮件服务”配置，个人邮箱可在“账号安全”自愿绑定。学校和教师仍须验证邮箱。
- 根账号密码恢复：`npm run identity:bootstrap -- --reset-root --output .runtime/admin-recovery.txt`，生成新随机临时密码、撤销旧会话并审计；保留已验证邮箱。服务器恢复权限不可授予普通学校/教师。
- 丢失根账号邮箱：在服务器执行 `npm run identity:bootstrap -- --reset-root --recover-mailbox --output .runtime/admin-mailbox-recovery.txt`。这是独立审计的邮箱恢复动作，清除根账号邮箱绑定、撤销会话、重新要求改密；完成改密后可进入后台，是否重新绑定邮箱由管理员决定。不允许通过网页对其他账号调用。
- SMTP 修改、初始凭据导出、AI 密钥操作要求近期密码验证。验证码 5 分钟/最多 5 次失败/60 秒重发；密码登录和邮件发送同时限制身份目标、网络与平台预算。仅在反向代理覆盖 X-Real-IP 且禁用直接访问时设置 TUHENG_TRUST_PROXY_IP=1，否则使用保守的未知网络桶；不能信任客户端自报 IP。
- `npm run identity:secrets -- --rotate` 先保留旧主密钥、追加新 keyId，再重包有效 SecretRecord。中途失败可重跑；旧 keyId 留作恢复历史备份。轮换后重启 Web/Worker 载入部署密钥；后台 AI/SMTP 配置本身无需重启。
- 数据库备份与主密钥分开加密保管，恢复时必须同时具备匹配的 keyId。缺失/错误主密钥安全失败，不改成明文。对象存储恢复点也必须与数据库一致。

## 旧账号和 AI 配置迁移

先保存数据库与私有对象备份，运行 `tsx scripts/identity-audit.ts`，再执行增量迁移。明确准备 school/user/class 映射 JSON，使用 `npm run identity:migrate -- --mapping 文件` 预检，审核后加 `--apply`。工具保留历史 User.id、作答、几何题目和正式成绩；旧名单以切换时成员与已有提交者推断，记录 inferred，不宣称还原发布时原始名册。开发空库可显式用 `--development-template --output .runtime/mapping.json` 生成标记为开发数据的映射，生产拒绝此快捷方式。

旧 AI 配置仅通过 `npm run ai:import-legacy -- --legacy-id 配置ID --protocol OPENAI_CHAT_COMPLETIONS --confirm-import` 显式迁移；图片能力需明确添加 `--images`。工具只读取该旧记录指定的 AI_* 密钥，统一加密、审计、阻止重复导入；导入后供应商、模型及新模块绑定保持停用，已有绑定不覆盖。请在 AI 中心审查参数后启用，未执行任何模型请求。旧队列任务明确阻塞，有合法原快照的任务可以按原配置重试；没有快照的旧任务必须使用当前配置新建运行；不会静默替换评分依据。

迁移文件通过 `.gitattributes` 固定 LF。迁移 runner 兼容旧 Windows 库按 CRLF 生成的校验值，只允许换行差异；SQL 内容、空白或注释变更仍拒绝，已执行记录的 checksum 不重写。

## 后台配置与任务操作（2026-11-17）

- AI 中心的供应商、模型、模块规则保存都创建版本；切换有未保存草稿的列表或标签时可保存、丢弃或继续编辑。保存已成功但重新读取失败时冻结编辑，先刷新核对，避免重复版本。
- 任务页按当前筛选全量计数、每页 30 项；可见页约每 10 秒轮询，失败退避至 60 秒。详情在状态移出筛选后按运行编号单独读取；页面缓存错误明确标出。普通响应只返回元信息，不包含请求原文、作答、密钥或完整模型响应。
- 按原配置重试严格要求已有合法快照和未撤销凭据，不再为无快照旧运行补写当前配置。当前配置新建运行会再次校验能力、来源账号与凭据，使用新 ID 并保留父运行审计；不会覆盖原建议和教师正式成绩。
- 网页两种任务命令均要求近期再认证和 UUID 操作编号。重复发送同一编号返回同一结果；结果未知时先刷新核对，不自动重放。按原配置重试在持有运行事务锁时检查旧队列记录：只清理已终结的保留任务，再提交 outbox；排队或执行中的记录拒绝重试，避免重复执行和旧 jobId 吞掉新的派发。既有租约、outbox 和 Worker 继续复用。
- 邮件保存需要明确的 sourceId（新建为 null）和 expectedVersion；密码留空继承所选来源版本，不误取最新版本凭据。启停需 expectedActiveId，其他管理员已切换生效版本时拒绝覆盖。原内部调用保持兼容，HTTP 调用方需传递上述字段。
- 保存、连接测试、测试邮件和启用是四个独立操作。测试绑定已保存版本，SMTP 接受不等于送达；认证、连接/超时、证书和发送状态未知分别显示安全说明，未关闭证书验证。没有新增数据库迁移，也不改写历史作答或评分记录。
