# 账号、学校与 AI 调用重构

## 阶段 A：基线与范围

审查起点：main / f354b31ce026fe986cfffc7a4d1a6a40c15ed5dd。保留 next-env.d.ts 的本地开发生成差异。开发分支 codex/identity-ai-refactor，不回退参考提交，不部署生产。开发数据库允许结构重构或重建；实现仍保留旧数据迁移路径。

| 能力               | 现有入口 / 位置                           | 实际行为与缺口                              | 本轮方案                                                         |
| ------------------ | ----------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------- |
| 账号与认证         | lib/auth.ts、/login、User                 | 邮箱全局唯一、多角色、单 cookie；无首次设置 | 单一账号种类、双 realm / cookie / audience、受限启用会话         |
| 组织               | Course/Offering/Class/Grant/Enrollment    | 教师班级授权可用；没有学校租户              | School、稳定登录 ID、同校学号、学校范围和班级归属                |
| 导入               | domain/teaching.ts importRoster           | 仅按已有邮箱加入班级                        | 一个 XLSX 引擎，两套模板，预检、确认、幂等结果和独立凭据交付     |
| 作业名单           | Assignment.classId、policy.ts、queries.ts | 按当前单班成员判断，未冻结接收人            | 公共选择表达式、解析和接收人快照；列表、资产、提交和复核一起切换 |
| AI                 | ai-providers、grading-runner、admin.ts    | Chat 适配已存在；密钥从 env、缺模型阻止提交 | provider/model/task 版本、Gateway、Anthropic；缺配置仍保存作答   |
| SMTP / 密钥        | 无公共实现                                | 无验证码、无安装闭环                        | SecretStore、受限出口、版本化 SMTP、验证码和安装向导             |
| 几何 / 自测 / 成绩 | geometry-*、learning、decisions           | 已有统一图纸、曲线、正式成绩教师发布        | 保留契约、实体 ID、权限、队列和历史；加入身份及受众回归          |

## 权限矩阵（已实施约束）

| 操作          | admin                    | 学校                   | 教师                 | 学生             |
| ------------- | ------------------------ | ---------------------- | -------------------- | ---------------- |
| 学校创建/停用 | 指定学校，敏感操作再认证 | 不可                   | 不可                 | 不可             |
| 教师管理/重置 | 指定学校                 | 本校                   | 不可创建教师         | 不可             |
| 班级/学生管理 | 明确学校与教师范围       | 本校                   | 本校且授权班级；建班 | 自己安全设置     |
| 发布任务      | 指定学校，显式复核人     | 本校，显式复核人       | 授权接收人           | 不可             |
| 作业作答/文件 | 不因管理权读取私有作答   | 不因管理权读取私有作答 | 明确复核授权         | 自己且实际接收人 |
| 正式成绩      | 无隐式发布权             | 无隐式发布权           | 获授予复核范围       | 只读已发布       |
| 自测/错题     | 无管理旁路               | 无管理旁路             | 仅本人               | 仅本人           |
| AI / SMTP     | 近期再认证               | 不可                   | 不可                 | 不可             |

任何账号未完成首次改密时只有启用/安全/退出权限。学校与教师还须验证邮箱；网站管理员和学生可选绑定邮箱。根 admin 唯一固定登录 ID admin，首次改密后直接进入后台，邮件服务只在后台配置，移除安装向导中的 SMTP 步骤。两个域分别退出、撤销和验证；停校立即阻断本校会话与后台调用。

2026-11-17 调整：`2026111701_admin_optional_email` 仅为已经完成改密的根账号回填安装完成标记，不修改密码、邮箱或其他账号。服务端按当前账号状态重新判断旧根会话的启用权限，旧设置页链接自动转到后台；首次改密和会话撤销检查仍然生效。

## 数据与切换决策

1. expand：保留 User ID、历史作答/成绩/几何 JSON；添加学校、账号种类、realm、登录 ID、验证邮箱、凭据版本和启用状态。旧 email 不自动标记已验证。旧 roles 只作迁移兼容，不再允许 UI 改角色。
2. read-only 审计：scripts/identity-audit.ts 输出角色冲突、计数和任务状态；多角色或缺学校归属必须显式映射。学校/班级/学号按唯一约束回填，不猜测真实历史关系。
3. 添加验证码、SecretRecord、SMTP 版本、导入交付、AssignmentRecipient、AI 配置/调用；新请求只走新契约。旧配置和 run 留作审计，旧任务使用原快照；无可用凭据明确阻塞。
4. 作业名单以切换时成员和已提交者生成兼容快照，并标记 inferred；旧班级没有成员历史，不能声称还原发布当天名单。切换前报告权限差异。
5. auth 切换撤销旧会话；保存正式数据不重写。逐级关闭旧账号/model:sync 等运行入口。历史字段可保留只读，不急于 DROP。
6. 加密主密钥在独立部署环境；备份数据和主密钥分别保管。迁移演练记录各表计数与关联；数据库恢复与匹配版本的 Web/Worker 一起回滚，不能仅回滚代码。

