# GeometryDocument 3.0

新建图纸的版本是 `tuheng.geometry/3.0.0`。编辑、出题、作答与复核以同一份工程几何 JSON 为依据。单位是毫米，角度是度。打开已保存的快照保持其版本和内容。在编辑副本上提交几何命令时，新事务写入 3.0。数据库继续使用既有题目版本、草稿、提交与评分记录中的 JSON 字段。本轮无需数据库 DDL 或历史数据回填。[运行时契约](../packages/contracts/src/geometry.ts) · [可导入 CAD 示例](geometry-examples/CAD-V3.json)

## 生成、阅读和校验 JSON

从「文件 → 导出 JSON」取出实际图纸，从「文件 → 下载图纸 JSON Schema」取得新建图纸的字段定义。JSON Schema 使用 Draft 2020-12，直接由 Zod 契约生成。把图纸 JSON 和 Schema 一起交给 AI 时，可要求它只返回完整的 JSON 文件，通过 `id` 引用实体，并从示例沿用视图、图层、单位和投影配置。可用「文件 → 打开 JSON 或图纸包 ZIP」验证并重新编辑生成的图纸。[最小线段示例](geometry-examples/AI-LINE-V3.json)

导出采用两空格缩进，实体先显示 `id` 和 `kind`，坐标、笔迹采样和简短数组按行排列。单独下载、文件预览和 ZIP 内的 `drawing.json` 共用这一排版。数字保持原精度，数组顺序及对象引用保持原样。接近 2 MB 上限时采用紧凑 JSON，确保文件仍可重新导入。[文件读写源码](../packages/geometry-core/src/document-json.ts)

新画线段时，先定义两个 `point`，再在 `segment.startPoint` 和 `segment.endPoint` 引用它们的 ID。共享端点应复用同一个 ID。引用的对象和 `viewId`、`layerId` 都必须实际存在。JSON Schema 描述字段、范围和枚举。打开图纸时还会校验跨对象引用、视图归属、几何有效性及作答权限。字段错误会带 JSON 路径，例如 `$.entities[0].position.x`，数组下标从 0 开始。[Schema 生成源码](../packages/contracts/src/geometry-json-schema.ts)

仓库中的两个 Schema 可用 `npm run geometry:schema` 从正式契约重新生成。[完整图纸 Schema](geometry-schemas/tuheng.geometry.schema.json) · [独立动画 Schema](geometry-schemas/tuheng.construction-animation.schema.json)

## 坐标与身份

每个 view 的 transform 有 origin、xAxis 和 yAxis。图纸坐标等于 origin + x·xAxis + y·yAxis。两个基向量互相垂直且长为 1。V 的局部 (x,z) 映射为图纸 (-x,z)，H 的局部 (x,-y) 映射为 (-x,-y)，W 的局部 (y,z) 映射为 (y,z)。图纸原点为 (0,0)。正等轴测和斜二等轴测各有一个作图框架。新建斜二等轴测图的深度方向为 -135°、比例为 0.5。

`VH_PROJECTION` 自 3.0 起使用两个基础视图。V 的 `mapping` 是 `["x", "z"]`，H 的 `mapping` 是 `["x", "y"]`。两个视图共用 X-O 基准，V 向上展开，H 向下展开。可用换面操作增加派生视图。

实体各有 id、viewId、layerId 和 lineStyle。基准轴使用类型化引用。点、线和圆心间通过稳定 ID 关联。一个答案实体可以使用同框架的题干点。题干实体的依赖必须全部来自冻结题干。学生提交时，服务端将题干、基准框架和教师轴与冻结版本逐项核对。

| 实体 | 持久化参数 | 几何解释 |
| --- | --- | --- |
| point | position、name、spatial、labelVisible | 局部位置必须有效。未知空间位置为 null。合点后可记录 aliases 和 mergedFrom。 |
| segment、line | startPoint/endPoint，或 anchor/direction | 两个正式节点定义有限线段。锚点和非零方向定义无限线，scope=SHEET 可用于图纸辅助线。矩形与正多边形使用共享节点的闭合线段集合。 |
| circle、arc | center、radius、startAngle/sweep | center 引用同框架点。弧保存有向扫角，允许整周。 |
| ellipse | center、majorRadius、minorRadius、angle、startAngle、sweep | 长短半轴为正，长半轴大于等于短半轴。局部参数点为中心加上旋转后的 (a cos t,b sin t)。扫角保存修剪后的区间。 |
| curve | pointIds、interpolation=CUBIC_HERMITE、parameterRange | 3 至 128 个有序插值点。各段使用弦长加权的三次 Hermite 切向。选填区间按每段等分到 [0,1]，裁剪时按端点位置及导数重新参数化原三次曲线。 |
| polyline | points、fitStatus=UNFITTED | 电子笔未拟合笔迹。samples 和 sampling 保留压力、比例与采样框架。恢复原笔迹重建该轨迹。 |
| text、symbol | position、angle、size、content 或 symbolType | 中文文本作为文字编码。方向符号可为 DIRECTION、LEFT_ROTATION 或 RIGHT_ROTATION。 |
| dimension | dimensionType、referenceIds、position、precision、textSize、arrowStyle、textOverride | 真实尺寸由引用求值，覆盖文字单独保存。绘图样式由尺寸对象负责。 |
| engineeringAnnotation | annotationType、position、angle、size、fields | 基准、表面粗糙度、形位公差框、上下偏差。用户填写的字段不能证明任何几何关系或公差符合性。 |
| hatch | loops、origin、angle、spacing | 每环是闭合圆、整周椭圆或通过共享点闭合的一组线段。按图纸毫米生成剖面线，多个边界采用奇偶填充，可保留内孔。边界变化后重新求交。 |

