# 测试与验证

[返回文档目录](README.md)

## 隔离环境

单元测试无需运行 Web、数据库或 Redis。集成和浏览器测试会真实创建账号、作业、文件与任务，必须使用隔离环境；部分用例会修改测试配置和账号，不要连接日常业务库。

1. 准备数据库名以 `_test` 结尾的 PostgreSQL 数据库、独立 Redis 库/队列命名空间和私有测试桶。运行整套浏览器测试时使用隔离服务中的 `tuheng_test`，首位管理员用例会核对这个数据库名。
2. 将部署模板复制为忽略的 `.env.test.local`，填写测试连接和独立的会话/SecretStore 密钥。设置 `SEED_TEST_ACCOUNTS=1`、自选至少 12 字符的 `SEED_PASSWORD`，不要使用真实管理员密码。
3. 为测试 Web 指定独立端口，例如 `PORT=3318`，并令 `NEXTAUTH_URL`、`APP_ALLOWED_ORIGINS`、`TEST_APP_ORIGIN` 均指向 `http://localhost:3318`。
4. 生成客户端，对测试库迁移并执行测试种子。种子仅允许显式测试库，会建立标记的测试学校、账号和教学数据；不是生产安装步骤。

```sh
npm run db:generate
npx dotenv -e .env.test.local -- npm run db:migrate
npx dotenv -e .env.test.local -- npm run db:seed
```

所有测试、Web、Worker 都要加载同一测试配置。下面的外层 dotenv 将测试变量传给子进程；不要给内部命令增加覆盖环境的参数。只改 `TEST_APP_ORIGIN` 不会切换数据库。

## 验证命令

```sh
npm run typecheck
npm run lint
npm test
npx dotenv -e .env.test.local -- npm run test:integration
npx dotenv -e .env.test.local -- npm run build
```

集成评分用例会自行领取任务和注入协议替身，运行时停止共享这套测试队列的 Worker，避免竞争。生产业务 Worker 不应连接测试命名空间。

浏览器第一次使用需 `npx playwright install chromium`；也可将 `PLAYWRIGHT_CHROMIUM_PATH` 指向已安装的兼容 Chromium 浏览器。需要生产构建验收时先在独立终端启动测试 Web，再运行测试：

```sh
npx dotenv -e .env.test.local -- npm start
```

```sh
npx dotenv -e .env.test.local -- npm run worker
```

```sh
npx dotenv -e .env.test.local -- npm run test:e2e
```

Playwright 非 CI 配置会复用指定地址的已运行服务；没有服务时默认启动开发 Web。`CI` 下不复用现有服务，应按测试环境调整启动方式，避免双占端口。名单导入及完整身份/教学 E2E 需要真实测试 Worker；纯编辑器或只读页面测试不依赖模型调用。

`identity-ai.spec.ts` 启动本地 SMTP 协议替身，默认监听 `127.0.0.1:1026`。端口可由 `TEST_SMTP_PORT` 指定。测试服务需将该精确地址加入出口白名单。对生产模式 Web 验收，配置 `TEST_SMTP_CERT`、`TEST_SMTP_KEY` 提供测试 STARTTLS 证书，并通过 `NODE_EXTRA_CA_CERTS` 让测试进程、Web 和 Worker 信任测试 CA；不要关闭生产证书校验。连接被替身接受不代表外部邮箱送达。

AI 配置界面用例可通过 `TEST_AI_BASE_URL` 使用受控的本地测试地址。将其精确的主机和端口加入同一隔离环境的出口白名单。

## 关键覆盖

