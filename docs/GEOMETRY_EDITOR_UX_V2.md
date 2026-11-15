# Geometry Editor UX v2 实施与验收

本轮基线 `8867445`，工作区初始干净。延续现有四类型公共编辑器、统一展开图、权限、拓扑、笔迹与教学业务。阶段提交在本地，不推送或部署。

## A：现状与缺口

| 功能     | 入口、代码                  | 实际行为与缺口                                                     | 本轮修复                                          |
| -------- | --------------------------- | ------------------------------------------------------------------ | ------------------------------------------------- |
| 长度     | Inspector / setSegment      | 已有提交后属性；拖动中只有远处位移文字，无就地尺寸                 | 预览实体计算 HUD，同一参数命令用于浮层与详情      |
| 轴吸附   | snapping / AXIS             | 已有沿轴方向推断；独立点没有实际轴/原点候选                        | 引用解析统一几何，独立原点、射线、换面轴候选      |
| 轴选择   | ViewportDrawing / hitTarget | 轴已绘制，命中仅 entities                                          | 类型化引用、独立选择/修改/引用能力                |
| 框选     | 折叠工具 / box              | 已有工具和粗包围盒检测；默认选择空白无行为，预览为斜线             | 默认空白拖框、Window/Crossing 精确判定、两次点击  |
| 属性     | Inspector                   | 已有下方表单，部分字段每次键入提交                                 | 对象锚定浮层、输入草稿与一次确认、手机摘要/抽屉   |
| 平行垂直 | 折叠工具 / addDrawing       | 辅助线与虚线已有；不可引用轴，缺有限实线和已有线调整               | 同一构造参数命令、两步入口、方向调整及有向绑定    |
| 事务     | Viewport / DocumentHistory  | 拖动一次历史已可用；move 仍全图校验序列化，window 快捷键影响多实例 | 固定 revision、受影响对象预览、局部键盘与分层取消 |
| 布局     | styles.css                  | 多排工具、下方属性、旧三视口覆盖规则仍在                           | 容器布局、两排外壳、按需面板和全屏剩余高度        |

## 参考与产品选择

