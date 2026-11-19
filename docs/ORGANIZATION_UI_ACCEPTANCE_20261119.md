# 教学管理界面优化 · 2026-11-19

基线：`main` 的 `64d85b1fa8bebca27f48a7dff226f6464f02fce2`。实现分支：`codex/organization-ui-refresh`。

## 真实页面 → 设计参考 → 实现

先登录本机正在运行的网站，截取课程列表、课程详情、开课详情、教学班列表、班级详情、教师、学生、名单导入、凭据交付共 9 个页面，另检查手机和抽屉。

实际发现：搜索按钮因 flex 拉伸达到 82.59px，而输入框仅 41.80px；课程和开课列表只有松散的文字链接；详情主操作与内容贴在一起；导入的范围、模板、上传和高级设置缺乏分组。

使用内置生图工具，将真实课程列表、课程详情、导入页截图与所需功能一并提交，生成 [设计参考图](images/organization-ui-20261119/reference.png)。[完整生图要求](images/organization-ui-20261119/reference-prompt.txt) 明确保留学校范围、课程→开课学期→教学班、人员页签、导入步骤及凭据交付；沿用现有 logo、深蓝和青绿色。参考图仅用于布局与视觉，图中的文字错误与未实现控件未照搬。实际页面使用 React、CSS 和现有 Lucide 图标实现，没有将参考图铺成页面。

## 改动与操作

| 页面 / 问题                  | 实现                                                                        | 主要文件                                                  |
| ---------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------- |
| 学校范围不突出，详情层级不清 | 独立学校范围条、面包屑、课程层级导航；上级链接保留实际范围                  | `views/organization/workspace.tsx`、`catalog.tsx`         |
| 课程 / 学期 / 教学班难以浏览 | 图标、主次信息、状态、明确进入入口；整行链接；手机记录卡                    | `OrganizationPresentation.tsx`、`catalog.tsx`             |
| 搜索控件不齐                 | 输入和查询按钮同为 44px，清除筛选保留学校和上级范围，分页独立收尾           | `views/organization/navigation.tsx`                       |
| 主操作不集中                 | 创建、编辑、归档在标题旁，班级详情区分授课管理和成员列表，抽屉有保存 / 取消 | `catalog.tsx`、`OrganizationCommands.tsx`                 |
| 人员类型不清晰               | 教师 / 学生页签、姓名与身份、教学班、账号状态和详情入口                     | `views/organization/people.tsx`                           |
| 导入操作分散                 | 五步进度，范围和模板一组、文件上传一组；手机纵向排列，列映射按需展开        | `RosterImportWizard.tsx`                                  |
| 选项翻页干扰                 | 只有多页时显示上一页 / 下一页，保留可搜索和分页的真实选择器                 | `OrganizationSelect.tsx`                                  |
| 凭据批次不易辨认             | 创建时间、交付截止、窗口状态、按账号类型分别下载；保留近期身份验证          | `CredentialDelivery.tsx`                                  |
| 样式影响范围                 | 教学管理专属样式，保留现有业务组件；未修改几何编辑器和系统配置的页面规则    | `components/organization/workspace.css`、`app/layout.tsx` |

创建课程 → 点击课程记录 → 新增开课学期 → 点击学期 → 新增教学班 / 导入本期开课名单 → 班级详情加入学生、调整授课或导入成员。原有归档、学校多管理员、学校隔离、作业快照、首次设置和凭据期限继续由原服务端命令处理；本轮无数据库迁移。

## 验证结果

环境：Windows、本机 Chrome `157.0.8103.79`，Next.js `16.4.2`。截图来自 `localhost:3000` 的真实开发数据迁移学校。浏览器回归使用独立的 PostgreSQL `tuheng_test` / `teaching_20261118`、Redis DB 13、测试对象存储桶及端口 3318 的生产构建和独立 Worker。

| 检查                       | 真实结果                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 修改前回归                 | 搜索控件等高测试失败，实测高度差 40.80px                                                                           |
| `npm run typecheck`        | 通过                                                                                                               |
| `npm run lint`             | 通过                                                                                                               |
| `npm test`                 | 22 文件、243 项通过                                                                                                |
| `npm run test:integration` | 10 文件、63 项通过，真实本地数据库 / Redis / 对象存储                                                              |
| `npm run build`            | 通过；首次被 Next 版本安全提示中止，相同命令重试退出 0。该依赖提示仍存在，本轮未升级框架                           |
| 关键 E2E                   | 共 21 个不同用例通过，见下述执行记录                                                                               |
| 六种布局                   | 360×800、390×844、768×1024、1024×768、1366×768、1440×900；课程、学期、班级、班级成员、人员、导入、交付均无横向溢出 |

