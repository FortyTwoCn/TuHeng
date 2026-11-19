# 系统架构

[返回文档目录](README.md)

图衡采用模块化单体。Next.js Web 提供工作空间和 API，Node.js Worker 负责名单导入、评分、资源归档、截止提醒与教学邮件。PostgreSQL 保存业务状态，Redis 承担评分与导入队列及共享限额，S3 保存私有文件。

## 模块边界

| 目录                       | 职责                                                                         |
| -------------------------- | ---------------------------------------------------------------------------- |
| `apps/web`                 | App Router、双域登录、响应式业务页面、请求解析和错误反馈。                   |
| `apps/worker`              | outbox 调度、BullMQ 消费、租约恢复、导入与评分任务。                         |
| `packages/contracts`       | Zod 输入输出、身份/AI/几何/评分契约及版本兼容。                              |
| `packages/domain`          | 角色与资源权限、教学、作答、接收人、成绩、自测等规则和用例端口。             |
| `packages/grading-core`    | 评分阶段、提示词版本、证据与结果归一化；只依赖契约。                         |
| `packages/geometry-core`   | 坐标、投影、拓扑、约束、笔迹拟合、命令、分析与导出。                         |
| `packages/geometry-editor` | 共享 React 编辑器、工具会话、预览、手势、浮层与属性草稿。                    |
| `packages/ai-providers`    | OpenAI Chat Completions / Anthropic Messages 协议适配；Mock 仅测试显式注入。 |
| `packages/image-pipeline`  | Sharp 图片处理、人工变换及记录。                                             |
| `packages/database`        | Prisma schema、历史 SQL 迁移、工作单元与 pg 适配。                           |
| `packages/infrastructure`  | 事务编排、组织服务、私有资产、队列、AI Gateway、邮件和密钥存储。             |
| `packages/ui`              | 通用展示及可访问交互组件。                                                   |

调用方向为 Web / Worker → infrastructure / adapters → domain / grading-core → contracts；geometry-editor → geometry-core → contracts。核心通过端口获得持久化或外部服务，不依赖 Next、React、Prisma 或 BullMQ。架构测试递归扫描核心源码，防止子目录绕过边界。

## 主要调用链

| 入口                                       | 页面 / 交互                                | 业务实现与数据                                                          |
| ------------------------------------------ | ------------------------------------------ | ----------------------------------------------------------------------- |
| `/admin/schools`                           | `views/organization/people.tsx`            | `organization.ts`：School、独立校管、限时凭据和审计。                   |
| `/{admin,school}/users`                    | 人员页、详情抽屉                           | `organization-queries.ts` / `organization.ts`：学校身份与账号状态。     |
| `/school/dashboard`                        | 真实学校概览                               | 会话学校范围内人员、有效课程、开课与班级统计。                          |
| `/{admin,school}/organization` 及详情      | `views/organization/catalog.tsx`           | `teaching-catalog.ts`：Course → CourseOffering → TeachingClass。        |
| `/{admin,school,teacher}/classes/{id}`     | 指定班级详情、成员和授课操作               | 学校能力或 TeachingGrant；Enrollment 与授课变更。                       |
| `/{area}/imports`、`/{area}/delivery`      | `RosterImportWizard`、`CredentialDelivery` | 导入批次、逐行事务、凭据版本及下载票据。                                |
| `/{area}/questions`、`/{area}/assignments` | 建题、作业、接收人选择                     | `domain/teaching.ts`、`queries.ts`、`audience.ts`。                     |
| `/{area}/profile`、`/api/profile` | 资料、头像、邮箱和密码、教学邮件偏好 | `profile.ts`、`avatars.ts`、身份服务和通知同意版本。 |
| `/{area}/notifications`、`/{area}/announcements` | 最近通知、历史、发布公告 | `notification-events.ts`、`notification-access.ts`、`announcements.ts`。 |
| `/api/assets` | 有上下文的上传、读取和取消 | `resource-context.ts`、`resource-paths.ts`、`assets.ts`、`asset-maintenance.ts`。 |
| `/geometry` 与教学编辑器                   | `GeometryEditor`                           | 同一几何契约与命令；独立作图本地导出，教学页经既有草稿/提交用例保存。   |
| `/admin/models`、`/admin/jobs`             | AI 配置与任务诊断                          | `ai-admin.ts`、`ai-gateway.ts`、`grading-jobs.ts`；版本快照与任务幂等。 |
| `/admin/settings/{site,mail}`              | 网站信息与邮件版本                         | domain 配置校验、事务审计、SMTP 和 SecretStore。                        |

业务容器按人员、教学组织、学校概览、导入等职责分开。`OrganizationPresentation.tsx` 只渲染已授权的记录、链接和操作，`OrganizationCommands` 发起规范命令；`.organization-workspace` 限定布局样式，不影响编辑器。URL 保留学校、筛选和分页，路由未知或资源不存在时返回相应错误，不回落到任意列表。

## 提交与任务一致性

一次正式提交在同一数据库事务中保存不可变 attempt、run、BackgroundJob 和 OutboxEvent。队列只传运行 ID，使用确定 jobId 和条件租约避免重复执行。Redis 故障不会丢失已保存作答；调度器重投未完成 outbox，恢复过期租约并补偿缺失队列任务。

Worker 读取运行快照、准备证据，通过 AI Gateway 按 `taskKey` 调用 Provider，评分核心验证结果后保存建议。教师的 GradeDecision 及发布指针使用独立授权和事务，AI 不能写入正式成绩。

## 认证、配置与数据边界

- STAFF / STUDENT 独立认证域；四类账号不通过追加旧角色获得跨后台权限。
- 学校归属、课程父子关系、授课授权、作业管理、复核和私有资源分别检查。
- 凭据加密保存；主密钥在部署配置中，页面/API 不暴露已存密钥。
- 图像文件保持私有，派生资源保留 `parentId` 链；业务读取先授权。
- 模型配置、题目、作答、评分和站点配置保留版本；新增迁移不覆盖历史 SQL。

具体规则见[权限](PERMISSIONS.md)、[数据](DATABASE.md)、[评分](GRADING_ARCHITECTURE.md)与[编辑器架构](GEOMETRY_EDITOR_ARCHITECTURE.md)。
