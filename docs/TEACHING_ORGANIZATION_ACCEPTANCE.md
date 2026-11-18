# 学校教学组织与编辑器属性专项验收

审查基线为 `7926ab6224e18dc0c19e313d2e638fa7ece488d5`。本地分支为 `codex/school-teaching-organization`，受验代码和测试的提交为 `1de6eab786a3671e979784736bfcd3d4fa19f113`。后续文档提交附上同一版本的验收证据。

## 基线复现与处理

| 类型             | 基线行为与根因                                                                                         | 修改位置                                                                                                                    | 验收                                                                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 权限调整         | 教师有班级授权便可通过旧命令创建学校课程、开课，或修改和停用学生全局账号。基线权限回归实际返回了成功值 | `identity.ts` 的身份与学校范围、`organization.ts` 的账号及班级命令、`teaching-catalog.ts`                                   | 教师直调建课接口得到 403。教师可在开放开课中为自己建班。改学生全局姓名被拒，退班保留账号和其他班                                                                 |
| 路由缺陷         | 人员与教学组织共用切换标签的容器。学校概览回落到列表，教师班级路径未解析 ID                            | 工作台 catch-all、`Shell.tsx`、`views/organization/`                                                                        | 真实浏览器验证本校统计、两个独立入口、教师班级详情刷新、校管同班详情。未知学校路径返回 HTTP 404                                                                  |
| 课程与学期       | 原开课命令每次新建课程。旧选择器有数量上限                                                             | `teaching-organization.ts` 契约、`teaching-catalog.ts`、`organization-queries.ts` 和课程页面                                | 同一 Course 新增两个学期。不同课程允许同名学期。同一课程重复学期返回 409。集成测试定位超过前 200 条的开课，浏览器实际编辑课程和学期、归档并恢复                  |
| 补建校管         | 原有管理账号只能随新学校创建                                                                           | `createSchoolAdministrator`、学校详情和凭据交付                                                                             | 并发请求只生成一个独立校管。平台管理员在学校详情补建，看到登录 ID 和待改密状态，再重置临时密码、停用、启用                                                       |
| 名单导入         | 原指纹缺少开课范围，相同 Excel 跨学期误认作同一请求                                                    | `roster-import.ts`、导入向导                                                                                                | 同范围重传返回相同批次，跨开课建立另一批次。前导零学号、原密码和账号均保留。归档后预检可查，确认及执行被拒。恢复并重新预检后可继续                               |
| 交接与历史兼容   | 原交接删除该班全部授课授权。历史作业有快照和实时授权两类                                               | `organization.ts`、`classDetail`、`audience.ts`、`policy.ts`                                                                | 交接保留联合授课者。核对发布接收人和复核人。退班、交接、归档后仍能按快照再次提交、由原复核教师发布成绩。对原始作答及正式成绩逐字段比较，包含原确认教师和发布指针 |
| 题库与校级作业   | 创建、列表、停用角色不一致。编辑题目或布置作业容易跳到教师后台                                         | `domain/teaching.ts`、`queries.ts`、题目/作业表单及工作台路由                                                               | 校管建题、编辑第二版、选择学生和复核教师、发布并核对快照。未获分派的管理账号不显示学生提交。保留私人题库和自测隔离                                               |
| 编辑器动作和图层 | 桌面动作位于长表单底部。390×844 基线实际找不到标题内复制。多选线型曾固定为学生选项                     | `FloatingInspector.tsx`、`PropertyFields.tsx`、`ConnectionTools.tsx`、样式、核心 `document.ts` / `tools.ts` / `commands.ts` | 六种视口在滚动正文后检查动作命中，再真实点击复制、撤销、删除并比较文档实体。校验题干图层、多选原子性、共享节点重映射、只读及有依赖对象                           |

