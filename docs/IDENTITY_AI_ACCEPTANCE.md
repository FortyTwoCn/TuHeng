# 身份、组织与 AI 重构验收记录

初次验收日期：2026-11-16。基线 `f354b31`；开发分支 `codex/identity-ai-refactor`。2026-11-17 按用户要求取消网站管理员强制绑邮箱，补充结果见文末。权限与迁移决策见 [架构记录](IDENTITY_AI_REFACTOR.md)，部署、恢复和密钥轮换见 [运行手册](OPERATIONS.md)。本报告只把实际执行的测试记为通过。

## 交付范围与入口

| 范围                   | 实现及入口                                                                                                                 | 主要代码                                                                                      |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 四类账号、双认证域     | `/login/student`、`/login/staff`，独立 Cookie、JWT audience、CSRF、邮箱命名空间；没有公开注册和任意切换角色                | `contracts/identity.ts`、`domain/identity.ts`、`infrastructure/identity-*`、`web/lib/auth.ts` |
| 首次启用及恢复         | 所有账号首次改密；学校与教师验证邮箱；管理员改密后直接进入后台，邮箱可选；SMTP 仅在后台配置，学生可跳过邮箱                 | `AccountSetup`、`SMTPSettings`、`scripts/identity-bootstrap.ts`                               |
| 学校、教师、班级、学生 | 学校独立实体；S/T 登录编号、同校字符串学号；课程/学期、成员调整、交接、启停、重置、服务器分页搜索                          | `infrastructure/organization.ts`、`OrganizationConsole`                                       |
| 实际 XLSX 导入与交付   | 学校四列、教师三列；列映射、重名教师确认/拆分、预检、真实 Worker 进度和结果；分开下载教师/学生凭据，学校管理账号交付卡     | `roster-xlsx.ts`、`roster-import.ts`、`credential-delivery.ts`、`RosterImportWizard`          |
| 名单与复核分工         | 公共选择器，全选/排除/跨班去重；发布快照、显式补发/移除、按班或个人分配复核人、站内通知                                    | `domain/audience.ts`、`teaching.ts`、`AudiencePicker`、`ReviewerAssignments`                  |
| AI 配置与调用          | 管理员 AI 中心：供应商、模型目录、模块规则、调用记录；`grading.assignment` 与 `grading.selftest` 分别绑定                  | `contracts/ai.ts`、`domain/ai-routing.ts`、`infrastructure/ai-admin.ts`、`ai-gateway.ts`      |
| 两种协议、独立评分     | OpenAI Chat Completions / Anthropic Messages；不同认证、图片、结构化输出、usage 和错误归一化；结果继续交 grading-core 校验 | `packages/ai-providers/src`、`packages/grading-core/src`                                      |
| SMTP 与密钥            | 配置/连接测试/发送测试/启用分开；生产禁止 LOCAL_TEST 明文通道；验证码、恢复与安全通知；AES-GCM、短期凭据、出口限制、审计   | `email.ts`、`identity-challenges.ts`、`secret-store.ts`、`outbound.ts`                        |
| 响应式工作空间         | 360/390/768/1024/1440 宽度；手机更多导航使 AI、邮件、学情、审计等入口可达                                                  | `Shell`、`MobileNavigation`、`components/identity`、`globals.css`                             |

几何编辑器及 GeometryDocument 契约没有重写。图片作答、自测、错题、历史作答、AI 建议与正式教师成绩继续使用原来的领域、存储与任务链。

## 逐项验收

下表中的“通过”指本地真实数据库/队列/存储及自动化浏览器；SMTP 接收器与模型协议替身单独标注，不代表外部服务验收。