| 范围                 | 入口用例                                                                                                                           | 验证内容                                                              |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 架构和安全边界       | `tests/unit/boundaries.test.ts`、`policy-image.test.ts`、`outbound.test.ts`                                                        | 递归源码依赖、资源范围、私有图片与出口限制。                          |
| 身份与学校管理员     | `tests/integration/identity*.test.ts`、`school-administrators.test.ts`                                                             | 双域、首次设置、凭据版本、多校管、最后一位保护与并发。                |
| 教学组织与名单       | `teaching-organization.test.ts`、`roster.test.ts`、`audience.test.ts`                                                              | 两校隔离、课程多学期、成员复用、跨开课导入、归档、交接及快照。        |
| AI / SMTP / 网站配置 | `ai-gateway.test.ts`、`site-settings.test.ts`、`tests/e2e/identity-ai.spec.ts`                                                     | 协议、配置版本、预算、真实页面操作与本地邮件替身。                    |
| 作业闭环             | `tests/integration/workflow.test.ts`、`tests/e2e/workflow.spec.ts`、`onboarded-teaching.ts`                                        | 出题、发布、上传、草稿、正式提交、复核、成绩与自测保护。              |
| 存储上下文和头像 | `resource-lifecycle.test.ts`、`profile-notifications.spec.ts` | 暂存归档、读写范围、版本复用、派生链、头像并发和双域访问。 |
| 教学通知与公告 | `teaching-notifications.test.ts`、`profile-notifications.spec.ts` | 发布快照、催交、成绩和申诉事件、投递恢复、公告范围、移动端已读与业务跳转。 |
| 管理界面             | `school-teaching.spec.ts`、`ui-management.spec.ts`、`organization-layout.spec.ts`                                                  | 学校/人员/课程/班级真实深链接，搜索、导入、凭据、移动抽屉与实际点击。 |
| 几何内核与教学保存   | `tests/unit/geometry*.test.ts`、`tests/integration/geometry.test.ts`                                                               | 坐标、拓扑、笔迹、曲线、绑定、历史 JSON 与服务端题干保护。            |
| 编辑器浏览器交互     | `geometry-ux.spec.ts`、`geometry-components.spec.ts`、`geometry-pen.spec.ts`、`geometry-curves.spec.ts`、`geometry-repair.spec.ts` | 真鼠标拖动、松手前 HUD、吸附、合点、撤销、顶部动作、输入和导出。      |
| 分步作图、审核与三维 | `tests/unit/construction-animation.test.ts`、`tests/unit/drawing-audit.test.ts`、`tests/unit/solid-reconstruction.test.ts`、`tests/e2e/geometry-milestone3.spec.ts` | 动画文件和笔顺、错误路径、投影审核、网格体积、孔道连通及桌面/手机三维联动。 |
| 网络与登录           | `network-login.spec.ts`                                                                                                            | 指定应用地址下的登录/刷新/退出、非法源拒绝与编辑器使用。              |

表中未写目录的 `*.test.ts` 位于集成测试目录（几何通配与单元标注除外），`*.spec.ts` 和 `onboarded-teaching.ts` 位于 `tests/e2e`。用 `npm run test:e2e -- tests/e2e/文件.spec.ts` 运行针对性用例，不以单个子集代替完整套件结果。

## 浏览器、数据和硬件边界

桌面拖动使用 Playwright `mouse.move/down/up`，在 pointerup 前断言对象和 HUD；点击按钮还要验证命中区域和操作结果。触摸/笔合成事件是补充，不能冒充真实 iPad + Pencil 或 Safari 测试。