## 阶段执行与门禁

- A：现状、矩阵、迁移审计与计划（本提交）。
- B：版本契约/数据扩展 → SecretStore/出口保护 → SMTP/验证码 → 双域认证/首次设置/admin 安装；安全单元及集成测试。
- C：学校/教师/班级/学生用例与页面 → XLSX 预检/执行 → 限时分开交付；幂等与跨校测试。
- D：AudiencePicker/解析/发布快照 → 所有列表/资产/提交/复核权限切换；排除和名单修订回归。
- E：AI Provider/Model/Binding 管理 → 协议适配 → Gateway/任务快照/共享并发 → 保留 grading-core 与 outbox；无模型提交回归。
- F：响应式真实浏览器、迁移/恢复演练；typecheck、lint、unit、integration、E2E、build；逐项记录结果与限制。

验收编号采用附件 ID01–11、IM01–07、AU01–06、AI01–08、EM01–03。本文件保留各阶段当时的记录；当前完成状态和最终实测见 [验收报告](IDENTITY_AI_ACCEPTANCE.md)。实际 SMTP 投递、协议替身测试与真实模型调用分别记录；无凭据不伪称外部服务通过。本轮不调用付费模型验证，不新增照片识别、不改几何格式、不创建第二套评分流程。

## 阶段 B 进行记录（2026-11-16）

- 扩展迁移 2026111601 已在开发库执行；迁移前 pg_dump 位于 git 忽略的 .runtime/identity-backup。旧 ID 与历史记录保留。
- 学生与 STAFF 各自 NextAuth 配置、签名派生、cookie、CSRF 和 JWT audience；原共享认证接口返回 410。首次设置状态在数据库与服务端 guard 检查。
- 新密码限制 12 字符 / 72 UTF-8 字节；随机临时密码 20 字符；验证码 HMAC 摘要、5 分钟/60 秒重发间隔/5 次错误、锁行单次消费；多维限流。邮件同步发送，不持久化验证码正文。
- AES-256-GCM SecretStore，AAD 绑定 ID/用途；密钥轮换由 keyId 区分。出站 DNS 校验后绑定连接地址，禁止重定向/内网，部署白名单可允许本地 SMTP。
- NextAuth v4 的可选 nodemailer 7 peer 与当前安全版本冲突；实际 EmailService 仅使用别名 tuheng-smtp-client（nodemailer 10.6.0），未强制忽略 peer。ExcelJS 4.4.0（MIT）用于后续 XLSX；间接依赖告警及可达范围记录在 F 阶段验收报告，未强制跨主版本升级。
- 类型检查通过；身份安全单元 6/6、真实 PostgreSQL + 本地 SMTP 接收器集成 4/4。集成曾因未解码 MIME 提取了错误验证码失败，改为解码实际收到的 MIME 后通过，未固定验证码或绕过验证。
- 数据库账号无 CREATE DATABASE 权限，改用现有测试库内独立 identity_refactor schema；没有修改数据库用户权限。Prisma adapter 与 SQL search_path 均显式指定该 schema。
- 尚未完成浏览器双会话、旧入口关闭的完整回归、组织/导入/受众/AI 阶段和真实外部 SMTP/模型验收。上述记录不是整轮交付结论。