2026-11-14 已访问并阅读：[Fusion 选择](https://help.autodesk.com/cloudhelp/ENU/Fusion-Model/files/SLD-SELECTION.htm)、[Fusion 约束](https://help.autodesk.com/cloudhelp/ENU/Fusion-Sketch/files/SKT-CONSTRAINTS.htm)、[Onshape 工具](https://cad.onshape.com/help/Content/Sketch/sketch_tools.htm)、[WAI Toolbar](https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/)、[Dragging Movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html)、[Pointer Events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events)、[Floating UI 虚拟锚点](https://floating-ui.com/docs/virtual-elements)、[autoUpdate](https://floating-ui.com/docs/autoupdate)。工具分组、单指替代操作和指针捕获借鉴这些资料；44px、阈值和具体菜单属于本任务的产品选择。

状态分为文档、会话、视口和操作预览。文档包含几何及可追踪关系；工具、选中、面板、镜头、HUD 和输入草稿均不进入答案。指针操作固定文档 revision 与逆 CTM，预览不提交历史；结束校验一次。Esc 按输入/浮层→操作→工具顺序退出。移动时只更新受影响几何，完整校验在提交边界。

## 阶段记录

- A：建立 UX01/05/10/12/15/30 真实鼠标失败回归，复现后进入公共基础修复。
- B：新增统一参考解析与能力权限、2.1 类型化参考关系、Window/Crossing 精确判定、轻量移动预览、精确属性命令及有向方向依赖。87 项单元测试通过；类型检查、Lint 通过。2.0 和 v1 文档继续读取，只有新增参考关系才使用 2.1。
- C–D：六项核心交互、共享参数表单、浮层、手机分组工具与抽屉已接入。24 项新增浏览器/组件场景通过；新建线/圆预览与提交一致、暂停吸附另有 2 项通过。旧回归保留，默认轴吸附使靠轴的合点移到真实轴上，按新规则核对共同引用而不是关闭吸附。
- E：2.1 参考关系接入原草稿、提交、评分请求和教师复核；服务端拒绝伪造轴/题干/引用。99 项单元与 16 项隔离集成测试通过。
- F：生产构建通过；最终浏览器统计见下方命令结果。回归期间修复属性卡侧翻遮挡相邻对象，以及构造预览的确认和 revision 保护。

浮层只增加 `@floating-ui/dom`，已检查包内 MIT LICENSE；用于 SVG 虚拟锚点、滚动和尺寸变化更新，关闭时清理订阅。不增加绘图库或状态管理依赖。

## 六项核心问题的交付位置

| 核心问题                 | 根因                                                   | 实际修复位置                                                                                       | 证据                                                                                                                                             |
| ------------------------ | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| P0-1 拖动实时尺寸        | 旧属性只读已提交文档，预览没有尺寸层                   | core/preview.ts、editor/primitive-preview.ts、MeasurementOverlay.tsx、Viewport.tsx                 | UX01/02 在 mouse.up 前断言真实坐标与吸附后长度；[截图](images/geometry-ux-v2/drag-hud-snap.png)                                                  |
| P0-2 轴/原点吸附         | 旧 AXIS 只有从起点推断方向，没有实际轴几何             | core/references.ts、snapping.ts、reference-relations.ts                                            | UX05–09，四个逻辑轴、非零新轴、原点、缩放与 DPR；[提示截图](images/geometry-ux-v2/axis-snap.png)                                                 |
| P0-3 轴选择/引用         | hitTarget 仅查 entities，将可编辑和可引用混在一起      | contracts/geometry.ts、core/references.ts、editor/interaction-controller.ts、FloatingInspector.tsx | UX10/11/18；基准轴只读、冻结题干可引用、伪造保存被拒                                                                                             |
| P0-4 默认空白框选        | 已有 box 工具，但默认选择空白无操作；几何仅包围盒      | core/marquee.ts、selection.ts、editor/Viewport.tsx                                                 | UX12–14，Window/Crossing、圆弧/无限线、跨视图位移；[矩形截图](images/geometry-ux-v2/window-marquee.png)                                          |
| P0-5 就地精确属性        | 属性在下方，部分输入即提交；没有对象锚点               | core/commands.ts、editor/FloatingInspector.tsx、PropertyFields.tsx、Inspector.tsx                  | UX03/04/15–17/26；一次确认、草稿不中途丢失、[桌面](images/geometry-ux-v2/properties-1366.png) / [手机](images/geometry-ux-v2/properties-390.png) |
| P0-6 平行/垂直入口与行为 | 辅助功能藏在折叠区；不支持轴和有限线，已有线关系不完整 | core/commands.ts、dependencies.ts、editor/commands.ts、ToolPicker.tsx、ConstructionPanel.tsx       | UX18–20/30；工具/对象两种路径、预览确认、方向绑定实际随动                                                                                        |

上表 core 指 packages/geometry-core/src，editor 指 packages/geometry-editor/src。业务改动位于 packages/contracts/src/index.ts、domain/src/submissions.ts、grading-core/src/prompts.ts；复用原流程，无新增模型调用或数据库表。

A 阶段六个新增浏览器用例先在基线失败：拖动没有 HUD、独立点不吸到轴、基准轴不能选、默认空白没有矩形、点击对象没有就地卡、主构造入口不存在。对应测试保留在 tests/e2e/geometry-ux.spec.ts，修复后使用同样的用户路径验收，未统一关闭吸附。旧版本“有工具/函数”与“用户交互已接入”的区别保留在现状表中。

完整生产回归另外发现浮层翻到侧面时会挡住下一次框选、Ctrl 多选和线身拖动；截图复核还发现手机确认按钮受浮层遗留高度限制。FloatingInspector 改为先按下方可用空间限高，再选择备用位置；手机详细抽屉取消遗留高度限制，并固定确认/取消，新增可见区域命中断言。原失败鼠标路径保留。没有用穿透属性卡或手工派发事件掩盖遮挡。

## 命令和权限矩阵

| 目标/命令                         | 可选/可吸附                | 可作参考                | 学生修改/删除                    | 历史与限制                                             |
| --------------------------------- | -------------------------- | ----------------------- | -------------------------------- | ------------------------------------------------------ |
| 基准 X/Z/Y_H/Y_W、轴测轴          | 是；隐藏轴不参与           | 是                      | 否                               | 不伪造成 entity，不进普通删除                          |
| 原点                              | 是                         | 定位锚点；没有方向      | 否                               | 独立目标，无重复基准点实体                             |
| 蓝色题干对象/教师冻结新轴         | 是                         | 是                      | 否                               | 服务端比较冻结定义，伪造 JSON 不能绕过                 |
| 学生对象                          | 是                         | 是                      | 允许，受共享节点/绑定限制        | 拖动、精确参数一次确认一条历史                         |
| 学生新轴                          | 是                         | 是                      | 题目许可时重命名；无依赖才可删除 | 不支持直接重定义轴几何，界面解释影响范围               |
| 默认空白框选、点击选择、聚焦/缩放 | —                          | —                       | 仅会话/镜头变化                  | 不创建文档历史                                         |
| 普通/平行/垂直构造                | 线或轴作参考，已有点可复用 | 允许只读参考            | 新建可编辑对象                   | 定位后预览，确认一次；无限线/有限实线/有限虚线共用命令 |
| 已有线方向调整                    | 先参考后目标               | 同框架或显式 SHEET 范围 | 仅答案线                         | 固定起点/长度；共享端点冲突拒绝；可显式保持有向关系    |
| 合点/取消自动吸附                 | 同框架，允许只读目标       | —                       | 仅移动/改写答案引用              | 拓扑与关系同时撤销；取消吸附只替换当前命令             |
| 属性输入/复制/删除/解除绑定       | 按目标能力                 | —                       | 可编辑且无依赖冲突               | 输入草稿非文档；复制内部引用一同映射                   |

GeometryTargetRef 区分 entity/baseAxis/projectionAxis/origin。会话选择 key 与正式实体引用分离。公共注册表区分状态工具与一次命令；缺参考可进入选参考阶段，轴测模式的新换面轴入口禁用并说明原因。

## 操作状态与事务

| 开始             | 过程                                       | 完成                       | 取消/冲突                          |
| ---------------- | ------------------------------------------ | -------------------------- | ---------------------------------- |
| 空白按下         | pressed → marqueeSelecting                 | 更新选择                   | 不修改文档                         |
| 点/端点/线身按下 | pressed → draggingPoint/Endpoint/Selection | 完整校验，提交一次         | 恢复基础文档；捕获外松手仍正常完成 |
| 绘图工具         | drawingPrimitive / drawingStroke           | 同一预览计算应用到正式实体 | 清除预览；中断笔迹可恢复           |
| 平行/垂直        | 选参考 → 选位置/目标 → 预览确认            | 一次构造/方向命令          | 取消不入历史；外部新文档取消旧会话 |
| 新轴             | 参考/第一点 → 定位 → 展开侧 → 确认         | 轴及派生框架同一事务       | 不自动补答案                       |
| 属性输入         | editingProperties 草稿                     | Enter/确认一次             | Esc 恢复；非法值保留草稿           |
| 空格/平移/双指   | panning / pinching                         | 只更新相机                 | 不影响几何历史                     |

同 revision 的受控回传保留输入和当前预览，外部新 revision 取消未提交操作。每个手势固定指针、工具、基础 revision 和变换；pointerup 清理后再释放捕获。正在画笔时掌触不会改变坐标变换。完整 Schema、分析与导出仅在边界执行；移动预览按动画帧更新，不按采样点序列化整图。

## UX01–UX30 验收映射

表中“通过”指自动化所覆盖的明确场景；硬件边界单列。U=tests/unit/geometry-ux.test.ts，E=tests/e2e/geometry-ux.spec.ts，R=tests/e2e/geometry-repair.spec.ts，C=tests/e2e/geometry-components.spec.ts，B=tests/e2e/geometry.spec.ts，I=tests/integration/geometry.test.ts。

| ID   | 验证内容                                                | 用例/证据                                                                              | 覆盖结果                            |
| ---- | ------------------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------- |
| UX01 | 新建/拉伸尚未松手，图形及灰色 HUD 已变化                | E UX01、R endpoint；真实 mouse.down/move/up                                            | 通过                                |
| UX02 | 吸附预览尺寸与最终引用/坐标一致                         | E UX02/22、新建线与圆                                                                  | 通过                                |
| UX03 | 固定起点/终点/中点精确编辑，一次撤销                    | U 参数命令，E UX03                                                                     | 通过                                |
| UX04 | 空值、负号、非法半径不提交，焦点保留                    | E UX03/04、invalid circle                                                              | 通过                                |
| UX05 | 独立点吸附四逻辑轴，不需要绘线起点                      | U 四轴，E Z 轴真实拖动                                                                 | 通过；四轴逐项算法测试              |
| UX06 | 原点候选独立，精确落点无新增基准实体                    | E UX06                                                                                 | 通过                                |
| UX07 | 旋转偏移新轴真实垂足与坐标转换                          | U offset axis，E UX07                                                                  | 通过                                |
| UX08 | 50/100/200% 与 DPR 1/2 使用同 CSS 距离；光标锚定缩放    | U 比例、E UX08                                                                         | 通过                                |
| UX09 | 沿轴连续拖动，上一候选更新垂足                          | U hysteresis，E UX06/09                                                                | 通过                                |
| UX10 | 基准/新轴可选可引用，只读轴不能删除                     | E UX10、UX07/18                                                                        | 通过                                |
| UX11 | 蓝色/基准定义 UI 拒绝，伪造保存失败                     | R stem，B 403/400，I 冻结题干/伪造关系                                                 | 通过                                |
| UX12 | 默认空白矩形及两次点击替代                              | E UX12、two-click marquee                                                              | 通过                                |
| UX13 | Window/Crossing、圆/圆弧实际几何、无限线规则            | U exact selection，E UX12/13                                                           | 通过                                |
| UX14 | Shift 跨视图多选位移，共享节点只移一次                  | E UX14，R multi-selection                                                              | 通过                                |
| UX15 | 卡不随鼠标走，缩放跟随对象、选择保留                    | E UX15、五种全屏布局                                                                   | 通过                                |
| UX16 | 输入/下拉不穿透、输入焦点稳定                           | E 属性草稿/半径，C controlled echo                                                     | 通过                                |
| UX17 | 手机就地摘要、底部属性及缩小可视区确认可见              | E 360/390、reduced viewport；[截图](images/geometry-ux-v2/mobile-reduced-viewport.png) | 模拟通过；未接真实 OS 软键盘        |
| UX18 | 题干线/基准轴/新轴作参考，有限虚线/实线及无限线方向正确 | E 三种参考、U 复用通过点                                                               | 通过                                |
| UX19 | 已有线方向预览/确认，参考不动，冲突拒绝                 | E UX18/19/20、U shared endpoint                                                        | 通过                                |
| UX20 | 显式保持方向关系，参考变化带动从属，循环拒绝            | E 实际拖动，U cycle/status                                                             | 通过                                |
| UX21 | 5px 端点吸附共享引用，移动连接点带动两线                | E/R merge；[JSON](geometry-examples/ux-v2/merged.json)                                 | 通过                                |
| UX22 | 暂停当前吸附、取消自动调整、撤销/重做分别正确           | E UX02/22/Alt，R merge                                                                 | 通过                                |
| UX23 | 跨投影点屏幕重叠仍保持独立身份                          | E UX21/23，U topology                                                                  | 通过                                |
| UX24 | 真实鼠标捕获外松手、cancel、外部更新不覆盖              | R captured pointer，C external revision                                                | 通过                                |
| UX25 | 原拟合保留，圆/弧/直线、变速、噪声和反例，原笔迹恢复    | U 既有 pen 单元、R pen、多缩放 circle                                                  | 合成笔/触控通过；硬件未测           |
| UX26 | 两个实例快捷键、镜头、输入/预览及外部版本互不干扰       | C 四项；[窄容器截图](images/geometry-ux-v2/two-editors-narrow.png)                     | 通过                                |
| UX27 | v1/2.0/2.1、旧请求、新文档往返、历史不改写              | U compatibility、B JSON、I 版本快照                                                    | 通过                                |
| UX28 | 教师建题→学生作图→草稿→正式快照→教师复核                | B 真实业务，I 现有 Worker 合约                                                         | 通过；Worker Provider 仅自动化 Mock |
| UX29 | 三种导出不含 HUD/菜单；事实、引用可追踪                 | E exports，U narrative INVALID                                                         | 通过                                |
| UX30 | 构造两次点击可达，全屏及窄容器可操作                    | E group、五种布局，C 350px 容器                                                        | 通过                                |

桌面/布局测试使用 Chrome 实际鼠标输入，不用 dispatchEvent 代替拖动。测试包含默认吸附开启、明确关闭、当前手势暂停，以及只读/可编辑对象。合成 PointerEvent 和 CDP touch 仅用于笔/触控补充，明确区别于硬件实测。

## 命令结果与测试环境

2026-11-15，最终代码阶段提交 `0a4b68c`：

| 实际命令                                                                         | 结果                                                          |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `npm run typecheck`                                                              | 通过                                                          |
| `npm run lint`                                                                   | 通过                                                          |
| `npm test`                                                                       | 7 文件，99 项通过                                             |
| `npm run test:integration`（隔离库/桶/队列）                                     | 2 文件，16 项通过                                             |
| `npm run build`                                                                  | Next 16.4.2 生产构建通过，包含 /geometry 与原业务/API 路由    |
| `npm run test:e2e -- --reporter=list --output=test-results/geometry-ux-v2-final` | 5 文件，51 项通过，输出耗时 1.3 分钟                          |
| 手机可视区证据补录                                                               | 同一 UX17 再次通过，截图在确认前采集                          |
| JSON 与文档链接检查                                                              | 3 个新交互 JSON 通过 Schema；共享点引用一致；文档本地链接存在 |

本地阶段提交：`1e7781b` 失败复现、`95a299d` 公共内核、`9ae83ea` 六项交互/布局、`adbb050` 权限和业务兼容、`0a4b68c` 最终交互回归修正。汇总见 [verification.json](geometry-examples/ux-v2/verification.json)。

使用 Windows、Node 26.13.0、Chrome 157.0.8103.51。浏览器业务测试连接本机生产构建，使用隔离 tuheng_test 数据库、tuheng-test-private 桶与独立队列命名空间。既有图片上传→草稿→提交→教师确认→成绩查看、跨学生图片访问隔离、自测历史、认证和管理流程一并运行。没有生产部署、历史回填、数据库 reset 或真实 AI 调用。

性能样本为 513 实体：110 点、300 线段、50 圆、50 圆弧、3 历史面、3 个投影框架；使用生产 React 组件、headless Chrome、AMD Ryzen 9 8940HX。记录真实 pointermove 到第二个 requestAnimationFrame 的间隔，含帧等待，不等价于纯 JS/绘制耗时或手写笔端到端延迟。31 个样本中位数 5.0ms、P95 6.1ms、最大 6.7ms。实测数据见 [performance.json](geometry-examples/ux-v2/performance.json)，16–33ms 仅为产品参考目标。

## 图像与 JSON 证据

- [1366×768 桌面](images/geometry-ux-v2/properties-1366.png)、[1024×768 横屏](images/geometry-ux-v2/properties-1024.png)、[768×1024 平板](images/geometry-ux-v2/properties-768.png)、[390×844 手机](images/geometry-ux-v2/properties-390.png)、[360×800 手机](images/geometry-ux-v2/properties-360.png)。
- [拖动中 HUD 与端点吸附](images/geometry-ux-v2/drag-hud-snap.png)、[轴吸附提示](images/geometry-ux-v2/axis-snap.png)、[框选矩形](images/geometry-ux-v2/window-marquee.png)。
- [统一展开图 JSON](geometry-examples/v2/standard-sheet.json)、[两级换面 JSON](geometry-examples/v2/axes.json)、[2.1 新轴引用](geometry-examples/ux-v2/reference-axis.json)、[方向绑定](geometry-examples/ux-v2/direction-binding.json)、[合点共享引用](geometry-examples/ux-v2/merged.json)。
- JSON 样本均由真实交互导出或既有可复现 fixture 生成，并通过 GeometryDocument Schema。截图不代替鼠标操作、引用和历史断言。

2.1 仅增量添加 referenceRelations；详见 [契约](GEOMETRY_EDITOR_SCHEMA.md)。旧 JSON/队列读取不变，新副本才升级；2.1 使用原 grading-core 中的新提示词版本 1.3.0。无数据库迁移需求，无 UI/属性卡模型依赖。导出校验状态与用户声明分开，不替学生自动纠正答案。

## 限制与未验证条件

- 未连接真实 iPad + Pencil、Android 手写笔或低端手机；掌触、硬件采样延迟、Safari/WebKit 与真实软键盘仍需设备验收。手机尺寸、CDP 双指和合成笔事件不能替代这些结论。
- 性能数据来自上述桌面 headless 环境，不能外推为低端设备帧率保证。
- 未调用真实视觉模型；测试 Provider 只在自动化中使用，未声称 AI 批改成功。正式成绩仍由已有教师确认路径决定。
- 新轴几何重定义（会影响后续换面）明确禁用；提供创建、查看、重命名、依赖安全删除、保存/重载和撤销。方向关系只支持明确有向依赖，不是任意闭环 CAD 求解器。
- 照片识别/OCR、DWG/DXF、实体建模、协同等不在本轮；原图片作答已回归保留。
- 代码与文档阶段提交留在本地 codex/geometry-ux-v2，不推送、不部署。

## 后续修复：斜二等轴与电子笔（2026-11-15）

以下为 `833a107` 阶段记录；拟合确认交互已被后文“松手自动拟合”取代。

基线为本地提交 `64dce14`，开始时工作区干净。先建立 7 个回归用例，实测 6 失败、1 通过：错误默认轴向、2/3/5 事件短线、密集轻微抖动直线、缺采样信息的恢复快照失败；历史显式投影配置可读取通过。

| 用户问题                         | 根因                                          | 修改位置                                                                                                | 验收                                                                                          |
| -------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 斜二等轴 Y 轴朝右上              | 新文档 depthAngle 固定 45°                    | core/projections.ts                                                                                     | 新默认 -135°/0.5，统一渲染/引用/投影，旧显式配置不改                                          |
| 短笔画不拟合、慢画直线失败       | 至少 6 样本门槛；累加抖动折线长度误判折返     | core/pen.ts                                                                                             | 2–5 样本、亚像素抖动、2/4/8 px/mm；折返、椭圆、8 字拒绝误判                                   |
| 拟合候选不可采用                 | 原始恢复副本缺 sampling，文档一致性检查不通过 | core/tools.ts、editor/drawing-session.ts、OperationRecovery.tsx                                         | 共用原笔迹构造，采用候选与恢复、撤销/重做一致                                                 |
| 电子笔没有线型，辅助笔画仍为短线 | 工具只执行实线 segment，线型未接入手势/拟合   | core/tools.ts、editor/session.ts、ToolPicker.tsx、GeometryEditor.tsx、Viewport.tsx、ViewportDrawing.tsx | 三种线型覆盖 segment/circle/arc/polyline；辅助直线为无限 line，保留采样；教师笔迹不可被学生改 |

单元回归位于 `tests/unit/geometry-pen.test.ts`，26 项覆盖新默认/旧值兼容、短线与抖动、三种线型、曲线、恢复采样、权限、缩放及折返。既有 `geometry-repair.test.ts` 的不同速度、顺逆时针、圆/弧、噪点和异常笔迹用例保持通过。

新增 `tests/e2e/geometry-pen.spec.ts` 使用真实 mouse.move/down/up，松手前检查笔迹预览。5 项实际验证默认轴向、12px 短线、1366/390 布局中 16px 辅助线横贯画布、JSON/SVG 导出与重载、原笔迹恢复和撤销/重做、变焦圆弧以及椭圆的显式候选采用。吸附保持默认开启；虚拟直尺关闭。这里的鼠标描迹和手机视口模拟不等于真实手写笔/手机硬件测试。

本轮实际结果：`npm run typecheck`、`npm run lint`、`npm run build` 通过；`npm test` 为 8 文件 125 项通过；`npm run test:integration` 为 2 文件 16 项通过；`npm run test:e2e` 为 6 文件 56 项通过（1.6 分钟）。全量浏览器回归运行在生产构建、隔离数据库/桶/队列，保留原图片作答、教师出题、草稿、提交与复核；新增 5 项电子笔测试也已在开发模式通过。环境沿用上文 Windows / Node 26.13.0 / Chrome 157。未连接真实手写笔设备，未调用真实 AI。

本轮真实交互证据：[修正后的坐标轴](images/pen-repair/oblique.png)、[桌面无限辅助线](images/pen-repair/auxiliary-1366.png)、[手机无限辅助线](images/pen-repair/auxiliary-390.png)、[短辅助笔画导出的 JSON](geometry-examples/pen-repair/auxiliary-1366.json)、[手机 JSON](geometry-examples/pen-repair/auxiliary-390.json)、[新斜二等轴 JSON](geometry-examples/pen-repair/oblique.json)。这些笔画由 Playwright 真实鼠标路径产生，包含 samples 与 sampling；示例不是硬件手写笔采集。

## 松手自动拟合与长直线识别（2026-11-15）

用户反馈长直线被保留为笔迹，界面却提示“尝试拟合为圆”，并要求松手自动应用拟合。本次在 `833a107` 干净基线上复现，未要求重新绘制或点击确认。

- 根因：直线残差被固定屏幕误差上限限制，620px 长线的小幅波动也会失败；drawing-session 对所有未识别笔迹无条件提供 `allowApproximateCircle`，且该选项在 core 中绕过曲线形状检查。之前只覆盖短线/亚像素抖动，未覆盖长线的可见波动。
- `geometry-core/src/pen.ts`：直线容差兼顾 CSS 像素和跨度，保留主方向行程/折返与曲线分类；删除强制圆分支。`tools.ts`：原有有界噪声候选由同一 fitter 自动重试、通过几何检查后应用。圆/弧仍要求残差、扫角、方向一致性及闭合条件，不把未识别笔迹直接变为圆。
- `geometry-editor/src/drawing-session.ts`、`Viewport.tsx`、`OperationRecovery.tsx`：删除待确认状态、按钮与手动采用流程。松手提交一次，拟合成功保留原笔迹恢复；未识别则直接保留原笔迹，不显示无效果的恢复按钮。实线、虚线、无限辅助线及吸附继续使用原流程。
- 新增 17 项单元场景：2/4/8 px/mm、0°/70°/160° 的长线；原来需要候选确认的噪声圆；椭圆/8 字/折返拒绝；40°/90°/230° 圆弧和完整圆。修复前 13 项失败，修复后全部通过。样本在 `tests/repair-fixtures.ts`，为近似截图形状的合成轨迹，不声称来自用户设备。
- 新增 2 项真实鼠标 E2E，修复前均失败，修复后通过；鼠标松开后立即断言 segment/line/circle，随后才导出 JSON，无任何确认点击。复核三种线型、原笔迹恢复、一次撤销/重做；旧椭圆测试改为验证保留笔迹且不出现确认入口。

实际命令：`npm run typecheck`、`npm run lint`、`npm run build` 全部通过；`npm test` 8 文件 142 项通过；`npm run test:integration` 2 文件 16 项通过；`npm run test:e2e` 6 文件 58 项通过（1.5 分钟）。浏览器使用生产构建和隔离测试数据库/桶/队列；7 项电子笔浏览器测试也在开发模式通过。原图片作答、权限、保存提交与教师复核回归正常。

[松手自动拟合长线截图](images/pen-repair/automatic-line.png)；[真实鼠标路径导出的 JSON](geometry-examples/pen-repair/automatic-line.json) 已通过 GeometryDocument Schema，包含 161 个采样点、两个端点与一个 segment。保存原始样本供恢复，未通过截图猜测用户的精确原始坐标。环境仍为 Windows / Node 26.13.0 / Chrome 157。无契约字段/数据库迁移、历史回填或模型调用；真实手写笔设备未接入。
