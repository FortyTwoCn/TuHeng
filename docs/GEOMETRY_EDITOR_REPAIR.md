# 编辑器专项修复验收（2026-11-14）

基线为 `3448f20`。本轮沿用现有仓库与教学模块，按附件 A→E 顺序推进。下述结论以真实操作、导出 JSON 和测试结果共同支撑。

## 根因与修复位置

| 问题                       | 原因                                                                                             | 修复及主要文件                                                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V/H/W 无真实展开关系       | GeometryEditor 对 views.map 建立独立 Viewport，每个组件持有独立 camera；局部坐标没有统一纸面变换 | `geometry-core/sheet.ts`、`contracts/geometry.ts`、`geometry-editor/GeometryEditor.tsx`、`ViewportDrawing.tsx`：一个图纸和镜头，v2 显式 transform，v1 编辑适配 |
| 新增面并非换面             | 原入口以任意三维 plane 表单替代新轴和展开侧，没有父投影系                                        | `projection-systems.ts`、`AxisTools.tsx`：普通/平行/垂直轴、点击选侧、命名、父系和正向、两级保存重载；分析使用带符号距离                                       |
| 拖动松手前不更新           | move 只画预览折线，finish 才调用 moveEntities；命中距离排序让线身抢端点                          | `interaction-controller.ts`、`Viewport.tsx`、`sheet-drawing.ts`：固定基线、真实 previewDocument、点/端点优先、线身与多选单次变换                               |
| 滚动后的点击错位           | 聚焦 SVG 会触发浏览器滚动，随后取到变化后的 CTM                                                  | `Viewport.tsx`：preventScroll 聚焦，采样/拖动持有开始时逆矩阵，实测覆盖页面滚动                                                                                |
| 吸附看似连接但引用分离     | confirmSnap 只追加 COINCIDENT；选择拖动没有走吸附；每次操作等待确认弹窗                          | `snapping.ts`、`topology.ts`：统一候选优先级/滞回、真实引用合并、隐藏/自引用过滤、松手接受、原始操作单独恢复                                                   |
| 圆在缩放或异常点下失败     | 固定 0.6mm、极值残差、一段轨迹采样密度不均；最终落点缺失，直尺可见便强制压直                     | `pen.ts`、`tools.ts`、`drawing-session.ts`：等弧长采样、稳健几何残差、像素噪声与相对尺寸、转角/闭合分类、真实 circle/arc、恢复原笔迹                           |
| 合法学生新轴无法保存       | combineAnswer 全量比较 views，既不能追加派生框架，也缺少轴所有权规则                             | `document.ts`、`contracts/geometry.ts`：保护原项并允许题目许可的学生增量；domain 仍使用同一服务端校验                                                          |
| 旧声明可误导分析           | 约束变化后仍只输出声明，未区分是否有效                                                           | `dependencies.ts`、`analysis.ts`：实际重算状态、交点绑定失效检测、换面偏差；评分提示词版本 1.2.0 与 v2 匹配，旧 1.0/1.1 保持读取                               |
| 带约束的旧题无法保存新草稿 | v1 没有派生 status 字段，编辑后重新求值产生该字段，逐项比较误判为修改题干                        | `document.ts`、`dependencies.ts`：在新副本上统一重算状态，再严格比较题干定义；不改写旧快照                                                                     |
| 分析可能替学生改正交点     | 交互绑定求值与导出分析共用更新位置的逻辑                                                         | `dependencies.ts`、`analysis.ts`：交互中更新显式绑定，提交校验和分析仅计算状态、保留实际坐标                                                                   |

上述路径除 contracts/domain/grading-core 外均位于 `packages/geometry-core/src` 或 `packages/geometry-editor/src`。源码保留模块边界，未引入 Python、照片识别、DWG/DXF 或第二套评分服务。

## 失败到通过