| 编号 | 实际验证                                                                                                  | 证据 / 结果                                                                       |
| ---- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| ID01 | 空 schema 首装 CLI；重复安装不改密码；唯一根账号数据库约束；独立邮箱恢复后重新受限                        | `integration/identity-install.test.ts`，通过                                      |
| ID02 | 无 SMTP 的首次 admin 改密 → 自动进入后台；改密前普通 API 被拒绝；未绑邮箱仍可配置 SMTP，退出后用 ID 正常登录 | `e2e/identity-ai.spec.ts` first admin，2026-11-17 通过                             |
| ID03 | 学校和教师实际用新凭据登录、改密、收信绑定；设置未完成时普通 API 返回 403                                 | 同文件 identity 流程；`integration/identity.test.ts`，通过                        |
| ID04 | 学生首次改密；可不绑邮箱进入；未验证邮箱不能登录                                                          | 同上，通过                                                                        |
| ID05 | 学号字符串及前导零、学校范围、重复复用与冲突校验                                                          | `integration/roster.test.ts`、浏览器 `0000123` 登录，通过                         |
| ID06 | 同一已验证邮箱分别属于 STAFF/STUDENT，密码和验证码不能跨域使用                                            | 浏览器 email methods、身份集成，通过                                              |
| ID07 | 同浏览器同时持有两种 HttpOnly 会话；分别退出；几何页面显式选择当前身份后刷新仍保持                        | 浏览器 identity，通过                                                             |
| ID08 | 错误/五次失败/过期/重发/跨用途/并发消费；会话版本改变后在途验证码失效                                     | `integration/identity.test.ts`，通过                                              |
| ID09 | 改密、重置撤销会话与旧交付密文；停校后旧会话及登录失效；下级无权重置上级                                  | 身份/名册集成、身份权限单元测试，通过                                             |
| ID10 | 其他学校教师不能管理名单；同校无复核授权也不能看作答；私有资源、正式成绩隔离                              | `integration/{roster,audience,workflow,geometry}.test.ts`，通过                   |
| ID11 | 学生学号密码/邮箱密码/邮箱验证码；STAFF ID/邮箱密码/邮箱验证码；学校 S 编号、教师 T 编号及 admin 实际登录 | 浏览器 identity、email methods、first admin，通过                                 |
| IM01 | 学校四列和教师三列真实 XLSX 上传、确认、后台执行到 SUCCEEDED                                              | 浏览器 identity + 名册集成，通过                                                  |
| IM02 | 预检不创建账号；同名教师必须确认/映射；错误含行列；自定义列映射                                           | 名册集成，通过                                                                    |
| IM03 | 并发重复确认、重试、重复导入不重复开户/改密                                                               | 名册集成，通过                                                                    |
| IM04 | 数值/公式身份单元格拒绝；文本学号保留；解析前限制 ZIP、宏、外链、工作表、行列                             | 名册集成验证数值/公式和范围；ZIP 各限额在解析器实施，未做完整恶意文件语料模糊测试 |
| IM05 | 两份独立 XLSX 实际下载；提取的学校/教师/学生凭据分别完成登录；学校交付卡实际打开和清除                    | 浏览器 identity，通过                                                             |
| IM06 | 一次性票据重放、过期、交付窗口到期、改密/重置后的旧凭据不可下载；短期密文被撤销                           | 名册集成，通过                                                                    |
| IM07 | 2002 行在第 100 行真实终止进程后续跑，最终只生成两名新增学生的凭据；再执行不重复                          | 容量报告，通过                                                                    |
| AU01 | 全授权学校范围排除一人，实际授权拒绝其访问/提交                                                           | `integration/audience.test.ts`，通过                                              |
| AU02 | 单人名单决定权限；旧班级成员关系不能越过快照授权                                                          | 同上，通过                                                                        |
| AU03 | 多班去重、排除优先、分页搜索；全选从服务端展开，不只选当前页                                              | 受众集成、2000 人样本、浏览器发布，通过                                           |
| AU04 | 新入班学生不会自动加入已发布作业；显式修订校验 rosterVersion；已有提交不能移除                            | 受众集成，通过                                                                    |
| AU05 | 校级任务按班/个人冻结复核分工；别的教师和管理账号不能借组织身份看私有作答/发布成绩                        | 受众/原工作流集成，通过                                                           |
| AU06 | 图片提交、几何 JSON、教师评分/更正、申诉、自测、错题、outbox/租约和幂等回归                               | 原有单元/集成/浏览器回归，见命令记录                                              |
| AI01 | 无运行时 AI_* 回退；数据库配置驱动一次真实 HTTP 请求，无需重启；旧环境配置仅显式 CLI 导入且默认停用       | `integration/ai-gateway.test.ts`，本地协议替身通过                                |
| AI02 | 模块规则实际保存、刷新读取、后端路由生成不同版本快照；多模型复用供应商                                    | AI 集成和浏览器 AI 配置通过                                                       |
| AI03 | 分协议验证请求/认证/system/图像/JSON/拒绝/截断/429/无效输出                                               | `unit/ai-protocols.test.ts`，协议替身通过                                         |
| AI04 | 题干、参考、学生答案全部证据计算图像需求；能力不符明确阻塞                                                | AI/评分单元、AI 集成通过                                                          |
| AI05 | 配置变更保留旧快照；撤销旧密钥阻断重试；新配置运行新建记录且不覆盖正式成绩                                | AI/原工作流集成通过                                                               |
| AI06 | 无模型仍保存提交、服务端时间、阻塞 run；模型故障不生成假成绩                                              | AI/原工作流集成通过                                                               |
| AI07 | Redis 跨调用者共享并发预约；有限预算、租约释放；BullMQ 重复投递不会重复成绩/证据                          | AI/原工作流集成通过；未进行多机器外部模型压力测试                                 |
| AI08 | SecretStore 密文、AAD/篡改/缺主密钥拒绝；配置 API/快照不含密钥；密钥输入保存后清空                        | 安全单元、AI 集成/浏览器通过                                                      |
| EM01 | 后台保存本地 SMTP，真实 SMTP 接收 MIME 邮件，解析验证码完成验证                                           | 身份集成/浏览器通过                                                               |
| EM02 | SMTP 拒绝返回失败、挑战撤销；新码替换旧码；连接测试与提交 SMTP 状态区分                                   | 身份集成，通过                                                                    |
| EM03 | 内网/链路本地/非 TLS/URL 凭据/重定向/大响应/错误证书拒绝；未经授权不可配置                                | 出口单元、身份集成，通过                                                          |

