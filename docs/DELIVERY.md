# 第一轮交付记录

本轮从空仓库实现了可运行的核心教学闭环，以及自测、错题和基础管理。并非需求清单的全部细节已完成。以下只记录实际存在并验证的能力。

## 已实现

- Next.js App Router + strict TypeScript 工作区；Web 与 Node Worker 分开启动，业务用例集中在 domain。
- Auth.js 凭据登录、bcrypt 密码哈希、多角色、服务端资源归属检查、停用/改权限撤销会话、基础登录失败锁定。
- PostgreSQL 关系模型、版本快照、SQL 迁移、事务迁移 runner、演示种子；课程/开课实例/教学班/选课/授课授权分离。
- 教师创建题目、上传题干/参考图或 PDF 材料、知识点、逐项细则、十分之一分整数分、教师确认、新版本编辑、复制题目、停用题目。
- 作业草稿、授权班级发布、时间/迟交/提交次数/答案开放策略；发布固定具体题目与参考/细则版本。
- 学生作业筛选、真实 S3 上传、进度/失败重试、多图排序移除、旋转裁切、草稿、幂等正式提交、历史版本与服务端时间。
- outbox + BullMQ、正式作业/自测独立并发预算、有限重试、运行租约、失效租约恢复、Redis 丢失排队任务的数据库补偿。
- 独立 contracts、grading-core、ai-providers、image-pipeline；真实 OpenAI-compatible 多图视觉适配（json_object / json_schema）、响应格式转换、超时限流处理、环境代理支持、仅测试 Mock。
- 结构化评分、逐项证据、错误诊断、知识点局部证据、总分校验、扣分上限、相关错误复核、未知项 null、提示词/模型/策略版本记录；原始响应与建议分开保存。
- 原图/处理图、基础图纸批注；教师逐项人工评分/指导/人工批注/AI 误判标记、追加决策版本、单个与批量发布；AI 不能修改正式成绩。
- 学生正式反馈、申诉、教师处理与更正历史；成绩发布后错题归集，知识点汇总只统计当前正式决策，避免更正前后重复累计。
- 私人自测文件夹、题集、材料关系记录、上传练习、统一任务流、记录和重复练习；学生不能伪造“教师验证”参考答案标志。
- 错题按来源/章节/知识点筛选、分组折叠、多选移出、手动收录、回练和历史引用；移出不删除成绩。
- 管理员用户搜索/创建/CSV 导入/启停/角色/密码恢复，教学组织维护；教师可将已有学生账号按邮箱导入授权班级。
- 模型配置状态与实际视觉连接测试入口、调用状态、任务搜索/详情/原配置重试/新配置新运行、操作审计、数据库/Redis/S3 健康与运行限制、基础成绩分布/提交率/CSV 导出。
- 响应式中文界面，深蓝/蓝绿色品牌、桌面侧栏、手机底栏、教师图纸与评分分栏。

## AI 调用链与替换位置

学生提交 → domain/submissions.ts 在事务中创建 attempt/run/job/outbox → Worker 投递与消费 → GradingRequest v1 → SharpImagePipeline → GeometryGradingEngine → VisionProvider → Zod 与确定性校验 → GradingSuggestion → 教师 GradeDecision → 显式发布 → 学生反馈/知识证据/错题。

- `packages/contracts/src/index.ts`：稳定输入输出、rubric、诊断和批注 Schema。
- `packages/grading-core/src/index.ts`：GradingEngine、ImagePreprocessor 和逻辑分析阶段。
- `packages/grading-core/src/validation.ts`：评分规则与归一化；可独立测试。
- `packages/grading-core/src/prompts.ts`：源代码版本化提示词，升级应新增版本。
- `packages/ai-providers/src/index.ts`：实现 VisionProvider 更换供应商；UI 不接触其原始格式。
- `packages/image-pipeline/src/index.ts`：保守预处理与归一化矩阵；预留 PerspectiveStrategy，不伪称自动矫正。
- `packages/infrastructure/src/grading-runner.ts`：模型与图片适配器组合、运行租约和结果持久化。
- `packages/domain/src/decisions.ts`：教师确认和正式发布边界，算法重写不应触碰正式成绩。

## 验证记录

最终运行结果以本节末尾的实际命令记录为准。测试数据使用 `[自动化测试]`、`[E2E流程测试]`、`[E2E自测]`、`[压测]` 明确标记，并与本地演示班之外的自动化测试课程分离。Mock 建议仅来自自动化集成测试并标识 `MOCK_TEST_ONLY`；浏览器演示的 9.4 分由教师操作输入，不是模型产出。

