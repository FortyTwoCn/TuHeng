# 数据、版本与迁移

[返回文档目录](README.md)

实际模型见 [schema.prisma](../packages/database/prisma/schema.prisma)，按版本执行 [SQL 迁移](../packages/database/prisma/migrations/)。

## 学校与教学组织

| 模型 / 关系      | 含义与约束                                                               |
| ---------------- | ------------------------------------------------------------------------ |
| `School`         | 学校范围与启停状态。                                                     |
| `User.schoolId`  | 人员的学校归属；四类身份由 `kind` 表达，学生/管理认证域由 `realm` 表达。 |
| `Course`         | 学校的课程主数据；编号仍沿用全局唯一存储索引。                           |
| `CourseOffering` | 课程的一次开课，`(courseId, term)` 唯一。                                |
| `TeachingClass`  | 属于一个开课的教学班，保留原 `offeringId`。                              |
| `Enrollment`     | 学生与班级关系，`(userId, classId)` 唯一。                               |
| `TeachingGrant`  | 教师与班级授权，同一教师可多班、同一班可多教师。                         |

同校学号唯一并保留前导零，跨班和跨学期复用原 User。学校可关联多位 `SCHOOL_ADMIN`，不设每校一个账号的唯一索引。建校、首位校管、凭据和审计原子写入；追加/启停校管、恢复学校时锁定学校行，至少保留一位启用校管。

课程新记录存为 `schoolId:业务编号`。页面只去掉与所属学校精确匹配的前缀，查询兼容本校无前缀旧记录。没有批量去前缀、推测归属或改写历史主键；异常由盘点工具报告。

Course、CourseOffering、TeachingClass 各自保存 `archived`。有效状态组合父级与自身状态计算，不批量修改子级；新学期创建新开课与新班，不把旧班挪到新学期。

## 名单、凭据与发布快照

`RosterImportBatch` 保留文件信息、预检版本、范围、状态和逐行进度。v2 指纹包含操作者、学校、开课、模板、内容及列映射；同文件跨开课可独立导入，同范围重试复用批次。旧指纹命中时还核对开课与模板，继续读取旧进度。

`CredentialDeliveryBatch` / `CredentialDeliveryItem` 引用加密初始凭据和账号凭据版本；`CredentialDownload` 保存短时单次票据。改密或重置使旧凭据失效，不提供永久明文查询。

新发布作业的接收人、来源班级、每人复核教师保存在 `AssignmentRecipient`，与当前选课/授课关系分离。已有快照不随退班、交接或归档重算。`audienceRevision=0` 的旧作业保留实时授权兼容路径，盘点、交接和恢复时必须单独说明影响。

## 教学、评分与文件版本

| 数据链                                             | 保留方式                                                      |
| -------------------------------------------------- | ------------------------------------------------------------- |
| Question → QuestionVersion                         | 题干、参考答案、细则、确认标志和知识点形成版本快照。          |
| Assignment → AssignmentItem                        | 绑定具体题目版本；发布后不改写该版本。                        |
| Submission → SubmissionAttempt → SubmissionAsset   | 提交幂等键、递增作答版本、附件顺序和私有原图引用。            |
| GradingRun → GradingSuggestion                     | 固定请求、模型/提示词/策略版本；重试与新运行分开。            |
| GradeDecision                                      | 追加教师决定，正式发布更新指针，旧决定继续保留；AI 无权发布。 |
| SelfTestFolder / Set / Item                        | 私有自测复用题目版本与作答，不变成正式成绩。                  |
| ErrorBookEntry / ReviewAttempt / KnowledgeEvidence | 引用原作答与回练，按证据来源统计；移出错题采用归档。          |
| StoredAsset                                        | 私有对象 key、owner、用途、原图与派生 `parentId` 链。         |
| BackgroundJob / OutboxEvent / AuditLog             | 提交事务、可靠投递和追加审计。                                |

几何文档保存在已有 JSONB 及版本字段中。v1、2.0、2.1、2.2 继续读取；新编辑副本才升级，历史正式数据不回填。详见[几何契约](GEOMETRY_EDITOR_SCHEMA.md)。