1. 新增浏览器回归在旧版本实测：期望一个画板，收到三个；page.mouse down/move 后、尚未 up 时，点的屏幕位移为 0（要求 >30px）。默认吸附还会让绘点停在确认框。
2. 初始单位回归实测：60px 圆含单个 3px 径向异常，在 3px/mm 时得到 polyline，12px/mm 时得到 circle。修复后的样本扩展覆盖顺逆时针、230° 圆弧、变速、轻微抖动，以及椭圆、乱线、8 字反例。
3. 修复后的浏览器检查导出的端点 ID：5px 附近连接后，源点移除，两条线共用目标点；移动目标点时两条线在 mouseup 前同时更新。取消吸附保留原落点，undo/redo 恢复实体和引用。
4. 真实鼠标检查端点仅移动自身、线身平移、多步移动一次历史，以及越出画布后释放；Escape、pointercancel、lostpointercapture 取消预览。模拟笔中断可恢复已采集轨迹，额外触摸不改变笔迹镜头。
5. 平行/垂直新轴两级创建后保存、重载、撤销/重做；创建轴前后答案点数量不增加。普通轴在 1024px 和 390px 操作测试中同样通过。换面纯函数检验给定例子得到 (-90,-20)，负距离不取绝对值。
6. 桌面、平板、手机均检查实际拖点/合点/新轴/手绘圆。关闭直尺的手绘圆及改变缩放后的圆导出 circle(center,radius)，恢复后为带 samples 的 polyline。对应位置和镜头聚焦前后的文档不变通过数值比较。
7. UI 拒绝移动题干锚点；仅对指定答案解除连接。教学 E2E 真实建题、发布、学生新增轴、保存重载、提交、教师复核；伪造题干点及基准变换的 API 请求返回 403。
8. 最后复查新增两个失败回归：带约束的 v1 题干保存新答案触发 GEOMETRY_STEM_CHANGED；错误交点导出时被改成理论交点并显示 SATISFIED。修复后保存成功、伪造约束定义仍被拒绝，错误交点保持原坐标并标为 INVALID。
9. 真实 Shift 多选后拖动两条已连接的线，松手前两线同步移动，共享节点只变换一次，撤销一次恢复整组。笔迹到达 4096 个采样后保留最终落点并提示分段作图，回退原始折线。

保留原测试并适配统一图纸选择器；去掉原 E2E 的吸附关闭操作，关键用例在默认开启吸附下运行。桌面拖拽和手绘路径使用 page.mouse；只有事件边界与笔/触摸测试显式使用合成 PointerEvent 或 CDP。

## 样例与证据

- [标准展开图 JSON](geometry-examples/v2/standard-sheet.json)：A_V、A_H、A_W 对应规定纸面坐标。
- [两级换面 JSON](geometry-examples/v2/axes.json)：保留新旧轴关系、参考实体、展开侧和派生框架。
- [合点后的 JSON](geometry-examples/v2/merged.json)：可直接检查两条线共享同一端点 ID。
- [合成笔迹样本](geometry-examples/v2/stroke-circle.json)：可通过加载 JSON 导入；不是实际硬件采集。
- [完整展开 SVG](geometry-examples/v2/standard-sheet.svg)：导出与镜头无关。
- [1440px 桌面](images/editor-repair/sheet-1440.png)、[1024px 平板](images/editor-repair/operations-1024.png)、[390px 手机](images/editor-repair/operations-390.png)。
- [关键交互录像](images/editor-repair/operations-390.webm)：真实鼠标完成拖动、合点、普通新轴和手绘圆；另有 [两级换面录像](images/editor-repair/axes.webm)。

图片/录像用于辅助复核；拓扑、坐标和拟合实体的结论来自测试中的实际 JSON 断言。

## 最终检查

| 检查                                                         | 最终实际结果                                                                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                          | 通过                                                                                                          |
| `npm run lint`                                               | 通过，0 错误、0 警告                                                                                          |
| `npm test`                                                   | 79/79，6 个文件                                                                                               |
| `npm run test:integration`                                   | 16/16，真实 PostgreSQL、Redis、S3；隔离测试数据库和 bucket                                                    |
| `npm run build`                                              | 通过，Next.js 16.4.2 生产构建                                                                                 |
| `npm run test:e2e -- --output=test-results/production-final` | 19/19，43.7s，本机 Chrome，连接 `next start` 生产服务器；包含 10 项专项交互、5 项编辑器/教学与 4 项原业务回归 |

最终验证使用 Windows、Node 26.13.0、系统 Chrome。默认吸附保持开启。图片上传、权限和教学流程使用本地演示数据；模型替身仅在自动化集成测试中使用。`next start` 生产预览继续运行于本机回环地址，登录后可在 `http://localhost:3000/geometry` 复核。

本轮文档字段存放于已有 JSONB 和版本字符串列，无数据库 DDL 或历史回填。v1 示例和正式快照保持原内容；重新编辑创建 v2 草稿。旧图片作答、账户权限和人工发布流程一并回归。

## 未验证与边界

- 没有真实 Apple Pencil、Android 笔或实体平板测试；不能声称硬件延迟、Safari 或掌触行为已验收。浏览器视口和模拟触摸不能代替真机。
- 未调用真实视觉/批改模型，未验收模型评分准确性；集成测试的模型替身仅在测试环境使用。生产没有生成模拟成绩。
- 持续求值覆盖显式交点绑定，方向关系与轴参考方向按实际几何标记有效/失效；没有实现通用非线性 CAD 约束求解器。
- 原三维 plane 可读取但迁移后只读，不将无法推断的旧对象猜成换面轴。照片识别仍是下一轮扩展点。