已完成两轮本地 20 用户、并发5的成功压测；最近一轮 20/20 成功，总耗时1015ms，含实际账号、S3 上传、提交与 Redis 投递；提交事务 p50 59ms、p95 737ms。前期压测暴露事务冲突错误类型与连接未释放问题，修复后重跑并确认脚本正常退出。该结果不代表2000用户容量，也不衡量模型吞吐。

真实视觉模型调用未执行：没有可用的 AI_API_KEY/AI_MODEL，当前网络也没有开放 OpenAI 目标。环境中的 DeepSeek 凭据未被擅自复用或当作视觉支持证明。真实连接、真实图学评分质量与准确率均未验收。按 OPERATIONS.md 配置支持视觉的服务、同步配置版本并启动 Worker 后，可在任务页新建运行，完成手动验收。

## 尚未完成与限制

- 题目发布前的独立 AI 解析任务及教师逐字段编辑界面；当前由教师手动填写并确认，评分运行的题意分析可在建议中查看。
- 自测题目自动拆分、AI 生成参考答案、PDF 自动转图/拆题；当前每题集一道手动确认题，材料关系只是明确记录。QUESTION_ONLY 不会伪造参考答案，需要提供文字预期关系且始终未验证。
- 自动四角检测/透视矫正、专用几何关系检测、多模型交叉验证、经过校准的准确率。预处理不进行生成式补图，也不粗暴二值化/去噪。
- 完整课程共享题库 UI、COURSE_MANAGER 的课程范围授权工作台及课程负责人设置。角色名称和归属字段已保留；没有开放课程管理员越权改成绩。
- 作业复制、单次作业对题目分值的独立覆盖、细粒度批量导入报告、完整账户自助恢复邮件流程。当前密码恢复由管理员安全重置。
- 完整的常见扣分项/错误知识点聚合报表、个人多维学情深钻；现有基础图表、名单提交、正式成绩与 CSV 为真实数据。
- 大数据量服务端分页、全局多 Worker 并发预算、2000人持续负载与故障演练、生产监控告警/数据保留清理/文件扫描系统。当前用户/任务列表最多100，复核工作台最多200条；生产使用前应改为分页查询和数据库聚合。
- 本地依赖使用 Compose；Web/Worker 的生产容器镜像、TLS 网关与机构环境部署仍需下一轮验证。未向外网发布网站。

## 建议下一轮

1. 配置真实视觉模型，建立教师标注的点/线/面投影和三视图样本集；固定版本比较细线保留、几何证据、未知项、等价画法与定位可靠性。
2. 完成题目理解确认与自测解析后台任务，避免错误参考依据扩散。
3. 补齐范围授权、共享题库、分页/聚合查询、2000人阶梯负载和 Worker 故障恢复演练。
4. 在机构环境验证私有对象存储、备份还原、限流、密钥配置和观测告警，再进入真实学生试点。

## 最终实际命令结果（2026-10-19）

| 检查                                                                         | 实际结果                                                                              |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `npm run db:generate`                                                        | 通过，Prisma Client 6.19.3                                                            |
| `npm run db:migrate`                                                         | 通过，初始迁移已应用，重复执行无重建                                                  |
| `npm run db:seed`                                                            | 通过，演示账户/班级/知识点及私有 bucket 可用                                          |
| `npm run typecheck`                                                          | 通过                                                                                  |
| `npm run lint`                                                               | 通过，0错误、0警告                                                                    |
| `npm test`                                                                   | 35/35 通过，3个测试文件                                                               |
| `npm run test:integration`                                                   | 15/15 通过，实际 PostgreSQL + Redis + S3，视觉 Provider 明确为测试替身                |
| `npm run build`                                                              | 通过，Next.js 16.4.2 生产构建                                                         |
| `PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e`                | 4/4 通过，14.7s，连接 `npm start` 生产服务器                                          |
| `LOAD_CONFIRM=local-test-only LOAD_USERS=20 LOAD_CONCURRENCY=5 npm run load` | 修复后20/20成功，退出码0，未调用模型                                                  |
| 生产运行与 Worker                                                            | `npm start` 登录页 HTTP 200；Worker 两队列启动成功，未配置模型任务显示 BLOCKED_CONFIG |
| 真实视觉评分、2000用户持续负载、灾备还原演练                                 | 未执行；不得视为通过                                                                  |