全量复测发现 360px 窄屏确认长度有时未提交。详情面板将刚获得焦点的确认按钮也作为输入字段重新滚入视野，导致按下和抬起之间点击目标改变。用真实鼠标按下并跨两帧抬起，修复前连续三次稳定复现。详情面板改为仅在实际字段聚焦或可视区域改变时调整滚动，修复后完整的按下、移动检验和抬起路径连续三次通过，导出结果均为 28 mm。模拟软键盘收缩场景也连续三次通过。

本次按本地安装的 Next.js 16.4.2 App Router 文档核对了异步 params/searchParams、动态路由、服务端组件与 notFound。旧部署没有快照的作业继续按原教学关系读取。班级交接页分别显示受影响的旧作业及快照作业数量。没有新增转交历史作业批阅权的隐式操作。

## 真实操作路径

学校管理员从「课程与开课学期」建立「工程制图 / EG01」，在课程详情下新建「2026 秋」和「2027 春」。教师从「我的教学班」选择同校开放的「工程制图 · 2026 秋」，创建「制图一班」，再按学号加入学生。校管可在同一个班级详情调整授课教师，教师可在自己的班级管理成员。学生只有一份学校账号，可以同时加入另一门课或另一学期，班级本身始终属于原开课。

校管也可以进入本校「题库」建立版本，再到「校级作业」选学生和复核教师并正式发布。管理者看到作业元数据，学生收到发布时的名单授权，复核教师按每个学生的分派读取作答。

完整职责见[四类账号权限矩阵](PERMISSIONS.md)。建校、选校和交接步骤见[业务流程](WORKFLOWS.md)，模块归属见[架构](ARCHITECTURE.md)。

## 迁移与回退

本轮在隔离库和当前开发库实际应用 `2026111802_catalog_archive`。脚本增加两个默认 false 的归档字段和一个查询索引，沿用 Course.code 的全局唯一索引和历史格式。业务编号显示和冲突检测只剥离与所属学校精确匹配的前缀。主键、开课外键、题目版本、快照和作答无须重写。

| 开发库只读盘点                                   |        迁移前 |        迁移后 |
| ------------------------------------------------ | ------------: | ------------: |
| 学校 / 课程 / 开课 / 教学班                      | 1 / 1 / 1 / 1 | 1 / 1 / 1 / 1 |
| 已发布快照作业                                   |            12 |            12 |
| 已发布无快照作业 / 联合授课班                    |         0 / 0 |         0 / 0 |
| 学校归属缺失、编号前缀异常或冲突、班级归属不一致 |             0 |             0 |

其他环境可用 `npx tsx scripts/organization-audit.ts` 盘点本库。历史异常由管理员确认所属学校，再作独立的数据修复。迁移工具逐条事务执行并验证旧 SQL 校验和。需要回退应用时保留新增字段、v2 导入指纹和已写数据，先暂停组织写入及名单 Worker，再使用兼容版本或前向修复。旧版本包含本轮修复前的教师写权限。恢复前核对范围、归档、未完成批次和已发布快照。

## 测试和证据

| 实际命令 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过，退出 0。构建生成的类型入口复原为开工时的开发版本后再次运行，仍通过 |
| `npm run lint` | 通过，0 错误、0 警告 |
| `npm test` | 22 个文件，240/240 通过 |
| `npm run test:integration` | 9 个文件，59/59 通过，包含真实 PostgreSQL、Redis 和对象存储 |
| `npm run test:e2e` | 生产构建、隔离 Web 与 Worker，Chromium 110/110 通过，5.7 分钟 |
| `npm run build` | Next.js 16.4.2 生产构建通过，退出 0 |

基线单元 238/238 通过，但新增的教师越权建课和手机顶部动作回归均在基线失败。过程中还发现测试环境的明文 SMTP 模式与生产 TLS 策略冲突，改用本地 STARTTLS。一次集成回归有独立 Worker 抢先领取测试任务，模型替身未执行，结果为 BLOCKED_CONFIG。最终集成阶段由用例直接驱动任务，浏览器阶段运行独立 Worker。构建工具曾因 Next.js 版本安全提示退出，相同构建命令重跑成功。所有六条最终命令退出码均为 0。[验收数据](images/teaching-organization-20261118/verification.json)

