# 运行、部署与排障

[返回文档目录](README.md)

## 环境与配置

运行前安装 Node.js 22+ 和 npm。仓库的本地依赖模板使用 PostgreSQL 17、Redis 7 及 S3 兼容存储；Web 和 Worker 是两个独立 Node.js 进程。安装步骤见[项目 README](../README.md#本地运行)。

从 [.env.example](../.env.example) 创建本机 `.env`。不要提交 `.env`、交付文件或实际密钥。

| 配置                                                                      | 用途                                                                                  |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                            | PostgreSQL 连接；迁移、Web 和 Worker 应指向同一业务库。                               |
| `REDIS_URL`                                                               | 队列与共享限额；隔离测试使用独立 Redis 库及 `QUEUE_NAMESPACE`。                       |
| `NEXTAUTH_URL`                                                            | 应用主地址，生产填写实际 HTTPS 地址。                                                 |
| `APP_ALLOWED_ORIGINS`                                                     | 额外允许访问应用的完整源，逗号分隔，含协议和端口。                                    |
| `AUTH_SECRET`                                                             | 独立随机会话密钥，至少 32 字符；不能使用模板占位值。                                  |
| `S3_ENDPOINT`、`S3_REGION`、`S3_BUCKET`、`S3_ACCESS_KEY`、`S3_SECRET_KEY` | 私有对象存储。当前适配器使用 path-style 访问。                                        |
| `TUHENG_SECRET_KEYS`、`TUHENG_SECRET_ACTIVE_KEY`                          | SecretStore 的主密钥集合与当前 keyId；独立于数据库保管。                              |
| `TUHENG_OUTBOUND_ALLOWLIST`                                               | 受控内部 SMTP / 模型服务的精确 `host:port` 白名单；不需要为正常公网服务放宽整个内网。 |
| `TUHENG_TRUST_PROXY_IP`                                                   | 仅在代理覆盖 `X-Real-IP` 且禁止绕过代理直连时设为 `1`。                               |
| `WORKER_FORMAL_CONCURRENCY`、`WORKER_SELFTEST_CONCURRENCY`                | 默认分别为 4、2；供应商总并发和日预算另由 Redis 统一限制。                            |
| `UPLOAD_MAX_BYTES`、`SELFTEST_DAILY_QUOTA`                                | 单文件上传上限与自测日配额，示例分别为 15 MiB、20 次。                                |

[compose.yaml](../compose.yaml) 仅启动本地依赖，端口绑定 `127.0.0.1`，数据保存在命名卷。名为 `minio` 的服务使用固定镜像的 RustFS。已有外部 S3 时无需运行该服务；先创建私有桶，核对桶名和读写权限。不要将本地 Compose 凭据、数据库和存储控制台直接公开到互联网。

## 新安装与账号恢复

1. 执行 `npm ci`、`npm run db:generate`、`npm run db:migrate`。
2. 执行 `npm run identity:secrets -- --initialize`。它在忽略的 `.env` 中写入随机 32 字节主密钥，已有配置不替换。生产可通过独立密钥管理设施注入同名配置。
3. 执行 `npm run identity:bootstrap -- --output .runtime/admin-delivery.txt`。仅当没有网站管理员时创建 `admin`；输出文件必须位于 `.runtime`，禁止覆盖已有交付文件。重复初始化拒绝并保留原账号。
4. 从本机受限文件取得临时密码，首次登录改密。网站管理员无需强制绑定邮箱；学校管理员和教师仍需完成邮箱验证，先在后台配置邮件服务。
5. 安全交付后删除本地凭据文件。正常部署不运行测试种子，不使用固定测试密码。

服务器管理员恢复根账号：

```sh
npm run identity:bootstrap -- --reset-root --output .runtime/admin-recovery.txt
```

该动作生成新的随机临时密码、撤销旧会话并记录审计，保留已验证邮箱。确需一并解除根账号旧邮箱时增加 `--recover-mailbox`；这是单独审计的服务器恢复操作，不是普通教师或校管的网页能力。每次使用新的交付文件名。

## 升级现有实例

1. 备份数据库、私有对象与部署密钥，记录当前代码版本。
2. 停止 Web 和 Worker，拉取已审查的代码，执行 `npm ci`。
3. 执行 `npm run db:generate` 和 `npm run db:migrate`。
4. 生产执行 `npm run build`，分别启动 `npm start` 和 `npm run worker`；开发启动 `npm run dev` 与 Worker。
5. 检查登录、课程详情、班级成员、上传、提交和任务处理。管理员可在系统状态页或带管理员会话的 `/api/actions/health` 查看依赖状态。

**重新生成 Prisma 客户端、迁移数据库、重启进程是三个独立步骤。** 浏览器刷新与开发热更新不能替代进程重启。迁移用仓库的 runner，记录在 `_tuheng_migrations`，不与 Prisma 自身迁移记录混用；详见[数据迁移](DATABASE.md#迁移与回退)。

## 局域网开发与平板访问

`npm run dev` 监听 `0.0.0.0:3000`。电脑与平板连同一局域网，在 `.env` 填写实际电脑 IPv4，例如：

```dotenv
NEXTAUTH_URL=http://localhost:3000
APP_ALLOWED_ORIGINS=http://192.168.1.100:3000
```

重启 Web 后，在平板打开 `http://192.168.1.100:3000/login`。这里的示例 IP 必须替换为本机地址，并允许防火墙在受信任局域网中访问应用端口。

- 多个地址用逗号分隔，不接受通配符、账号信息或路径。端口不同也需要分别配置。
- 登录、退出和保存使用当前页面地址；不能把平板跳转到平板自己的 `localhost`。不同主机地址的会话独立，需要分别登录。
- Next 开发资源按允许的 hostname 校验，业务接口按完整 Origin 校验；网页能显示不代表保存或登录来源已获许可。IP 变化后要更新配置并重启。
- 普通 HTTP 局域网可能没有 `crypto.randomUUID`；公共 ID 工具使用 `crypto.getRandomValues` 回退。不要为排障关闭 CSRF、Cookie 或服务端权限校验。

`TEST_APP_ORIGIN` 只改变 Playwright 访问地址，不能代替服务器的 `APP_ALLOWED_ORIGINS`。真实平板、软键盘和手写笔仍须另外验证。

## 常见问题

| 现象                                                            | 检查与处理                                                                                                                                       |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `'dotenv' 不是内部或外部命令`                                   | 在仓库根目录执行 `npm ci`，确认开发依赖未被省略，再用 `npm run dev`。`dotenv-cli` 是本项目依赖，无需另装全局命令。                               |
| 页面显示“暂时无法加载”                                          | 先看 Web 日志和系统状态，区分数据库连接、迁移、客户端版本、账号范围等原因；不要据此清库。                                                        |
| 日志出现 `Unknown field archived` / `Unknown argument archived` | 核对课程及开课归档迁移 `2026111802_catalog_archive`，重新生成客户端并重启 Web / Worker。旧进程可能仍缓存变更前模型，即使磁盘客户端和迁移已更新。 |
| 平板能开网页却不能登录或保存                                    | 核对完整 Origin、IP 和端口，确认重启后配置生效；检查开发资源请求、登录重定向及浏览器错误。                                                       |
| 学校或教师卡在邮箱验证                                          | 由网站管理员保存、测试并启用 SMTP 版本；检查发送限额、TLS、接收地址和错误状态。管理员自身不依赖此步骤进入后台。                                  |
| AI 显示配置阻塞                                                 | 核对供应商、密钥、模型能力、模块绑定与预算；已有无快照任务不能伪装成“原配置重试”。见[后台配置](AI_CONFIGURATION.md)。                            |
| 上传失败                                                        | 核对私有桶是否存在、S3 endpoint 和 path-style 兼容性、凭据权限、文件大小及 Web 日志。                                                            |
| 提交已保存但任务不处理                                          | 确认 Worker、Redis、队列命名空间与业务库一致；检查 outbox、任务状态和租约，使用既有恢复命令，不手改成绩。                                        |

课程与班级页面曾因旧 Web 进程缓存 Prisma 模型失败，按上述重启步骤即可恢复；不需要重新导入名单或修改历史作答。

## 备份、密钥轮换与恢复

- 用 `pg_dump --format=custom` 备份 PostgreSQL，并同步备份私有桶；数据库和对象必须具有一致的恢复点。
- 数据库备份与 `TUHENG_SECRET_KEYS` 分开加密保管。缺少对应 keyId 时无法解密历史密钥和交付凭据，系统应安全失败。
- `npm run identity:secrets -- --rotate` 保留旧 key、追加新 key，并重包未撤销且未过期的 SecretRecord。失败可重跑；轮换后重启 Web / Worker。旧 key 保留供备份恢复，不能直接丢弃。
- 恢复演练使用隔离数据库和桶。验证业务对象引用，再启动 Web 和 Worker，核对未投递 outbox、过期租约与队列补偿。
- 生产由进程管理器分别维护 Web / Worker，配置 HTTPS、请求体和频率限制、日志和备份告警。日志不得包含密码、原始图片或完整模型响应。

模型 / SMTP 的后台版本变更无需重启服务；环境变量和部署主密钥变更需要重启。数据迁移、旧账号映射和旧 AI 配置导入见[数据指南](DATABASE.md)。

## 容量与驱动维护

`npm run load` 会真实写入标记为压测的数据、私有文件、作答和任务，仅限隔离本地测试环境。需显式设置 `LOAD_CONFIRM=local-test-only`，可设置 `LOAD_USERS` 和 `LOAD_CONCURRENCY`；不生成模拟分数，也不自动删除其他数据。小样本结果不能作为生产容量承诺。

Prisma 当前使用 JS/WASM query compiler 和 pg adapter。`SafePrismaPg` 对提交冲突后的连接释放做集中保护，事务冲突采用有限重试。升级 ORM / 驱动时应验证事务冲突、连接释放和压测脚本退出，再评估移除兼容处理。