AIProviderVersion、AIModelVersion、AITaskBindingVersion 和 AIInvocation 记录配置及调用快照；旧 ModelConfigurationVersion 保留用于历史读取。SMTPConfigurationVersion、SiteConfigurationVersion 追加配置版本。SecretRecord 密文需要对应部署主密钥才能恢复。

## 迁移与回退

`npm run db:migrate` 使用 [scripts/migrate.ts](../scripts/migrate.ts) 执行受审查 SQL，通过 advisory lock、事务、名称与 SHA-256 校验防止重复执行或历史脚本被改写。记录表为 `_tuheng_migrations`，不与 `_prisma_migrations` 混用。

迁移 `2026111901_resources_notifications` 增加题目的学校范围、资源归档和头像、通知投递与公告快照。已有旧附件的开发库应先执行[开发资源切换](OPERATIONS.md#开发资源切换)；没有旧附件时可直接应用。旧通知在此次切换清理。

- 升级先备份，再安装依赖、生成客户端、运行迁移并重启服务，见[运行指南](OPERATIONS.md#升级现有实例)。
- 需要结构变更时新增迁移目录，可用 Prisma diff 辅助生成 SQL，人工审查后执行；不编辑已应用 SQL、不 reset。
- `.gitattributes` 将迁移固定为 LF。runner 只兼容旧 Windows 库的 CRLF 校验差异，不放行其他 SQL 内容变更、不重写旧 checksum。
- 代码回退前核对旧版本是否理解新字段和数据。优先前向修复；如必须恢复备份，应同时恢复匹配的数据库、对象存储与主密钥，并单独处理备份后新增业务数据。

## 资源与通知模型

| 模型 | 保存内容 |
| --- | --- |
| `StoredAsset` | 私有 key、文件校验、生命周期、源资产、授权所有者、归档主体与学校范围。 |
| `AssetUploadSession`、`AssetArchiveTask`、`AssetObjectGarbage` | 有期限的上传上下文、幂等归档和条件切换、旧暂存对象延迟删除。 |
| `Question.schoolId`、`SubmissionAttempt.storageContext` | 固定题库范围及生成评分处理图所需的作答位置。 |
| `User.avatarAssetId`、`avatarRevision` | 当前头像稳定 ID 和用于并发校验的版本。 |
| `User.notificationPreferences`、`notificationConsent` | 总开关、分类偏好和分类同意版本。 |
| `UserNotification`、`NotificationDelivery` | 收件人、业务事件、游标、已读时间；邮件的幂等任务、租约、有效期和结果。 |
| `Announcement`、`AnnouncementRecipient` | 公告版本、内容、发布范围及人员快照。 |
| `AssignmentRecipient.activeSince` | 本次进入有效作业名单的时间，用于催交间隔。 |

业务状态、通知行和投递任务一起提交。资源归档和 SMTP 发送由 Worker 在事务外执行。

## 旧身份与模型迁移

这部分仅用于早期版本实例，不是每次部署都要执行的步骤。

1. 备份数据库、私有对象与主密钥，执行 `npx tsx scripts/identity-audit.ts` 和 `npx tsx scripts/organization-audit.ts` 只读盘点。
2. 明确准备学校、账号与班级映射 JSON。`npm run identity:migrate -- --mapping 文件` 默认预检，审核后加 `--apply`。
3. 工具保留 User.id、题目、作答和正式成绩。迁移旧名单时使用切换时成员与既有提交者形成推断名单并标记 `inferred`，不能宣称还原原发布时间的名册。
4. `--development-template --output .runtime/mapping.json` 仅为开发数据生成明确标记的映射，不用于推测真实学校归属。
5. 旧模型配置通过 `npm run ai:import-legacy -- --legacy-id 配置ID --protocol OPENAI_CHAT_COMPLETIONS --confirm-import` 显式导入。需要图片能力时明确加 `--images`。工具只读取选定旧记录的环境密钥，加密审计并防重；新配置保持停用、不覆盖已有绑定、不发模型请求，之后在后台审查启用。

组织盘点报告无学校归属、错误前缀、业务编号冲突、班级学校不一致，以及有/无发布快照作业数量。无法确认归属的记录保留待修复，不能猜测学校或删除记录。对无原快照的旧 AI 任务，只能明确使用当前配置新建运行。