浏览器覆盖：教师建题发布→学生真实上传提交→跨学生图纸拒绝访问→人工复核发布→学生成绩与错题；管理员创建搜索停用；私人自测创建/提交；未登录与跨站写入拒绝、390px手机布局无横向溢出。手机截图在本地 `test-results/student-mobile.png`，Playwright 报告在 `playwright-report/`（运行生成，未入源码）。

## 几何编辑器交付（2026-11-14）

本轮新增 `packages/geometry-core` 与 `packages/geometry-editor`，扩展 contracts、domain、grading-core、database 和 Web 的现有题目、作答、复核页面。四种编辑器共享 registry、几何内核、Pointer Events 与 SVG 实现。没有增加照片识别、OCR、识别任务表、专用队列或无效识别按钮。原图片上传及历史作答继续保留。

VHW、三视图、正等轴测、斜二等轴编辑器均支持点、有限实/虚线、无限辅助线、平行/垂直线、圆、圆弧、三点定义及平行/垂直投影面、选择/框选、移动/复制/删除、属性、撤销/恢复、吸附确认、缩放/平移、电子笔拟合和虚拟直尺。正投影模式提供跨视图点/线段关联及偏差分析；三视图默认隐藏点名。轴测模式使用文档中的投影参数与轴向吸附。

GeometryDocument 使用 `tuheng.geometry/1.0.0`、mm 单位、稳定对象/视图/图层/关系 ID；原始文档通过真实运行时 Schema 加载。非法版本、悬空引用、循环引用、非有限坐标、退化投影轴及不一致的线型/图层被拒绝。未知空间坐标保留 null。计算关系、显式关系和确认吸附来源分开记录；投影关联保留学生实际坐标。JSON、中文关系描述、SVG 都来自同一文档。

教师题目版本保存蓝色题干，学生草稿和正式作答保存独立几何快照。服务端依据已冻结题干检查所有对象与结构，拒绝越权篡改。正式提交在原事务中生成 geometryEvidence，经原 outbox、BullMQ、Worker、Provider 和教师 GradeDecision 流程处理。几何请求使用新提示词 `geometry-review/1.1.0`，旧图片快照与 `1.0.0` 继续兼容。定位返回经对象、关系及错误 ID 校验后展示，AI 不发布成绩。

迁移 `packages/database/prisma/migrations/202611140001_geometry/migration.sql` 为 QuestionVersion 增加 geometryDocument，为 Submission 增加 draftGeometry，为 SubmissionAttempt 增加 geometryAnswer、geometrySchemaVersion；全部 nullable，无删表或重建。已生成 Prisma Client 并应用到本机开发库和隔离测试库。

| 最终检查                   | 真实结果                                                    |
| -------------------------- | ----------------------------------------------------------- |
| `npm run typecheck`        | 通过                                                        |
| `npm run lint`             | 通过，0 错误、0 警告                                        |
| `npm test`                 | 51/51，4 个文件                                             |
| `npm run test:integration` | 16/16，真实 PostgreSQL、Redis、S3；模型仅使用明确的测试替身 |
| `npm run test:e2e`         | 7/7，33.5s；本机 Chrome，连接 Next dev                      |
| `npm run build`            | 通过，Next.js 16.4.2 生产构建，包含 `/geometry`             |
| Git 空白检查               | 通过，使用 Windows CRLF 约定                                |

几何浏览器覆盖包含四类型绘图、线型语义转换、圆/圆弧、撤销/恢复、JSON 下载与非法导入、自定义视图 ID、跨视图关联、电子笔沿虚拟尺拟合、SVG 清除瞬态图形、教师建题发布、学生草稿重载/提交、后端题干防篡改和教师只读复核。原有图片上传、人工发布、自测、管理与权限流程全部重跑。

生产构建已在本机回环地址启动预览，登录页 HTTP 200。登录后访问 `http://localhost:3000/geometry`；该预览仅供本机访问。

性能夹具包含 513 个对象（100 点、300 线段、50 圆、50 圆弧、3 面及10个关联投影点）。本机核心分析和导出实测约45.1ms，关系达到3000条上限时描述明确说明截断，原对象完整保留。390px 手机视口中夹具加载、双指缩放和适应画布测试完成，脚本总耗时695ms，无横向溢出。该数字包含自动化操作，不是屏幕帧率或手写笔延迟指标。截图为 `test-results/geometry-mobile.png`。

验收期间修复本机 Redis 默认目录的快照保存失败。当前数据和日志目录为 `D:\Project\WebStorm\TuHeng-data\redis`，后台保存状态为 ok，未关闭持久化保护。独立本机依赖启动脚本仍位于 `D:\Project\WebStorm\TuHeng-data\Start-Dependencies.ps1`。Redis 故障导致的一轮集成失败已在修复后完整重跑通过。