## 回归中发现并修复的问题

| 失败行为 / 根因                                                    | 修改位置                                                        | 修复后的验证                                                  |
| ------------------------------------------------------------------ | --------------------------------------------------------------- | ------------------------------------------------------------- |
| 密码登录把空验证码字符串送入六位码 Schema，正常密码登录被拒绝      | `LoginPanel.tsx`、`web/lib/auth.ts`                             | 新建账号 ID/邮箱密码登录实际通过                              |
| 两种会话同时存在时 `/geometry` 无法唯一判断身份，刷新会走错误入口  | `app/geometry/page.tsx`、登录返回地址                           | 双会话选择 realm 后刷新、分别退出通过                         |
| AI 保存端返回结构与 UI 读取不一致，已保存但页面无法刷新状态        | `app/api/ai/route.ts`                                           | 浏览器创建供应商/模型、保存模块规则、刷新重新读取通过         |
| 已有 T 编号与初始化序列相撞                                        | `organization.ts`                                               | 序列结合已有最大编号原子分配；导入和单建均通过                |
| 邮箱验证码可能在账号改密后仍处于有效期                             | `identity-challenges.ts`、`identity-auth.ts`、迁移 04           | 挑战绑定 tokenVersion；并发/在途旧码失败，合法新流程通过      |
| 超大 HTTP 响应拒绝后仍等待连接超时                                 | `outbound.ts`                                                   | 取消响应体并释放连接；本地重定向/大响应测试约 25ms 完成       |
| Node 26 不允许 TLS SNI 使用 IP 字面量，掩盖证书验证行为            | `email.ts`                                                      | IP 不发送 SNI；域名仍保留原主机名验证，坏证书实际被拒绝       |
| 手机底栏截断第六项以后的入口                                       | `MobileNavigation.tsx`、`Shell.tsx`、样式                       | 手机通过更多菜单进入 AI、邮件设置；原导航和退出保留           |
| Windows 的 CRLF/LF 检出改变迁移原始字节，可能误报已执行 SQL 被修改 | `.gitattributes`、`scripts/migration-checksum.ts`、`migrate.ts` | 兼容旧换行校验值，SQL 内容变化仍拒绝；首装/当前库重复迁移通过 |
| 人员表单只装载第一页的班级/教师，后续对象不可选                    | `OrganizationConsole.tsx`、`AudiencePicker.tsx`                 | 服务端分页/搜索入口、2000 人分页与集合解析验证                |

测试本身也做了必要更新：旧单域登录、发布和用户创建选择器改为新流程；测试库中的固定自动化账号计数器在每次用例准备时清理。生产限流未关闭，验证码失败/限流测试使用独立账号。一次并行 Playwright 运行曾发生 trace 文件目录冲突，后续运行串行或使用独立输出目录。

## 数据迁移与恢复实测

已对当前开发库执行四个增量迁移：`2026111601_identity_ai_expand`、`2026111602_ai_attempts`、`2026111603_audience_notifications`、`2026111604_verification_session_version`。

执行前创建 pg_dump：`.runtime/identity-backup/before-1794821635874.dump`。通过显式开发映射建立“开发数据迁移学校（非真实名册）”，回填 6 个非根账号、1 个班级和 12 份旧作业的接收人快照；用户 ID、旧密码哈希及历史记录保持。原邮箱没有验证证据，未自动标为已验证。旧作业快照标记为根据当前成员和真实提交者推断，不冒充原发布日名单。

