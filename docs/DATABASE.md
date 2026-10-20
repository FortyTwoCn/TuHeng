# 数据与版本

User + 多角色数组；Course → CourseOffering（含学期）→ TeachingClass；Enrollment 与 TeachingGrant 分开表达选课及授课授权。

Question 指向不可变 QuestionVersion；版本内 reference/rubric JSON 为同一原子快照，有独立版本号、确认标志和 Zod 校验，避免发布时版本错配。关联 KnowledgePoint 以 ID 数组快照保留。AssignmentItem 外键绑定具体版本，发布后不可编辑。

Submission（学生/作业题唯一）→ SubmissionAttempt（递增版本、幂等 key）→ SubmissionAsset（顺序与原图引用）。GradingRun → GradingSuggestion 与 GradeDecision（追加 revision）。发布只更新正式 decision 指针，不覆盖旧记录；AI 无权更新该指针。

SelfTestFolder → SelfTestSet → SelfTestItem 引用 QuestionVersion。自测作答复用 SubmissionAttempt，其 assignment submission 可空；归属 ownerId 始终明确。ErrorBookEntry 引用原 attempt/question，不复制题目。ReviewAttempt 关联原错题与新作答。KnowledgeEvidence 以 decision/knowledge 唯一约束，长期汇总仅使用正式教师发布或明确标识的自测建议。

StoredAsset 私有对象 key、owner、purpose，授权经业务引用检查。BackgroundJob 与 OutboxEvent 在提交事务创建。AuditLog 追加写；ModelConfigurationVersion 不含明文 key，仅环境变量引用。

索引与 FK 见 Prisma/migration。生产仅 prisma migrate deploy，禁止 reset。JSON 字段在应用边界 Zod 校验，不将 provider 原始响应当作业务 schema。