每个对象可指定 appearance.widthMm、十六进制 appearance.color 和 appearance.pattern。图案支持实线、虚线、点划线、双点划线。调整颜色、可见线型或宽度都保持对象图层与所有者。网格、镜头、工具、预览、临时测量和选择状态独立于作答实体。

## 标注的关联与实测值

线性和对齐尺寸引用两个点。线性尺寸将差向量投影到 linearAngle 所示局部方向，缺省按 linearAxis 或水平轴。对齐尺寸取欧氏距离。角度尺寸引用顶点、第一射线点和第二射线点，取两条射线的夹角。半径和直径尺寸引用实际圆或圆弧。文本精度仅影响显示。修改几何会更新实测值。移除被引用的实体时，关联标注和失去边界的剖面随同该事务移除，撤销恢复引用。

粗糙度的 roughnessMode 可为 BASIC、REMOVAL_REQUIRED 或 REMOVAL_PROHIBITED。公差文字 fields 保留基本尺寸、上偏差、下偏差三个槽位，支持单侧偏差。尺寸覆盖文字和公差框均为用户注释。[几何求值](../packages/geometry-core/src/cad-geometry.ts) · [剖面计算](../packages/geometry-core/src/hatch.ts)

## 参考、捕捉与换面

referenceRelations 的引用可为实体、基准轴、投影轴或原点。POSITION 记录一次定位或方向调整，BINDING 表达显式有向依赖。关系状态可以是 SATISFIED、INVALID 或 UNVERIFIED。保存和评分描述使用实际几何检查，不能依靠声明标签确认学生答案。合并端点会重写引用，只允许同一投影。跨投影的对应点保留不同节点。

auxiliarySystems 记录父投影系、保留面、替换面、新面、轴锚点、单位切向、展开侧、正法向和旧轴。换面计算使用带符号距离。创建轴不会自动填充学生答案。sheet.allowAuxiliaryViews 和冻结题干共同限制学生的新增操作。[换面轴示例](geometry-examples/v2/axes.json)

## 分步动画

3.0 图纸可以在根级提供 `constructionAnimation`。该字段直接存放 `tuheng.construction-animation/1.0.0`，包含 `title`、`description`、可选的 `editorType`、`phases` 和 `steps`。阶段与步骤按从 0 开始的 `order` 排列。每步按笔顺引用 `entityIds`，并可引用辅助线和擦除对象。临时辅助线和定位点用统一图纸毫米坐标。图纸旧快照可省略该字段，播放时按现有图元自动编排。[字段、AI 说明与独立导入](GEOMETRY_EDITOR_ANIMATION_SCHEMA.md)

图纸包、完整 JSON 和教学快照保存动画。评分证据使用剥离动画后的几何对象与实测关系。[带动画三视图](geometry-examples/construction/THREE-VIEW-CONSTRUCTION.json) · [同一图纸的独立动画](geometry-examples/construction/THREE-VIEW-CONSTRUCTION.animation.json)

## 校验与评分

文档上限为 2 MB、2000 个实体、1000 条显式约束和 500 个投影组。坐标范围为 ±10000 mm。笔迹总采样量限制为 30000，单段最多 4096 点。剖面边界须闭合，自交或零面积的线段环会被拒绝。密集填充超过 4096 排或单图计算预算时，应增加间距。所有依赖须存在且作用域有效。约束、节点或投影系产生环时拒绝提交。

GeometryEvidence 保存同版 answerDocument、冻结 problemDocument、实测 derivedRelations 和 narrative。3.0 文档使用 geometry-review/1.5.0。描述列出真实尺寸与显示文字、样条有效区间和剖面边界。没有计算规则的公差符合性保留未知。评分任务、教师复核和正式成绩继续使用原有业务链。[评分请求契约](../packages/contracts/src/index.ts) · [评分提示版本](../packages/grading-core/src/prompts.ts)

计算关系按稳定顺序保留最多 3000 条。3.0 关系 ID 使用冒号分隔类型与对象 ID，可区分名称中带句点的对象。点击复核评语时，页面从产生该评语的评分运行快照定位直接引用的对象及关系参与者。评分用叙述达到 100 万字符时按完整行节选并提示，结构化对象和已计算关系仍保留。手动导出的自然语言图纸使用完整叙述。

## 示例

CAD-V3.json 展示椭圆截面、圆孔、可编辑剖面、尺寸和工程标注。旧版 1.0 图纸以及 v2、ux-v2、curves、pen-direction 子目录的样本用于回归旧快照读取。tuheng.stroke/1.0.0 样本需通过独立笔迹导入入口使用。[示例目录](geometry-examples)