实际 apply 报告 `.runtime/identity-migration-1794826145950.json`；另将原备份恢复到隔离测试 schema `identity_restore_1794829471238`，重新执行全部四个迁移与回填，报告 `protectedUnchanged: true`。当前数据库账号没有 CREATE DATABASE 权限，演练使用现有 `_test` 库内独立 schema，没有修改数据库用户权限。

| 受保护记录        | 迁移前 / 后数量 | 全记录 SHA-256 比较 |
| ----------------- | --------------- | ------------------- |
| SubmissionAttempt | 15 / 15         | 相同                |
| GradeDecision     | 3 / 3           | 相同                |
| GradingSuggestion | 0 / 0           | 相同                |
| StoredAsset       | 12 / 12         | 相同                |
| QuestionVersion   | 15 / 15         | 相同                |
| SelfTestSet       | 3 / 3           | 相同                |
| ErrorBookEntry    | 3 / 3           | 相同                |

新安装和管理员恢复另有隔离 schema 的真实 CLI 集成测试。多角色/多个旧管理员等歧义数据会安全拒绝迁移，需要先给出明确身份映射；本次实际开发数据没有这些冲突，未伪称自动完成任意旧库拆分。

## 容量、设备与截图

[容量 JSON](identity-evidence/capacity.json)：Windows、Node 26.13.0、AMD Ryzen 9 8940HX，本机 PostgreSQL/Redis；2000 名已存在测试学生、5 班，导入再增加 2 人。三个分页查询合计 12.03ms，搜索 4.15ms，1999 人名单解析 75.54ms，2002 行预检 284.28ms。执行含第 100 行中断和恢复约 191.59 秒，最终仅 2 份新凭据，重跑幂等。已有 2000 人使用不可登录的测试哈希；两名新增学生走实际临时密码生成/哈希流程。

该样本不表示 2000 个 AI 并发或低端设备性能。真实浏览器运行使用本机 Chrome；手机/平板尺寸、触摸及笔事件为浏览器模拟。通过 LAN `http://192.168.0.35:3000` 实际发出 HTTP 登录/退出请求，横竖屏通过；未使用物理 iPad、Pencil 或真实移动端软键盘。

截图来自隔离测试数据，未包含初始密码、验证码或 API 密钥；截图辅助证明布局，操作结果以测试和数据库验证为准：

- [桌面 AI 规则](identity-evidence/ai-1440.png)、[手机 AI 规则](identity-evidence/ai-390.png)
- [手机学校导入与两份凭据交付](identity-evidence/import-SCHOOL.png)、[教师导入](identity-evidence/import-TEACHER.png)
- [手机组织管理](identity-evidence/organization-mobile.png)、[学生邮箱登录](identity-evidence/mail-login-STUDENT.png)

## 最终命令记录

| 实际命令                                                      | 结果                                           | 本机日志                                 |
| ------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------- |
| `npm run typecheck`                                           | strict TypeScript 通过                         | `.runtime/identity-typecheck.log`        |
| `npm run lint`                                                | ESLint 通过                                    | `.runtime/identity-lint-full.log`        |
| `npm test`                                                    | 215/215，18 个文件                             | `.runtime/identity-unit-full.log`        |
| `npm run test:integration`                                    | 45/45，7 个文件，约 18.5 秒                    | `.runtime/identity-integration-full.log` |
| `npm run test:e2e -- --output .runtime/e2e-identity-complete` | 82/82，约 4.7 分钟                             | `.runtime/identity-e2e-full.log`         |
| LAN 地址的 `network-login.spec.ts`                            | 2/2（1024×768、768×1024）                      | `.runtime/identity-browser-lan.log`      |
| `npm run build`                                               | Next.js 16.4.2 Webpack 生产构建通过            | `.runtime/identity-build.log`            |
| `npm run db:migrate`                                          | 当前开发库重复执行无新增迁移、无 checksum 错误 | `.runtime/identity-final-migrate.log`    |
| 隔离备份恢复 + 迁移 + 回填                                    | 四个迁移及 6 账号/12 作业恢复成功              | `.runtime/identity-restore-drill.log`    |
| `identity:migrate -- --mapping ...` 最终只读检查              | 历史摘要与首次迁移前仍一致，待迁移旧作业 0     | `.runtime/identity-final-protected.log`  |

针对最后的邮件 TLS 与迁移换行兼容变更另运行身份集成、首装 CLI 测试和全量单元测试，未通过跳过用例或降低权限检查获得通过。敏感运行日志、备份、凭据文件在 git 忽略的 .runtime 中，截图与非敏感容量报告随文档提交。