新增组织测试使用两所学校、各自校管、三名本校教师、多门课程和真实数据库关系。另以缺少校管的历史学校验收补建。浏览器用例通过实际 Web 表单建立账号关系、题目版本、作业和发布名单，集成用例比较持久化结果。测试库与开发库分开，测试专用 Redis 库、对象存储桶和邮件服务独立使用。

| 浏览器证据                                                                                                                                                                                                                                                                                                                                                                                                | 重点                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| [学校概览](images/teaching-organization-20261118/school-overview.png) · [同一课程的两个学期](images/teaching-organization-20261118/school-catalog.png)                                                                                                                                                                                                                                                    | 独立校管导航，真实统计，单独追加开课               |
| [桌面教师班级](images/teaching-organization-20261118/teacher-class-1366.png) · [手机教师班级](images/teaching-organization-20261118/teacher-class-390.png)                                                                                                                                                                                                                                                | 授课教师、课程与学期、成员及可用操作               |
| [360](images/teaching-organization-20261118/inspector-360.png) · [390](images/teaching-organization-20261118/inspector-390.png) · [768](images/teaching-organization-20261118/inspector-768.png) · [1024](images/teaching-organization-20261118/inspector-1024.png) · [1366](images/teaching-organization-20261118/inspector-1366.png) · [1440](images/teaching-organization-20261118/inspector-1440.png) | 编辑器滚动正文后的动作区，与实际点击和文档断言配套 |

长度输入和窄容器例子取自真实操作截图。[手机长度输入](images/teaching-organization-20261118/edit-length-360.png) · [桌面长度输入](images/teaching-organization-20261118/edit-length-1366.png) · [大屏内嵌两个编辑器](images/teaching-organization-20261118/two-editors-narrow.png)

浏览器尺寸为 360×800、390×844、768×1024、1024×768、1366×768 和 1440×900。另测试宽屏内嵌窄编辑器和两实例焦点隔离。真实鼠标路径由 Playwright Chromium 驱动，模拟触点、笔事件及键盘导致的视口缩小有单独覆盖。未使用真实 iPad、Apple Pencil、手机输入法或外部邮箱。邮件回归使用受信任测试证书和本地 SMTP 协议替身。模型使用自动化测试适配器，未验证真实供应商调用或评分质量。

## 清理与交付记录

| 处理       | 内容                                                                                                                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 删除       | 无调用者的 UsersView、OrganizationView、ClassesView、AdminForms、旧 OrganizationConsole，以及已退休动作背后的 createUser / updateUser / importRoster 等实现                                      |
| 迁移与合并 | 按人员、学校概览、目录、班级详情拆分工作台。共用有范围的选择器、表单和命令入口。编辑器归并合法线型和拓扑检查，移除旧 setSegment 和空 Inspector 包装，PlaneCreator、PlaneTools 继续由可达入口使用 |
| 保留       | 旧管理入口的 410 响应、既有 SQL 迁移、geometry-v1、旧作业实时授课关系、原图和派生链、历史版本、正式成绩、任务和审计                                                                              |
| 代码提交   | `af25da1` 课程权限、归档和迁移。`7fbf805` 后台业务、名单及退休接口清理。`3f90b6f` 属性卡及核心命令。`8397bd8` 投影轴属性文案。`f1b08a1` 管理和历史作答验收，`1de6eab` 窄屏输入确认                                       |

<details>
<summary>按提交查看代码、迁移和测试文件</summary>

**af25da1**

