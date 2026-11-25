# 几何编辑器架构

[返回文档目录](README.md)

四种编辑器继续共用 contracts → geometry-core → geometry-editor。domain 在现有题目、草稿、正式提交事务中校验几何文档，grading-core 复用原队列、Provider 和教师复核。没有照片识别服务、第二套评分流程或独立编辑器项目。

## 统一展开图

VHW 和三视图使用一个 SVG 逻辑图纸、一个毫米比例和一个镜头。图纸 U 向右、T 向上；第一角法左视图在右。`sheet.ts` 集中负责局部坐标与图纸坐标双向变换；`Viewport` 通过实际 SVG CTM 将图纸坐标转换为 CSS 像素。

A=(30,20,40) 的纸面位置为 V=(-30,40)、H=(-30,-20)、W=(20,40)。学生实际输入独立保存，不要求满足这些等式，也不自动补全投影。新作图按落笔位置自动识别归属，多步操作锁定第一步框架；“完整展开图”适应整张纸。跨轴拖动不改变对象 viewId。无限辅助线可使用 SHEET scope，不被投影区域裁剪。

正等轴测与斜二等轴仍使用原局部投影参数，分别保留三轴角度/比例和深度角度/缩短系数。各模式共用选择、拖拽、拟合、历史和导出。

## 换面轴

`projection-systems.ts` 保存轴、父投影系、保留/替换/新增投影框架、旧轴正向、展开侧和参考线。普通轴两点定位，平行/垂直轴选择参考线后定位通过点，再点击展开侧并确认。名称自动避免冲突，可编辑；有下级轴或对象依赖的轴禁止直接删除。

新位置的分析遵循 q=a+dot(p-a,t)t，p_new=q+d*n，其中 d 是被替换投影相对旧轴正向的带符号距离。创建轴只增加框架，不生成答案点。支持连续换面，运行时拒绝依赖环。旧 plane 保留读取，迁移后标记 legacyReadOnly；VHW/三视图主入口不再展示三维法向量表单。

## 交互与事务

- `references.ts`：类型化目标、实际参考几何、selectable/snappable/referenceable/editable/deletable；渲染、命中、吸附和构造共享。基准射线、原点与偏移新轴不伪造成答案线。
- `interaction-controller.ts`、`marquee.ts`：点/端点/线身命中、重叠候选、Window/Crossing 精确几何；多选共享节点只移动一次。
- `commands.ts`（core）：构造、精确参数、方向调整与显式轴绑定的纯命令；浮层/详细属性使用同一参数描述。
- `Viewport.tsx`：根据工具和手势派发指针事件。按下固定文档基线和坐标变换，移动时更新预览，松手提交。Escape、意外丢失指针捕获或外部换图会结束未提交操作。
- `usePointerFrames.ts`：合并每帧的移动预览，组件卸载时清理待处理任务。笔迹原始采样由视口单独保留。
- `ViewportScene.tsx` 和 `ViewportDrawing.tsx`：按统一图纸坐标绘制实体、选择、吸附和测量提示。`ViewportProjection.tsx` 与 `ViewportFeedback.tsx` 负责投影面板与可点击反馈。
- `drawing-session.ts`：分步绘图与笔迹应用；`OperationRecovery.tsx`：取消吸附、恢复原笔迹及恢复中断笔迹。
- `topology.ts`：合并点引用、别名和来源、单个对象端点解除连接。不同投影不合并；题干点可作为只读锚点。
- `dependencies.ts` / `reference-relations.ts`：显式交点、贴轴、通过点与有向平行/垂直绑定；拒绝循环或共享端点冲突。交互求解与只读分析分离，声明按实际几何校验。
- `pen.ts`：去重、等弧长采样、稳健圆拟合、残差/转角/闭合分类。直线/圆/圆弧优先，开放笔迹经过屏幕尺度平滑、稀疏插值与双向误差检查后可生成曲线；不再逐个采样点以固定转角拒绝整笔。可靠结果松手自动采用，不可靠结果保留原笔迹。

## 会话、预览和界面

文档存储正式几何。`WorkspaceSession.activity` 互斥表示 CAD 取点、教学构造、换面轴或选择、导航与电子笔。`useCadCommand` 通过同一 reducer 更新会话。`useDrawingDocument.ts` 负责宿主值回传、正式提交、题干保护及撤销历史。`sheet.drawingViewAt` 按图纸位置解析操作归属，视口在一次手势或多步命令期间锁定 `viewId`。外部换图会取消旧操作。宿主回传同一文档内容时保留历史。