复现环境需把 `DATABASE_URL` 同时指定测试库的 `schema=identity_refactor` 和 `options=-c search_path=identity_refactor`，配置独立 S3 测试桶及 `QUEUE_NAMESPACE`。`SEED_TEST_ACCOUNTS=1`、自定义 `SEED_PASSWORD` 仅允许 `_test` 数据库，先迁移/生成/种子。Web、Worker、Playwright 使用同一测试配置；身份浏览器用例的 SMTP 接收器监听 `127.0.0.1:1026`，只在该测试配置添加对应 `TUHENG_OUTBOUND_ALLOWLIST`。

## 外部条件与保留事项

- 没有发送真实外部 SMTP 邮件，没有调用真实 OpenAI/Anthropic 或消耗模型额度。本地 SMTP 收件和 HTTP 协议替身通过不代表真实邮箱投递、网关兼容性或模型评分质量通过；后台保留明确测试按钮供配置后验证。
- 根账号凭据通过 git 忽略且受限 ACL 的本机文件交付，未写入本文。2026-11-17 起，管理员首次改密后即可进入后台；SMTP 配置和个人邮箱绑定不再是管理员启用条件。学校与教师仍须验证邮箱。
- `npm audit` 本次检查仍有 13 项告警（4 high / 9 moderate），包括既有 Prisma/Sharp/ESLint 链及 ExcelJS 的间接 uuid 链。uuid 告警涉及 v3/v5/v6 的 buffer 参数，当前 ExcelJS 使用 v4；仍记录依赖告警，不宣称审计清零。未以自动跨主版本升级框架来掩盖告警，需后续依赖升级验证。
- 未做全恶意文件语料模糊测试、多机器模型负载或真实移动硬件测试。照片识别、OCR、DWG/DXF、协同与新评分平台均不属于此次实现。

## 2026-11-17：管理员邮箱改为可选

根因：`domain/identity.ts` 将所有 STAFF 账号都判为必须验证邮箱，旧会话的 onboarding 标记又会持续限制已经改密的管理员；`AccountSetup` 还在首次设置中嵌入 SMTP 表单。现按账号种类判断邮箱要求，管理员改密后自动进入后台，旧根会话从当前数据库状态重新判定，旧设置页链接重定向到后台。SMTP 配置入口保留在 `/admin/mail`，仍要求敏感操作再认证；个人邮箱在 `/admin/security` 可选绑定。学校与教师的验证要求不变。

`2026111701_admin_optional_email` 已在开发库及隔离测试 schema 执行，仅回填已改密根账号的 installationComplete。开发库 7 个账号的全部其余字段经执行前后比较一致，密码和邮箱未重置。CLI 集成测试验证迁移幂等、未改初始密码仍受限；身份集成测试验证旧根会话恢复访问、撤销会话仍被拒绝。

| 本次实际命令 | 结果 | 本机记录 |
| --- | --- | --- |
| `npx vitest run tests/unit/identity-security.test.ts` | 修改前管理员无需邮箱用例失败；修改后 9/9 | 本轮执行记录 |
| `npm run typecheck` / `npm run lint` | 均通过 | `.runtime/admin-email-typecheck.log`、`admin-email-lint.log` |
| `npm test` | 218/218，18 个文件 | `.runtime/admin-email-unit.log` |
| `npm run test:integration` | 46/46，7 个文件，隔离测试库 | `.runtime/admin-email-integration.log` |
| `npm run test:e2e -- tests/e2e/identity-ai.spec.ts --output .runtime/e2e-admin-email-retry` | 4/4，真实 Chrome 操作、隔离 Web/Worker/数据库 | `.runtime/admin-email-browser-retry.log` |
| `npm run build` | 生产构建通过 | `.runtime/admin-email-build-retry.log` |
| 增量迁移及账号前后比较 | 通过，无密码或邮箱变化 | `.runtime/admin-email-migration.log` |

浏览器覆盖无 SMTP、未绑邮箱管理员的首次改密自动跳转、改密前 API 拒绝、旧设置页跳转、后台 SMTP 保存/启用、账号安全的可选提示及退出后 ID 登录；同时回归学校/教师改密与邮件验证、学生可跳过绑定、双域隔离、导入交付和后台 AI 配置。邮件投递仍仅验证本地 SMTP 接收器，未请求真实外部邮箱或模型服务。

首轮浏览器连接失败及构建非零退出来自 Next.js 16.4.2 的已知安全升级提醒；按原命令重启/重试后分别通过。本次未升级框架或关闭安全检查，依赖告警仍需单独处理。上述是本次针对性验证，前文的 82 项全量 E2E 为 2026-11-16 的验收记录。