```text
M	apps/web/app/api/organization/[operation]/route.ts
M	packages/contracts/src/index.ts
A	packages/contracts/src/teaching-organization.ts
A	packages/database/prisma/migrations/2026111802_catalog_archive/migration.sql
M	packages/database/prisma/schema.prisma
M	packages/domain/src/audience.ts
M	packages/domain/src/entities.ts
M	packages/domain/src/queries.ts
M	packages/domain/src/teaching.ts
A	packages/infrastructure/src/organization-queries.ts
M	packages/infrastructure/src/organization.ts
M	packages/infrastructure/src/roster-import.ts
A	packages/infrastructure/src/teaching-catalog.ts
A	scripts/organization-audit.ts
M	tests/integration/roster.test.ts
```

**7fbf805**

```text
M	apps/web/app/[area]/[[...segments]]/page.tsx
M	apps/web/app/api/actions/[action]/route.ts
D	apps/web/components/AdminForms.tsx
M	apps/web/components/AssignmentEditor.tsx
M	apps/web/components/QuestionEditor.tsx
M	apps/web/components/Shell.tsx
D	apps/web/components/identity/OrganizationConsole.tsx
M	apps/web/components/identity/OrganizationCreate.tsx
M	apps/web/components/identity/OrganizationRows.tsx
M	apps/web/components/identity/OrganizationSelect.tsx
M	apps/web/components/identity/ReviewerAssignments.tsx
M	apps/web/components/identity/RosterImportWizard.tsx
M	apps/web/components/identity/client.ts
M	apps/web/components/identity/organization-types.ts
A	apps/web/components/organization/OrganizationCommands.tsx
M	apps/web/views/admin.tsx
M	apps/web/views/assignment.tsx
A	apps/web/views/organization/catalog.tsx
A	apps/web/views/organization/navigation.tsx
A	apps/web/views/organization/people.tsx
A	apps/web/views/organization/workspace.tsx
M	apps/web/views/shared.tsx
M	apps/web/views/student.tsx
M	apps/web/views/teacher.tsx
M	packages/domain/src/audience.ts
M	packages/domain/src/policy.ts
M	packages/domain/src/queries.ts
M	packages/domain/src/teaching.ts
M	packages/infrastructure/src/admin.ts
M	packages/infrastructure/src/organization-queries.ts
M	packages/infrastructure/src/organization.ts
M	packages/infrastructure/src/roster-import.ts
M	packages/infrastructure/src/teaching-catalog.ts
M	packages/ui/src/components.tsx
M	scripts/organization-audit.ts
M	tests/e2e/identity-ai.spec.ts
A	tests/e2e/school-teaching.spec.ts
M	tests/e2e/ui-management.spec.ts
M	tests/e2e/workflow.spec.ts
A	tests/integration/teaching-organization.test.ts
M	tests/unit/boundaries.test.ts
```

**3f90b6f**

```text
M	packages/geometry-core/src/commands.ts
M	packages/geometry-core/src/document.ts
M	packages/geometry-core/src/tools.ts
M	packages/geometry-editor/src/ConnectionTools.tsx
M	packages/geometry-editor/src/FloatingInspector.tsx
M	packages/geometry-editor/src/GeometryEditor.tsx
R091	packages/geometry-editor/src/Inspector.tsx	packages/geometry-editor/src/PlaneCreator.tsx
M	packages/geometry-editor/src/PropertyFields.tsx
M	packages/geometry-editor/src/commands.ts
M	packages/geometry-editor/src/styles.css
M	tests/e2e/geometry-components.spec.ts
M	tests/unit/geometry.test.ts
```

**8397bd8**

```text
M	packages/geometry-editor/src/FloatingInspector.tsx
```

**f1b08a1**

```text
M	tests/e2e/school-teaching.spec.ts
M	tests/integration/teaching-organization.test.ts
```

**1de6eab**

```text
M	packages/geometry-editor/src/FloatingInspector.tsx
M	tests/e2e/geometry-ux.spec.ts
```

</details>