`preview.ts` 局部更新拖动涉及的点和依赖。`useCadPrecision.ts` 保存数值草稿，计算可用于确认的精确落点。`cadStep` 与 `cadPreview` 共用几何计算。完整验证发生在正式提交时。每次操作对应一个历史项。`OperationRecovery` 可将当前历史项替换为未吸附或未拟合结果。

`commands.ts`（editor）为工具栏和对象卡提供统一有类型注册表与可用性原因。`workspace-controls.tsx` 和 `workspace-rails.tsx` 负责五个区域的布局及命令入口；快捷键限定当前编辑器并避开文本输入。`FloatingInspector` 的紧凑摘要与展开属性共用 `PropertyFields`，不复制属性命令。单一 `@floating-ui/dom`（MIT）处理 SVG 虚拟锚点及尺寸/滚动更新，关闭清理订阅。

`CommandParameters.tsx` 呈现文字、多边形设置和精确坐标表单。统一样式入口 `styles.css` 按工作区、浮动面板和响应式覆盖的顺序加载。手机摘要保留在对象旁，详细属性抽屉占用内部网格空间。

## 版本和教学边界

CAD 命令目录位于 `cad-registry.ts`。每个命令声明工具组、别名、参数、可接受的选集和步骤。每个实例的 `cad-session.ts` 记录基准文档、锁定框架、已确认点和引用，阶段为选集、选点和确认。坐标解析、正式几何求值及权限检查在 geometry-core 中完成。界面把指针和文本转换为同一种事件。浏览器捕捉预览调用同一套核心计算，确认时运行完整契约校验并写入一次历史。

原生构造使用 `cad-primitives.ts`，曲线边界求交与裁剪使用 `parametric-geometry.ts` 和 `cad-cut.ts`，变换在 `cad-transforms.ts`，区域识别及剖面计算位于 `cad-region.ts`、`hatch.ts`。出题、独立作图、学生作答和复核通过同一 GeometryEditor 生成 SVG。场景实例和浮层均不拥有第二份正式作答。

新建文档和编辑事务使用 v3。普通读取和序列化保留历史快照。契约包含投影变换、几何引用、派生轴及工程标注，详见 [Schema](GEOMETRY_EDITOR_SCHEMA.md)。

`combineAnswer` 逐项保护数据库冻结题干、基准视图、已有轴、图层、原点和投影配置，同时依据 `sheet.allowAuxiliaryViews` 允许新增学生轴和其派生视图。不能通过新增轴、伪造所有权或修改基准变换绕过校验。新增字段位于已有 JSONB 文档及字符串版本列，不需要数据库 DDL；历史正式作答不回填或重算。

## 入口和公共组件

登录后访问 `/geometry` 独立作图，JSON 保存到本地；教学页面通过既有草稿/提交用例保存。未登录或会话失效会先登录，再回到编辑器。

`GeometryEditor` 支持 `value` / `onChange`、`defaultValue`、`role`、`readOnly`、`problemDocument` 和 `highlightedEntityIds`。ref 提供 `getDocument`、`exportJSON`、`exportNarrative`、`undo`、`redo` 和 `fitToContent`。文件输入、预览和导出走 `DrawingFiles.tsx` 与核心 `document-json.ts`。面向用户的 JSON 排版与评分证据分开。非法加载保留当前文档并反馈出错字段。SVG 导出默认覆盖整张展开图。

照片识别导入留待下一轮，届时仍通过同一 GeometryDocument 校验入口；当前不调用识别模型。已有图片作答保持兼容。

操作步骤见[交互指南](GEOMETRY_EDITOR_INTERACTION.md)，实际测试与硬件验证边界见[测试指南](TESTING.md)。

## 曲线复用与扩展边界

geometry-core/curves.ts 定义弦长三次 Hermite 插值、精确 SVG 路径和命中细分；pointIds 与既有点、拓扑、预览、复制、依赖、权限及导出共用。curve-snapping.ts 对已拟合的笔迹曲线执行交点定位，保留原始输入；snapping.ts 统一枚举实体、基准射线和换面轴的真实交点，没有第二套轴几何。

样条使用 geometry-core/cad-session.ts 的统一命令会话，按点选顺序记录插值节点、原始坐标和吸附候选。点击「完成」后，cad-primitives.ts 生成曲线和节点引用，并记录接受的交点定位关系。数值坐标输入、触屏点选和桌面点击共享此流程。视口预览和输入草稿只保存在会话中。自由笔迹继续由 pen.ts 拟合，原始采样支持恢复。

domain 根据冻结作答的几何版本选取已有评分流程的提示版本。v3 使用 geometry-review/1.5.0，传递曲线区间、标注几何实测值及显示文本。集成测试覆盖草稿、冻结提交、任务证据和复核引用。正式成绩由教师确认。
