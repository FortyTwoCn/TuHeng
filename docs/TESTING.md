# 验证策略

纯单元测试无需网站/数据库/Redis：contracts、整数分、评分证据与不确定性、权限、截止时间、变换、Provider 响应适配/超时。Mock 仅在测试注入。

集成测试使用独立测试命名数据，连接真实 PostgreSQL、Redis 与 S3 兼容对象存储，覆盖建题→发布→上传→提交→outbox→core mock→复核→发布→学生查看→错题，以及授权、幂等与已发布保护。

Playwright：真实 Auth.js 登录，学生上传、教师发布/复核、管理员账户操作。压测脚本使用专用测试学生，不在生产运行。每次运行输出实际结果，最终记录于 DELIVERY.md。

真实模型验收需要在后台配置并启用供应商、模型和评分模块的任务绑定，使用授权测试题和明确确认的参考答案，由 Worker 调用并检查建议。正式成绩由具备分派权限的教师确认。测试替身覆盖协议和状态流，不能推断真实模型准确率。

## 教学组织与编辑器回归

测试使用独立 PostgreSQL 数据库或隔离 schema、Redis 库及对象存储桶。迁移、种子、Web、Worker 和测试进程指向同一套测试配置。生产构建浏览器验收设置 `TEST_APP_ORIGIN` 为实际监听地址。SMTP 协议测试可设置 `TEST_SMTP_CERT`、`TEST_SMTP_KEY` 供本地替身提供 STARTTLS，并把测试 CA 配给客户端的 `NODE_EXTRA_CA_CERTS`。生产 TLS 策略继续生效。

| 名称                                                                      | 可验证行为                                                                             |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `teaching-organization.test.ts`、`roster.test.ts`、`audience.test.ts`     | 两校隔离、补建校管、课程跨学期、分页、同文件跨开课、归档与 Worker 重检、交接及快照权限 |
| `school-teaching.spec.ts`、`identity-ai.spec.ts`、`ui-management.spec.ts` | 登录实际后台，分别以校管和教师建课、建班、加成员、出题、发布、验证路由和敏感操作       |
| `geometry-components.spec.ts`、`geometry-ux.spec.ts`、`geometry.test.ts`  | 真鼠标、顶部动作点击命中、输入与撤销、保护题干、共享节点和多实例；六种视口及窄容器     |
| `boundaries.test.ts`                                                      | 核心包及子目录的依赖方向                                                               |

集成的评分用例自行注入测试适配器并领取任务，请让它们独占测试队列。浏览器验收再启动指向同一测试配置的独立 Worker。

运行 `npm run typecheck`、`npm run lint`、`npm test`、`npm run test:integration`、`npm run test:e2e`、`npm run build`。开工前及迁移后可用 `npx tsx scripts/organization-audit.ts` 比对组织、旧作业和异常记录数量。浏览器模拟、真实硬件及外部服务应分别记录。

本轮六种尺寸的截图、真实业务回归与迁移盘点见[教学组织专项验收](TEACHING_ORGANIZATION_ACCEPTANCE.md)。

`organization-layout.spec.ts` 覆盖搜索控件尺寸与对齐、实际课程深链接、清除筛选后的学校范围、教师/学生页签、手机抽屉取消、触控模拟、六种尺寸的横向溢出、导入范围与模板下载。与 `school-teaching.spec.ts`、`identity-ai.spec.ts`、`ui-management.spec.ts` 一起验证创建、修改、导入和凭据交付的实际闭环。参考图、真实页面前后截图及本轮执行结果见 [2026-11-19 教学管理界面验收](ORGANIZATION_UI_ACCEPTANCE_20261119.md)。

学校选择用例另覆盖整卡触控进入、启停状态、真实人员数量展示、用户 / 班级入口的目标范围、无结果和清除筛选；停用学校使用隔离测试记录，不改变已有学校状态。