实现参考：[Next.js 随包认证文档](../node_modules/next/dist/docs/01-app/02-guides/authentication.md)、[Nodemailer SMTP](https://nodemailer.com/smtp)、[OWASP SSRF 防护](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)。SMTP 连接成功与实际接收测试分别记录。

## 阶段 C 进行记录

学校、教师、课程/学期、班级、学生及多班成员用例与响应式管理页面已接入。旧账号角色编辑/明文设置密码/邮箱名单导入入口返回 410，不能绕过新规则。导入四列/三列实际 XLSX，限制 5 MB、25 MB 解压、单工作表、5000 行；拒绝公式身份单元格、数值学号、宏和外链。教师分组/同名班级必须预检确认，支持按行拆分教师组。

导入共用 BullMQ Worker，按批次 ID 排队；每行实体/成员/凭据/进度同事务，重试不会重置已存在用户的密码。凭据分开导出真正 XLSX，短期加密，24 小时交付窗/7 天临时密码；下载需近期再认证、120 秒一次性票据、重新检查权限与版本、no-store。已改密用户的密文清除。

验证：真实 PostgreSQL/Redis/XLSX 的 5 项集成测试通过，覆盖无副作用预检、同名确认、并发确认幂等、重复执行、文本学号、教师/学生文件区分、票据重放、改密撤销、跨校拒绝。测试发现种子账号的 T000001 与新序列冲突，已改为考虑已有登录 ID 的原子序列分配；未删除种子账号规避。浏览器端和大样本性能将在 F 阶段继续验证。

## 阶段 D 进行记录

公共 AudienceSelection / audienceScope / resolveAudience 及 AudiencePicker 已接入真实作业草稿与发布。选择器支持教师/班级展开、全授权范围选择、单人排除、搜索、已选查看、分页和三态勾选；全选由服务端展开，不依赖已加载页。

发布在事务中写 AssignmentRecipient（人员 ID、学校、快照班级、复核教师、revision）；名单预览以 rosterVersion 检查并发变化。发布后的增删走显式修订，已提交学生不能移除；审计保留修订。原班级入口不再给已使用接收人快照的作业额外授权。

实际作业列表、详情、题干/参考资产、草稿、提交、复核、成绩导出改用接收人/复核分工；管理身份可以发布自己题库中的任务，但不能据此查看私有作答或发布正式成绩。统计按接收人快照班级计数；历史无快照路径仅供迁移兼容。

验证：4 项真实数据库集成通过，包括跨班去重/排除、旧班级入口不能授权、后加入班级不能自动获得已发布作业、草稿权限、复核人隔离、过期预览拒绝及显式修订。类型检查通过；浏览器可用性及旧数据名单回填在 F 阶段继续验收。

## 阶段 E 进行记录

- 新提交只按 grading.assignment / grading.selftest 解析数据库中的模块规则，不读取 AI_* 环境变量；无配置也保存作答、提交时间、GradingRun 和 BLOCKED_CONFIG 原因。不创建假模型外键。
- AIProvider → AIModel → AITaskBindingVersion，编辑/启停/归档、受限协议和端点覆盖、能力声明、测试状态、版本恢复、密钥留空保持/显式撤销已接入 AI 中心。版本恢复创建新版本，旧快照不重写。模型价格按管理员维护的版本估算，未知 usage/cost 保留 null。
- Gateway 在调用前检查账号/学校启用状态、供应商/模型紧急停用、SecretStore 凭据撤销，解析全部题干/参考/答案图片能力。跨 Worker Redis 原子预约总并发及供应商/模块/学校/个人日预算；逐次请求和计费未知状态单独记录。
- 普通重试沿用快照；首次无配置的受控重试才选择配置。“使用当前配置重新运行”新建调用与 run；教师正式成绩不改写。
- 两个适配器分别实现认证、system、图片块、输出模式、usage、拒绝/截断/非 JSON/HTTP 错误；未接入第二套评分，grading-core 继续验证/归一化所有结果。
- 已验证：协议/评分单元 35 项；数据库/Redis/本地 HTTP 协议替身及原工作流集成 21 项通过。测试捕获到原 429 错误码已改为统一 MODEL_RATE_LIMIT，更新契约断言后通过。类型检查通过。
- 本地 HTTP 替身只证明请求协议和安全流程，没有调用真实 OpenAI/Anthropic，没有宣称真实模型评分或外部服务已通过。管理测试按钮会明确要求确认费用。
- 协议参考：[OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)、[Anthropic Messages](https://platform.claude.com/docs/en/api/http/messages/create)、[Vision](https://platform.claude.com/docs/en/build-with-claude/vision)、[Structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)。Anthropic 传统 2023-06-01/x-api-key 与 2026-10-21/Bearer 可明确选择，不靠品牌猜测协议。

## 阶段 F：业务贯通、迁移与交付

完成真实浏览器的 admin/学校/教师/学生首次设置、双域同时登录及分别退出、六种登录方式、找回密码、学校交付卡、两类 XLSX 上传/Worker 执行/凭据下载。公共接收人选择与班级/个人复核分工、补发/移除通知接入实际业务。手机更多导航可进入全部工作空间功能，组织与受众的班级/教师列表支持分页搜索。

新增三类安全收口：挑战绑定账号 tokenVersion，改密等安全操作后在途验证码失效；受限根邮箱恢复 CLI；大响应立即关闭连接及 IP 主机的 TLS SNI 处理。服务端身份/资源范围校验保持启用。

实际开发库按显式开发映射回填 6 个账号、1 班和 12 个作业；四个增量迁移已执行。原备份恢复到隔离 schema 后再次迁移及回填成功，七类受保护数据数量和 SHA-256 完全一致。2000 人名册和 2002 行导入经过真实进程中断/恢复验证。不会把测试名册或临时 SMTP/协议替身配置写入开发业务库。

当前真实调用点仅 grading.assignment 与 grading.selftest；未来照片识别等必须新增有实际业务的 taskKey 和输入/输出契约，复用 Gateway/SecretStore/预算，不在编辑器或页面复制协议与密钥代码。当前不开放未实现的 AI 模块。

本阶段各验收编号、实际命令、截图、容量数据与未验证条件统一维护在 [IDENTITY_AI_ACCEPTANCE.md](IDENTITY_AI_ACCEPTANCE.md)，本文件中 B–E 的早期计数不是最终测试总数。
