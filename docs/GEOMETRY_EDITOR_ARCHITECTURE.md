# 几何编辑器架构

四种编辑器继续共用 contracts → geometry-core → geometry-editor。domain 在现有题目、草稿、正式提交事务中校验几何文档，grading-core 复用原队列、Provider 和教师复核。没有照片识别服务、第二套评分流程或独立编辑器项目。

## 统一展开图

VHW 和三视图使用一个 SVG 逻辑图纸、一个毫米比例和一个镜头。图纸 U 向右、T 向上；第一角法左视图在右。`sheet.ts` 集中负责局部坐标与图纸坐标双向变换；`Viewport` 通过实际 SVG CTM 将图纸坐标转换为 CSS 像素。

A=(30,20,40) 的纸面位置为 V=(-30,40)、H=(-30,-20)、W=(20,40)。学生实际输入独立保存，不要求满足这些等式，也不自动补全投影。切换 V/H/W 只选择后续对象归属；“聚焦当前投影”仅平移同一个镜头，“完整展开图”适应整张纸。跨轴拖动不改变对象 viewId。无限辅助线可使用 SHEET scope，不被投影区域裁剪。

正等轴测与斜二等轴仍使用原局部投影参数，分别保留三轴角度/比例和深度角度/缩短系数。各模式共用选择、拖拽、拟合、历史和导出。

## 换面轴

`projection-systems.ts` 保存轴、父投影系、保留/替换/新增投影框架、旧轴正向、展开侧和参考线。普通轴两点定位，平行/垂直轴选择参考线后定位通过点，再点击展开侧并确认。名称自动避免冲突，可编辑；有下级轴或对象依赖的轴禁止直接删除。

新位置的分析遵循 q=a+dot(p-a,t)t，p_new=q+d*n，其中 d 是被替换投影相对旧轴正向的带符号距离。创建轴只增加框架，不生成答案点。支持连续换面，运行时拒绝依赖环。旧 plane 保留读取，迁移后标记 legacyReadOnly；VHW/三视图主入口不再展示三维法向量表单。

## 交互与事务

- `references.ts`：类型化目标、实际参考几何、selectable/snappable/referenceable/editable/deletable；渲染、命中、吸附和构造共享。基准射线、原点与偏移新轴不伪造成答案线。
- `interaction-controller.ts`、`marquee.ts`：点/端点/线身命中、重叠候选、Window/Crossing 精确几何；多选共享节点只移动一次。
- `commands.ts`（core）：构造、精确参数、方向调整与显式轴绑定的纯命令；浮层/详细属性使用同一参数描述。
- `Viewport.tsx`：固定 pointerdown 基线，移动时渲染 previewDocument，松手提交一次历史；Escape、cancel、异常丢失捕获及受控文档更新取消未提交操作。
- `drawing-session.ts`：分步绘图与笔迹应用；`OperationRecovery.tsx`：取消吸附、恢复原笔迹及恢复中断笔迹。
- `topology.ts`：合并点引用、别名和来源、单个对象端点解除连接。不同投影不合并；题干点可作为只读锚点。
- `dependencies.ts` / `reference-relations.ts`：显式交点、贴轴、通过点与有向平行/垂直绑定；拒绝循环或共享端点冲突。交互求解与只读分析分离，声明按实际几何校验。
- `pen.ts`：去重、等弧长采样、稳健圆拟合、残差/转角/闭合分类。可靠结果自动采用；候选和显式近似圆需用户采用；不可靠结果保留折线。

## 会话、预览和界面

文档仅包含正式几何。session reducer 保存工具、选择、自动识别的最近作图框架、面板和分步构造；useViewportCamera 单独管理镜头与容器尺寸；手势快照、预览文档、HUD 和字段草稿独立保存。geometry-core/sheet.drawingViewAt 按图纸位置与现有对象解析新操作归属，Viewport 固定每次手势及多步命令的 viewId；不再通过下拉选择作图框架。开始操作固定 revision 与 CTM，外部更换文档取消旧操作；受控父级同内容回传不重置历史。

`preview.ts` 只更新受影响点及必要依赖，不在每次 move 做完整 Zod、分析/自然语言导出或 JSON.stringify。`primitive-preview.ts` 让显示的吸附几何和最终提交共用计算结果。完整验证在提交边界，一次操作一条历史。OperationRecovery 用原始结果与自动调整结果替换当前命令；新编辑使旧恢复入口失效。

`commands.ts`（editor）为工具栏和对象卡提供统一有类型注册表与可用性原因。`EditorToolbar` 处理 roving focus；快捷键限定当前编辑器并避开文本输入。`FloatingInspector` 与 Inspector 都复用 PropertyFields，不复制属性命令。单一 `@floating-ui/dom`（MIT）处理 SVG 虚拟锚点及尺寸/滚动更新，关闭清理订阅。

CSS 使用容器宽度和剩余高度布局；手机摘要保留在对象旁，详细属性抽屉占用内部网格空间。文件、图层、显示和吸附细项按需展开，不重新引入三套独立画板。

## 版本和教学边界

`geometry-v1.ts` 保留原始解析器；新编辑文档使用 v2，新增类型化参考关系使用 2.1。普通读取和序列化不会改写历史快照。`upgradeGeometryDocument` 仅为新的编辑草稿补充明确变换，不改变原局部点坐标。详见 [Schema](GEOMETRY_EDITOR_SCHEMA.md)。

`combineAnswer` 逐项保护数据库冻结题干、基准视图、已有轴、图层、原点和投影配置，同时依据 `sheet.allowAuxiliaryViews` 允许新增学生轴和其派生视图。不能通过新增轴、伪造所有权或修改基准变换绕过校验。新增字段位于已有 JSONB 文档及字符串版本列，不需要数据库 DDL；历史正式作答不回填或重算。

## 入口和公共组件

登录后访问 `/geometry` 独立作图，JSON 保存到本地；教学页面通过既有草稿/提交用例保存。未登录或会话失效会先登录，再回到编辑器。

`GeometryEditor` 仍支持 value/onChange、defaultValue、role、readOnly、problemDocument、highlightedEntityIds。ref 提供 getDocument、exportJSON、exportNarrative、undo、redo、fitToContent。非法加载保留当前文档并反馈错误；外部 value 变化不能被旧拖动覆盖。SVG 导出整张展开图，与当前镜头无关，不含选中柄或吸附候选。

照片识别导入留待下一轮，届时仍通过同一 GeometryDocument 校验入口；本轮不调用识别模型。已有图片作答保持兼容。

当前交互、权限矩阵、实测与证据见 [UX v2 验收报告](GEOMETRY_EDITOR_UX_V2.md)；上一轮投影/笔迹修复历史见 [专项报告](GEOMETRY_EDITOR_REPAIR.md)。