首轮运行 `organization-layout.spec.ts`、`school-teaching.spec.ts`、`identity-ai.spec.ts`、`ui-management.spec.ts` 共 20 项：19 通过，1 项在点击“清除筛选”后立即读取旧 URL 失败。真实跳转已完成，但断言未等待；修正为 Playwright 等待 URL，未修改业务逻辑或放松断言。新增手机 / 平板触控用例后，完整 `organization-layout.spec.ts` 的 4 项全部通过；其余 17 项已在首轮通过。

验证内容包括：

- 搜索与查询同高、同一水平线，点击课程后进入实际开课记录。
- 清空筛选保留学校范围；人员页签刷新后保留类型；手机取消抽屉不保存。
- `hasTouch` 浏览器模拟下实际 `tap` 课程、开课、班级和取消按钮；新增学期按钮及取消按钮高度 ≥44px。
- 上传在未选开课时不可用，选择实际开课后启用，下载得到真实 XLSX 模板。
- 校管创建课程及两个学期，教师创建班级、加入成员、校管出题与校级发布、编辑和归档 / 恢复。
- 学校多管理员创建及最后一个启用管理员保护；人员敏感操作与未保存草稿保护。
- 真实名单上传、预检、确认、Worker 导入、分别交付凭据、首次设置及认证域隔离。

SMTP 流程使用本地协议测试服务，不代表真实邮箱送达。AI 相关测试覆盖既有配置和协议 / 流程，不宣称真实模型评分效果。手机 / 平板是 Chrome 视口和触控模拟，未用真实 iPad、Safari 或软键盘做硬件验收。本轮未运行全仓所有 E2E；运行的是上述关键业务文件。

本地日志保留在 `.runtime/teaching-round/organization-ui-*.log`，前后完整截图在 `.runtime/organization-ui/`。原有未提交的 `apps/web/next-env.d.ts` 和 `docs/OPERATIONS.md` 已保留；生产构建改写的 Next 类型入口已恢复为开工时内容。

## 实际截图

| 内容               | 截图                                                                                                                                                                                                                        |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 优化前             | [课程列表](images/organization-ui-20261119/before-courses-desktop.png)、[课程详情](images/organization-ui-20261119/before-course-detail-desktop.png)                                                                        |
| 优化后桌面课程详情 | [桌面](images/organization-ui-20261119/after-course-detail-desktop.png)                                                                                                                                                     |
| 手机与平板         | [手机课程卡片](images/organization-ui-20261119/after-courses-mobile.png)、[平板课程详情](images/organization-ui-20261119/after-course-detail-tablet.png)                                                                    |
| 人员和教学班       | [用户管理](images/organization-ui-20261119/after-users-desktop.png)、[教学班列表](images/organization-ui-20261119/after-classes-desktop.png)、[手机班级成员](images/organization-ui-20261119/after-class-mobile.png)        |
| 导入与交付         | [桌面名单导入](images/organization-ui-20261119/after-imports-desktop.png)、[手机名单导入](images/organization-ui-20261119/after-imports-mobile.png)、[凭据交付](images/organization-ui-20261119/after-delivery-desktop.png) |

截图没有初始密码、验证码或供应商密钥。开发页的 Next 开发指示器属于本地开发界面，不出现在生产构建中。截图作为视觉证据，操作结果以真实 E2E 和导入 / 保存数据断言为准。

## 补充：选择学校页

用户补充指出 `/admin/users?choose=1` 仍是纯文字链接。复用本轮视觉规范和真实查询，将各管理入口的学校选择页统一为学校卡片：名称、编号、启停状态、教师 / 学生账号数量、明确的目标页面入口。数量来自现有 `searchSchools` 返回值，包含对应类型的全部账号，不冒充活跃账号数。

桌面为双列，手机和平板窄屏为单列；整个启用学校卡片为可键盘或触控激活的链接，停用学校保留说明但没有进入链接。查询、清除筛选、分页及原有学校范围处理继续复用。没有增加接口、权限规则或数据库变更。

修改位置：`SchoolChoice`（`OrganizationPresentation.tsx`）、`ChooseSchool`（`views/organization/navigation.tsx`）及学校卡片专属样式（`workspace.css`）。

新增浏览器用例先在旧页面失败，再在修改后通过。真实操作覆盖 1440、768、390、360 宽度下触控进入学校、用户和教学班入口分别保留正确目标、停用学校不提供链接、无匹配学校反馈、清除筛选与切换学校。使用隔离数据库的临时停用学校，结束后只删除该测试记录。

本次补充重新运行：类型检查、lint、243 项单元、63 项集成均通过；学校选择及相关组织页面的 **7 项关键 E2E 全部通过**。生产构建首次仍遇上文所述 Next 版本提示，相同命令重试通过。日志为 `.runtime/teaching-round/school-picker-*.log`。触控仍为浏览器模拟。

[优化前](images/organization-ui-20261119/before-school-picker-desktop.png) · [桌面实际页面](images/organization-ui-20261119/after-school-picker-desktop.png) · [手机实际页面](images/organization-ui-20261119/after-school-picker-mobile.png) · [平板实际页面](images/organization-ui-20261119/after-school-picker-tablet.png)