响应式用例覆盖 360×800、390×844、768×1024、1024×768、1366×768、1440×900 及窄容器/双编辑器。截图不能代替 JSON 引用、权限和撤销状态检查。图纸导出数据见[示例说明](GEOMETRY_EDITOR_SCHEMA.md#示例文件的用途)。

真实模型准确性、真实邮件送达、低端设备帧耗时、系统软键盘和硬件掌触需单独验收。`geometry-examples/ux-v2/performance.json` 是历史样本测量，不是当前环境或生产容量承诺。测试替身仅用于自动化，不作为业务结果。

## 学校详情与密码控件的验证记录

核验日期：2026-11-19，修改基线为 `0d47c91`。本次整理学校详情抽屉、管理账号卡片与操作反馈，并去掉身份验证密码框内重复的浏览器显示按钮。复用现有组织命令、近期身份验证和服务端权限；没有数据库结构变更。

以下均为本次实际执行结果。测试使用 Windows、Node.js 26.13.0、Chrome 157.0.8103.79，以及隔离 PostgreSQL 数据库、Redis 队列和私有 S3 测试桶。重复眼睛另外使用本机 Edge 157.0.4341.60 自动化复现与验证。

| 检查 | 本次结果 |
| --- | --- |
| 类型检查、lint | 通过。 |
| 单元测试 | 22 个文件、243 项通过。 |
| 集成测试 | 10 个文件、63 项通过。 |
| 文档链接 / 示例 | 现行 Markdown 本地链接及 npm 脚本引用有效；25 份几何文档和 1 份笔迹样本通过现行解析器。 |
| 生产构建 | `npm run build` 重试通过，退出码 0。过程中编译完成后曾被框架安全升级提示中断；没有调整依赖或禁用检查。 |
| 关键浏览器测试 | 10 项通过：`organization-layout.spec.ts` 5 项、`school-teaching.spec.ts` 3 项、`ui-management.spec.ts` 的 G06/G07 与 G06 两项。 |
| Edge 密码显示 | 真实键盘路径输入非敏感样本，前后截图确认从两个眼睛变为一个；点击右侧按钮可显示、隐藏，取消可关闭弹窗。 |

改动前新增的按钮尺寸断言失败：重置密码按钮实际只有 29.09px 高。改动后，360、390、768、1024、1366、1440px 宽度下按钮均至少 44px，页面和抽屉没有横向溢出。用例实际点击重置/启停账号、验证最后一位管理员的 UI 禁用与 API 409、检查抽屉内的凭据领取入口，并用触控模拟完成保留输入草稿、保存学校名称与新增第三位管理员；数据库结果与界面一致。

重复眼睛来自浏览器原生密码按钮与 `SecretInput` 自带控件同时显示。修复仅在该组件范围隐藏 `::-ms-reveal`，保留右侧可访问按钮；方式依据 [Microsoft Edge 文档](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/password-reveal)。[修复前](images/school-details-20261119/reauth-edge-before.png) / [修复后](images/school-details-20261119/reauth-edge.png)均为实际页面截图。

桌面、平板与手机界面见[学校详情截图](images/school-details-20261119/)。本次未重跑完整浏览器套件；触控是浏览器模拟，未验证实体 iPad、Safari、系统软键盘或电子笔。真实 SMTP、真实模型调用不属于本次前端验收，没有将协议替身或旧报告算作真实服务通过。

## 私有资源、用户中心与通知的验证记录

2026-11-19 基于 `8da19e0` 开发。验收运行在 Windows、Node.js 26.13.0、Chrome 157.0.8103.79，使用独立 PostgreSQL 测试 schema、Redis 命名空间、私有 S3 测试桶以及本地 STARTTLS 邮件替身。

| 命令 | 本次结果 |
| --- | --- |
| `npm run typecheck`、`npm run lint` | 通过。 |
| `npm test` | 22 个文件，243 项通过。 |
| `npm run test:integration` | 12 个文件，71 项通过。 |
| `npm run test:e2e` | 选定的 `profile-notifications`、`identity-ai`、`workflow` 和 `organization-layout` 四个套件全部通过，共 17 项。 |
| `npm run build` | 初次编译完成后命令退出。使用同一配置重试，退出码 0。 |

| 场景 | 验证结果 |
| --- | --- |
| 空库初始化 | 十条迁移依次完成，测试种子成功，演示题目及作业使用新资源结构。 |
| 旧开发资源切换演练 | 在隔离环境执行预检、清理、迁移及回读。删除旧对象、关联作答与评分及对应任务，保留无关对象、任务、账号、学校、配置和纯文字题目。 |
| 私有上传 | 演示附件由实际 Worker 归入学校题库，回读 22082 字节且 SHA-256 一致。评分样本同时记录学生目录和教师源图所有权。 |
| 失败恢复 | 集成测试覆盖归档失败、并发绑定、重复执行、资源清理、旧头像保留及并发替换。 |
| SMTP 与账号安全 | 使用本地 SMTP 检查协议提交、教学邮件重试和跳过，浏览器验证换绑目标变化、验证码流程及双域隔离。 |

原开发环境仅执行只读预检，发现 12 个旧资产、3 个关联题目版本、3 份作业及 6 次提交与评分运行。自动审批以“策略阻止”为由拒绝停止原服务并执行实际清理的命令。隔离演练覆盖了同一工具链，原数据库尚未切换。[开发环境切换步骤](OPERATIONS.md)

浏览器用例覆盖 360、390、768、1024、1366 和 1440px，验证顶栏控件尺寸、触摸点击、头像上传和移除、公告发布和授权详情跳转。修复前分类选择因控件名称不明确而超时，修复后完成分类筛选、批量已读及查看详情。[截图与上传样本](RESOURCES_NOTIFICATIONS.md#实际界面与上传样本)

手机触摸使用浏览器模拟。外部邮箱送达、真实模型调用和实体设备没有实测。完整浏览器套件未在本轮运行。
