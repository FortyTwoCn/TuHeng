# 模块化单体

apps/web: Next.js App Router、Auth.js credentials、React 响应式页面、薄 API。
apps/worker: 独立 Node.js 进程，outbox 调度与 BullMQ 消费。
packages/contracts: Zod 版本化输入输出与批注；无基础设施依赖。
packages/domain: 纯规则、权限端口与应用用例；无 Prisma / Next / 队列依赖。
packages/grading-core: 分阶段策略、版本提示词、确定性结果校验；只依赖 contracts。
packages/ai-providers: Chat Completions 视觉适配与仅测试 Mock。
packages/image-pipeline: Sharp 保守处理、人工变换、变换记录。
packages/database: Prisma schema、迁移、统一工作单元适配器。
packages/infrastructure: 组合应用服务、对象存储、队列、运行持久化与任务恢复。
packages/ui: 通用可访问展示组件。

依赖方向：Web/Worker → infrastructure → domain / grading-core + adapters → contracts。基础设施通过端口注入核心。单库事务保证提交、run、job、outbox 同时落地。队列仅传 run ID；数据库为权威状态。通过条件租约与确定 jobId 幂等执行，过期任务可恢复。

默认本地部署；不使用 Sites 托管，因为本项目明确要求 Node Worker、Sharp、PostgreSQL 与 Redis。独立运行预算保留给正式作业与自测。生产反向代理应限流、限制请求体、TLS、私网依赖与集中日志。
