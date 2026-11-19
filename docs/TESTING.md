# 测试与验证

[返回文档目录](README.md)

## 隔离环境

单元测试无需运行 Web、数据库或 Redis。集成和浏览器测试会真实创建账号、作业、文件与任务，必须使用隔离环境；部分用例会修改测试配置和账号，不要连接日常业务库。

1. 准备数据库名以 `_test` 结尾的 PostgreSQL 数据库、独立 Redis 库/队列命名空间和私有测试桶。
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

`identity-ai.spec.ts` 启动本地 SMTP 协议替身，监听 `127.0.0.1:1026`。测试服务需将该精确地址加入出口白名单。对生产模式 Web 验收，配置 `TEST_SMTP_CERT`、`TEST_SMTP_KEY` 提供测试 STARTTLS 证书，并通过 `NODE_EXTRA_CA_CERTS` 让测试进程、Web 和 Worker 信任测试 CA；不要关闭生产证书校验。连接被替身接受不代表外部邮箱送达。

## 关键覆盖

| 范围                 | 入口用例                                                                                                                           | 验证内容                                                              |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 架构和安全边界       | `tests/unit/boundaries.test.ts`、`policy-image.test.ts`、`outbound.test.ts`                                                        | 递归源码依赖、资源范围、私有图片与出口限制。                          |
| 身份与学校管理员     | `tests/integration/identity*.test.ts`、`school-administrators.test.ts`                                                             | 双域、首次设置、凭据版本、多校管、最后一位保护与并发。                |
| 教学组织与名单       | `teaching-organization.test.ts`、`roster.test.ts`、`audience.test.ts`                                                              | 两校隔离、课程多学期、成员复用、跨开课导入、归档、交接及快照。        |
| AI / SMTP / 网站配置 | `ai-gateway.test.ts`、`site-settings.test.ts`、`tests/e2e/identity-ai.spec.ts`                                                     | 协议、配置版本、预算、真实页面操作与本地邮件替身。                    |
| 作业闭环             | `tests/integration/workflow.test.ts`、`tests/e2e/workflow.spec.ts`、`onboarded-teaching.ts`                                        | 出题、发布、上传、草稿、正式提交、复核、成绩与自测保护。              |
| 管理界面             | `school-teaching.spec.ts`、`ui-management.spec.ts`、`organization-layout.spec.ts`                                                  | 学校/人员/课程/班级真实深链接，搜索、导入、凭据、移动抽屉与实际点击。 |
| 几何内核与教学保存   | `tests/unit/geometry*.test.ts`、`tests/integration/geometry.test.ts`                                                               | 坐标、拓扑、笔迹、曲线、绑定、历史 JSON 与服务端题干保护。            |
| 编辑器浏览器交互     | `geometry-ux.spec.ts`、`geometry-components.spec.ts`、`geometry-pen.spec.ts`、`geometry-curves.spec.ts`、`geometry-repair.spec.ts` | 真鼠标拖动、松手前 HUD、吸附、合点、撤销、顶部动作、输入和导出。      |
| 网络与登录           | `network-login.spec.ts`                                                                                                            | 指定应用地址下的登录/刷新/退出、非法源拒绝与编辑器使用。              |

表中未写目录的 `*.test.ts` 位于集成测试目录（几何通配与单元标注除外），`*.spec.ts` 和 `onboarded-teaching.ts` 位于 `tests/e2e`。用 `npm run test:e2e -- tests/e2e/文件.spec.ts` 运行针对性用例，不以单个子集代替完整套件结果。

## 浏览器、数据和硬件边界

桌面拖动使用 Playwright `mouse.move/down/up`，在 pointerup 前断言对象和 HUD；点击按钮还要验证命中区域和操作结果。触摸/笔合成事件是补充，不能冒充真实 iPad + Pencil 或 Safari 测试。

响应式用例覆盖 360×800、390×844、768×1024、1024×768、1366×768、1440×900 及窄容器/双编辑器。截图不能代替 JSON 引用、权限和撤销状态检查。图纸导出数据见[示例说明](GEOMETRY_EDITOR_SCHEMA.md#示例文件的用途)。

真实模型准确性、真实邮件送达、低端设备帧耗时、系统软键盘和硬件掌触需单独验收。`geometry-examples/ux-v2/performance.json` 是历史样本测量，不是当前环境或生产容量承诺。测试替身仅用于自动化，不作为业务结果。

## 本次文档整理的验证记录

核验日期：2026-11-19。业务代码基线为 `346ce00`（教学管理和学校选择页面优化）。本次仅整理文档，并调整已停用脚本中指向旧文档的提示路径；未迁移数据库或改动业务功能。

以下均为本次实际执行结果。测试使用 Windows、Node.js 26.13.0、Chrome 157.0.8103.79，以及隔离 PostgreSQL 数据库、Redis 队列和私有 S3 测试桶。

| 检查            | 本次结果                                                                                            |
| --------------- | --------------------------------------------------------------------------------------------------- |
| 类型检查        | 通过。                                                                                              |
| lint            | 通过。                                                                                              |
| 单元测试        | 22 个文件、243 项通过。                                                                             |
| 集成测试        | 10 个文件、63 项通过。                                                                              |
| 文档链接 / 示例 | 13 份 Markdown、92 个本地链接、40 处 npm 脚本引用有效；25 份几何文档和 1 份笔迹样本通过现行解析器。 |
| 生产构建        | `npm run build` 通过。                                                                              |
| 关键浏览器测试  | 10 项通过：教学管理布局 5 项、学校/课程/多校管流程 3 项、双编辑器与真实拖动取消 2 项。              |

本次未重跑完整浏览器套件。关键浏览器用例为 `organization-layout.spec.ts`、`school-teaching.spec.ts` 全部用例，以及 `geometry-components.spec.ts` 中双编辑器隔离和真实拖动期间外部更新的两项用例。没有将旧验收报告数字计作新执行结果。真实 SMTP、真实模型调用及实体平板/电子笔不属于本次文档验证；图片目录保留历史取证，生成的设计参考明确标识为参考图。
