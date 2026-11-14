# 几何文档契约

schemaVersion 为 tuheng.geometry/1.0.0，单位 mm，坐标为视图局部图纸坐标。点的空间坐标未知时为 null。投影矩阵和轴向参数保存在文档中，视口缩放不写入作答。

entities 使用稳定 ID，引用点、图层、视图。支持点、线段、无限线、圆、圆弧、折线、投影面。constraints 记录用户操作或确认吸附，projectionGroups 记录跨视图对应。计算关系由公共分析器生成，带容差与来源。

运行时验证有限坐标、数量、引用类型、引用循环、图层线型和跨视图引用。JSON 导入先限制字节和校验，错误保留当前文档。未知版本拒绝加载。

顶层字段为 schemaVersion、editorType、units、coordinateSystem、projectionConfig、views、layers、entities、constraints、projectionGroups、settings 和 metadata。正投影文档包含三个视图，轴测文档包含一个视图。映射轴不能重复，投影矩阵不能退化。layers 的三个角色分别为只读题干、学生答案和辅助作图。五种线型分别约束图层角色与有限/无限直线语义，不只控制显示颜色。

上限为 2MB 输入、2000 个几何对象、1000 条显式约束、500 个投影组、总计 30000 个笔迹坐标。坐标范围 ±10000mm。单段笔迹最多 4096 个采样，记录 pressure。计算关系最多导出 3000 条，达到上限时中文描述标明截断。

点保存 position、name、spatial 和 labelVisible，spatial 使用 null 表达未知。线段保存 startPoint/endPoint 的稳定 ID。无限线保存 anchor/direction。圆弧保存 center、radius、startAngle 和有向 sweep，其起止点由这些字段确定性计算。空间对应由 projectionGroups 的 entityIds 表达。

四份可校验示例位于 geometry-examples/VHW_PROJECTION.json、THREE_VIEW.json、ISOMETRIC.json 和 OBLIQUE_DIMETRIC.json。它们包含学生作图，可在对应类型的独立编辑器中通过“加载 JSON”打开。
