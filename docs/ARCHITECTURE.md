# 模块化单体

apps/web: Next.js App Router、Auth.js credentials、React 响应式页面、薄 API。
apps/worker: 独立 Node.js 进程，outbox 调度与 BullMQ 消费。
packages/contracts: Zod 版本化输入输出与批注；无基础设施依赖。
packages/domain: 纯规则、权限端口与应用用例；无 Prisma / Next / 队列依赖。
packages/grading-core: 分阶段策略、版本提示词、确定性结果校验；只依赖 contracts。
packages/ai-providers: OpenAI Chat Completions、Anthropic Messages 协议适配与仅测试 Mock。
packages/image-pipeline: Sharp 保守处理、人工变换、变换记录。
packages/database: Prisma schema、迁移、统一工作单元适配器。
packages/infrastructure: 组合应用服务、对象存储、队列、运行持久化与任务恢复。
packages/ui: 通用可访问展示组件。

依赖方向：Web/Worker → infrastructure → domain / grading-core + adapters → contracts。基础设施通过端口注入核心。单库事务保证提交、run、job、outbox 同时落地。队列仅传 run ID；数据库为权威状态。通过条件租约与确定 jobId 幂等执行，过期任务可恢复。

默认本地部署；不使用 Sites 托管，因为本项目明确要求 Node Worker、Sharp、PostgreSQL 与 Redis。独立运行预算保留给正式作业与自测。生产反向代理应限流、限制请求体、TLS、私网依赖与集中日志。

## 教学管理调用链

| 入口                                                             | 页面与命令                                                                 | 核心记录和归属                                               |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `/admin/schools`                                                 | `views/organization/people.tsx` 与 `organization.ts`，校管创建、重置和启停 | School 与本校独立 SCHOOL_ADMIN，近期验证、事务审计、限时凭据 |
| `/{admin,school}/users`                                          | 人员查询、身份与状态修改                                                   | User.schoolId，学生全校身份由管理账号维护                    |
| `/school/dashboard`                                              | `schoolOverview` 实时统计活跃人员、有效课程、开课和班级                    | 会话中的学校                                                 |
| `/{admin,school}/organization/{courseId}/offerings/{offeringId}` | `catalog.tsx`、`teaching-catalog.ts`，分别创建、编辑、归档课程和开课       | School → Course → CourseOffering                             |
| `/{teacher,school,admin}/classes/{id}`                           | `classDetail`、`createClass`、`updateClass`、成员命令                      | TeachingClass、TeachingGrant、Enrollment                     |
| `/{area}/imports` 与 `/{area}/delivery`                          | `RosterImportWizard`、`roster-import.ts` 与名单 Worker                     | 批次绑定操作者、学校和开课，凭据逐行原子写入                 |
| `/{area}/questions`、`/{area}/assignments`                       | `domain/teaching.ts`、`queries.ts` 和 `audience.ts`                        | 题目所有者、版本、作业元数据、发布接收人和复核授权分别检查   |
| 作图属性浮卡                                                     | `FloatingInspector`、`PropertyFields`、`geometry-core`                     | 输入草稿和面板布局属于会话，几何事务写入文档历史             |

路由按身份分派到业务页面。通用表单和抽屉发送类型化命令，服务端解析契约，基础设施负责带学校锁的组织写入、凭据和审计。教学查询经领域端口执行。归档过滤只用于有效组织和新发布；已发布作答继续按快照与时间窗处理。架构边界测试递归检查核心包的源码目录。

教学管理的视觉组件集中在 `apps/web/components/organization/OrganizationPresentation.tsx`，只接收已授权的记录、链接和操作，不计算业务权限。`workspace.css` 由 `.organization-workspace` 限定样式范围；课程、开课、教学班继续由原有业务视图查询，创建与修改继续通过 `OrganizationCommands` 和原有领域命令。人员详情、名单导入、凭据交付复用原组件和接口。桌面以分栏列表展示，手机切换为带明确进入入口的记录卡；筛选和学校范围仍保存在 URL 中。设计与验收见 [教学管理界面优化](ORGANIZATION_UI_ACCEPTANCE_20261119.md)。
