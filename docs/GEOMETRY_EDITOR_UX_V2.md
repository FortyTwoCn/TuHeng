# Geometry Editor UX v2 实施与验收

本轮基线 `8867445`，工作区初始干净。延续现有四类型公共编辑器、统一展开图、权限、拓扑、笔迹与教学业务。阶段提交在本地，不推送或部署。

## A：现状与缺口

| 功能 | 入口、代码 | 实际行为与缺口 | 本轮修复 |
| --- | --- | --- | --- |
| 长度 | Inspector / setSegment | 已有提交后属性；拖动中只有远处位移文字，无就地尺寸 | 预览实体计算 HUD，同一参数命令用于浮层与详情 |
| 轴吸附 | snapping / AXIS | 已有沿轴方向推断；独立点没有实际轴/原点候选 | 引用解析统一几何，独立原点、射线、换面轴候选 |
| 轴选择 | ViewportDrawing / hitTarget | 轴已绘制，命中仅 entities | 类型化引用、独立选择/修改/引用能力 |
| 框选 | 折叠工具 / box | 已有工具和粗包围盒检测；默认选择空白无行为，预览为斜线 | 默认空白拖框、Window/Crossing 精确判定、两次点击 |
| 属性 | Inspector | 已有下方表单，部分字段每次键入提交 | 对象锚定浮层、输入草稿与一次确认、手机摘要/抽屉 |
| 平行垂直 | 折叠工具 / addDrawing | 辅助线与虚线已有；不可引用轴，缺有限实线和已有线调整 | 同一构造参数命令、两步入口、方向调整及有向绑定 |
| 事务 | Viewport / DocumentHistory | 拖动一次历史已可用；move 仍全图校验序列化，window 快捷键影响多实例 | 固定 revision、受影响对象预览、局部键盘与分层取消 |
| 布局 | styles.css | 多排工具、下方属性、旧三视口覆盖规则仍在 | 容器布局、两排外壳、按需面板和全屏剩余高度 |

## 参考与产品选择

2026-11-14 已访问并阅读：[Fusion 选择](https://help.autodesk.com/cloudhelp/ENU/Fusion-Model/files/SLD-SELECTION.htm)、[Fusion 约束](https://help.autodesk.com/cloudhelp/ENU/Fusion-Sketch/files/SKT-CONSTRAINTS.htm)、[Onshape 工具](https://cad.onshape.com/help/Content/Sketch/sketch_tools.htm)、[WAI Toolbar](https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/)、[Dragging Movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html)、[Pointer Events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events)、[Floating UI 虚拟锚点](https://floating-ui.com/docs/virtual-elements)、[autoUpdate](https://floating-ui.com/docs/autoupdate)。工具分组、单指替代操作和指针捕获借鉴这些资料；44px、阈值和具体菜单属于本任务的产品选择。

状态分为文档、会话、视口和操作预览。文档包含几何及可追踪关系；工具、选中、面板、镜头、HUD 和输入草稿均不进入答案。指针操作固定文档 revision 与逆 CTM，预览不提交历史；结束校验一次。Esc 按输入/浮层→操作→工具顺序退出。移动时只更新受影响几何，完整校验在提交边界。

## 阶段记录

- A：建立 UX01/05/10/12/15/30 真实鼠标失败回归，复现后进入公共基础修复。
- B–F：实施结果、命令矩阵与逐项证据在完成相应检查后补充。