文档与示例：

- [架构、目录、组件接口和入口](GEOMETRY_EDITOR_ARCHITECTURE.md)
- [GeometryDocument Schema](GEOMETRY_EDITOR_SCHEMA.md)
- [工具、触控与电子笔交互](GEOMETRY_EDITOR_INTERACTION.md)
- [中文描述及现有 AI 流程接入](GEOMETRY_EDITOR_AI_EXPORT.md)
- [VHW 示例 JSON](geometry-examples/VHW_PROJECTION.json)、[三视图](geometry-examples/THREE_VIEW.json)、[正等轴测](geometry-examples/ISOMETRIC.json)、[斜二等轴](geometry-examples/OBLIQUE_DIMETRIC.json)
- [确定性中文导出示例](geometry-examples/VHW_PROJECTION.txt)：保留并描述 V、H 面的 2.000mm 投影偏差。

尚未验收：真实 Apple Pencil/Android 手写笔的延迟、掌触抑制及 Safari 行为；真实 AI 服务的几何评分准确性。本轮使用真实保存和队列，模型测试替身仅存在于自动化测试。下一轮先进行真机与教师样本验收，再增加学生/教师照片识别导入；识别结果继续通过同一 GeometryDocument 校验和加载接口，编辑器不直接调用识别或评分模型。

## Logo 与登录页调整（2026-11-14）

使用用户提供的几何图标 SVG，保留原始图形路径、配色及透明背景，统一用于登录页、学生/教师/管理端共用侧栏和浏览器标签图标。公共组件位于 `apps/web/components/BrandLogo.tsx`，资源位于 `apps/web/public/brand/tuheng-logo.svg`。登录页的投影装饰改为共用顶点的 SVG，移除指定的 AI/教师确认提示和本地演示账户说明。

类型、Lint、51 个单元测试、16 个集成测试、7 个 E2E（33.4s）及生产构建全部通过。额外使用生产预览检查 1440×900、1280×720、820×1180 和 390×844 视口，Logo 加载、标签图标、文案移除、投影图边界与无横向溢出均通过，检查了登录后的共用侧栏。桌面与手机截图为 `test-results/login-brand-desktop.png` 和 `test-results/login-brand-mobile.png`。

后续按反馈重绘登录页三投影面装饰：H 作为水平底面，V/W 作为竖直面，三面共用原点，增加低对比网格、半透明面色和同一空间点的正投影连线。组件为 `apps/web/components/LoginProjection.tsx`。装饰在 320px 窄屏按可用宽度缩小，避免覆盖标题；桌面、平板和手机截图位于 `test-results/login-projection-*.png`。

此次重绘后重新执行类型、Lint、51 个单元测试、16 个集成测试、7 个 E2E（33.1s）与生产构建，全部通过。生产预览对 1440、1280、820、390、320px 五种屏宽检查通过。

## GitHub 同步交付（2026-11-14）

最终登录页将投影图放大并固定于深色面板右下角，右侧部分在登录区域边缘裁切，形成被遮挡的层次。标题与说明位于装饰上层；竖屏限制图形相对面板的宽度，手机端继续使用紧凑装饰。README 已补充几何编辑器功能、文档导航、下一轮照片导入范围及 [登录页预览](images/login.png)。

最终类型、Lint、51 个单元测试、16 个集成测试、7 个 E2E（37.8s）和生产构建全部通过。生产预览检查桌面、紧凑桌面、平板、390px 和 320px 手机屏宽，裁切构图、无横向溢出及表单点击均通过。本次提交包含本轮几何编辑器、教学/评分集成、迁移、示例、品牌资源与文档；本机环境文件、依赖数据和 IDE 设置不进入版本库。

## 几何入口登录修复（2026-11-14）

修复未登录访问 `/geometry` 时，认证错误被通用错误边界显示为“暂时无法加载”的问题。未登录或会话失效现在跳转到登录页，登录成功后返回几何编辑器；其他运行错误仍由错误边界处理。登录返回地址校验同源并拒绝站外跳转与登录循环，原有角色首页行为保留。

类型、Lint、59 个单元测试、16 个集成测试、9 个 E2E（37.3s）及生产构建全部通过。新增浏览器回归覆盖未登录跳转、登录后返回、会话清除后重新登录和站外返回地址拒绝。额外在 `next start` 生产预览完成同一登录往返流程及实际绘点，未出现客户端异常；截图为 `test-results/geometry-auth-fixed.png`。架构文档同步记录入口行为。
