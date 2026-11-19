# 数据与版本

学校以 School 为根。User.schoolId 记录人员归属。Course 属于学校，CourseOffering 以 (courseId, term) 唯一，TeachingClass 持有 offeringId。Enrollment 以 (userId, classId) 关联学生，TeachingGrant 以同样的组合关联教师。学期名称可以在不同课程重复。同校学号保留前导零，跨班和跨学期复用同一 User。

一个学校可关联多个 `kind=SCHOOL_ADMIN` 的 User，不需要新表或额外唯一索引。建校、首个管理账号、加密临时凭据和审计在同一事务写入。创建后至少保留一个 `active=true` 的校管；首次改密/邮箱验证是独立状态，不影响此数量统计。追加账号、启停校管和启停学校均先锁定同一 School 行，再重新检查账号与范围；并发停用不能让有效校管数量变成零。启用历史学校前也检查至少一个启用校管。历史缺失账号通过原有补建入口修复，不猜测身份、不转换现有教师。此次无需数据库结构迁移，原账号、课程、作答与成绩引用保持不变。

课程编号沿用现存全局索引，新记录按本校标识加业务编号保存。列表、详情和写入回执仅去掉与本校精确匹配的前缀。按业务编号查重时兼顾本校无前缀旧值。迁移 2026111802_catalog_archive 为课程及开课各增加默认 false 的 archived 字段，并增加学校课程查询索引。所有主键、外键和历史版本保持原值。scripts/organization-audit.ts 以只读事务列出归属缺失、前缀异常、业务编号冲突和班级归属不一致的记录。

有效归档状态由课程、开课和教学班三个字段共同决定。课程归档时保留子级原状态。恢复时仅解除该级归档。新学期另建开课及班级，旧班继续指向原开课。

发布名单和复核人保存在 AssignmentRecipient，独立于当前选课和授课关系。audienceRevision 为零的旧发布记录继续按原关系授权。学校盘点、交接和回滚均需区分这两类记录。

名单导入仍用 RosterImportBatch。v2 指纹对操作者、学校、开课、模板及文件内容与列映射共同取摘要。相同范围和文件返回原批次。命中旧指纹时另核对开课与模板，再沿用已有的逐行进度。重新上传相同文件可在未执行的批次刷新预检版本，过期的确认请求会被拒绝。

Question 指向不可变 QuestionVersion；版本内 reference/rubric JSON 为同一原子快照，有独立版本号、确认标志和 Zod 校验，避免发布时版本错配。关联 KnowledgePoint 以 ID 数组快照保留。AssignmentItem 外键绑定具体版本，发布后不可编辑。

Submission（学生/作业题唯一）→ SubmissionAttempt（递增版本、幂等 key）→ SubmissionAsset（顺序与原图引用）。GradingRun → GradingSuggestion 与 GradeDecision（追加 revision）。发布只更新正式 decision 指针，不覆盖旧记录；AI 无权更新该指针。

SelfTestFolder → SelfTestSet → SelfTestItem 引用 QuestionVersion。自测作答复用 SubmissionAttempt，其 assignment submission 可空；归属 ownerId 始终明确。ErrorBookEntry 引用原 attempt/question，不复制题目。ReviewAttempt 关联原错题与新作答。KnowledgeEvidence 以 decision/knowledge 唯一约束，长期汇总仅使用正式教师发布或明确标识的自测建议。

StoredAsset 私有对象 key、owner、purpose，授权经业务引用检查。BackgroundJob 与 OutboxEvent 在提交事务创建。AuditLog 追加写；旧 ModelConfigurationVersion 保留供历史读取；当前 AI Gateway 的供应商版本引用受保护的凭据，业务通过任务绑定选择模型。

索引与 FK 见 packages/database/prisma/migrations。项目通过 npm run db:migrate 事务应用未执行的 SQL 并核对历史校验和。JSON 字段在应用边界 Zod 校验，不将 provider 原始响应当作业务 schema。
