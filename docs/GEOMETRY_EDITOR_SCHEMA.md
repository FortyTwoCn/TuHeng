# GeometryDocument v2.1 与兼容

基本编辑文档使用 `tuheng.geometry/2.0.0`；首次写入类型化参考关系时升级为 `tuheng.geometry/2.1.0`。两者的 units 为 `mm`，coordinateSystem 为 `VIEW_LOCAL_WITH_SHEET_TRANSFORM`。`geometry-v1.ts` 保留 `tuheng.geometry/1.0.0` 原契约；`loadGeometryDocument` 和序列化不迁移历史记录，编辑器及新的编辑事务显式调用 `upgradeGeometryDocument`。

## 局部坐标 → 图纸坐标

每个 view 新增 `transform: {origin,xAxis,yAxis}`。局部点 (x,y) 对应 origin+x*xAxis+y*yAxis。轴向单位向量正交，保持统一毫米比例。`sheet.origin=(0,0)`；图纸 U 向右、T 向上。局部坐标仍使用旧 mapping/signs 的语义，迁移不直接把旧坐标当新图纸坐标。

默认 V 局部 (x,z) 经 xAxis=(-1,0)、yAxis=(0,1) 变为 (-x,z)；H 局部 (x,-y) 变为 (-x,-y)；W 局部 (y,z) 保持 (y,z)。三个基准框架和最多 24 个派生框架使用同一镜头；轴测图保留一个框架。

## 新字段

- `sheet.allowAuxiliaryViews`：题目允许学生新增换面轴，服务端与冻结题干逐项比较。
- `auxiliarySystems`：ProjectionAxis 数组，包含 id/name/version、owner/locked、parentId、retainedViewId/replacedViewId/newViewId、anchor/tangent、side/positiveNormal、oldAxis 的锚点/切向/正法向、method/referenceEntityId 及参考方向校验状态。
- 点可保留 `aliases/mergedFrom`。合点删除源实体并重写正式引用；跨投影不合点，题干对象本身保持不变。
- 无限辅助线可带 `scope: SHEET`。viewId 仍记录其作图框架，显示跨越整张图纸。
- `constraints.mode` 区分 POSITION、BINDING、ANALYSIS；status 为 SATISFIED、INVALID、UNVERIFIED。服务端导出依据实际几何重算，客户端状态不可信。
- 笔迹实体保存 samples；sampling 记录 cssPixelsPerMm 和采样框架变换。旧任意三维 plane 迁移后带 legacyReadOnly，不猜测成换面轴。

Schema 拒绝非有限数字、重复 ID、悬空/错误引用、零长线、图层与线型不匹配、循环几何/绑定/换面依赖、退化变换、无效新旧轴关系及非法参考对象。总上限保持 2MB 输入、2000 实体、1000 约束、500 投影组、30000 笔迹坐标；单段最多 4096 采样，坐标 ±10000mm。

## 2.1 类型化参考关系

`referenceRelations` 为可选数组，最多 1000 条；只有 2.1 文档允许此字段。基准轴没有伪造为学生实体，轴 ID 不进入只允许实体的 entityIds。引用为以下判别联合：

```ts
type GeometryTargetRef =
  | { kind: 'entity'; entityId: string }
  | { kind: 'baseAxis'; axisId: 'X' | 'Z' | 'Y_H' | 'Y_W' | 'x' | 'y' | 'z' }
  | { kind: 'projectionAxis'; systemId: string }
  | { kind: 'origin'; frameId: string };
```

每条关系保存 id、targetId、reference、kind（POINT_ON_REFERENCE / THROUGH_POINT / PARALLEL / PERPENDICULAR）、mode（POSITION / BINDING）、source（USER / SNAP_CONFIRMED）及 status。POSITION 记录一次定位/方向事实，不承诺持续维护；BINDING 由显式有向依赖维护。status 依据真实几何重算，声明和计算结果分开；导出与评分不调用绑定求解去改正学生答案。

运行时检查引用存在性、框架作用域、目标类型、重复、自引用、循环和共享端点冲突。冻结题干的关系不可修改，也不能伪造新增关系来控制或重新声明题干。合点重写相关引用；复制内部关系同时映射 ID，外部持续绑定要求先解除或连同参考对象选择，不静默丢失。删除参考对象检查依赖。

渲染/命中使用的临时 key、吸附候选、选中集合、输入草稿、相机、HUD 均不是文档字段。示例见 [2.1 换面轴引用](geometry-examples/ux-v2/reference-axis.json)、[方向绑定](geometry-examples/ux-v2/direction-binding.json)、[合点](geometry-examples/ux-v2/merged.json)。

## 保存与权限

旧 JSON 原样读取；重新编辑得到新 v2 草稿。已有正式快照和批改请求不被就地改写。`combineAnswer` 锁定原有题干、框架、轴、原点、配置和关系，只允许题目许可的 STUDENT 轴及对应派生框架；学生不能声明教师所有权。现有 JSONB 列与版本字符串列足以承载 v2/2.1，无新增表或 DDL。新的 2.1 评分请求使用 geometry-review/1.3.0；2.0 继续使用 1.2.0，v1 与旧队列请求继续接受原版本。新提示词仅扩展已有 grading-core，不在编辑器调用 AI。

关系 status 和轴 referenceStatus 是计算结果。新答案校验在题干与作答的副本上统一重算这些字段，再比较受保护定义，兼容 v1 缺少状态字段的题目。此过程不调整几何坐标，也不改写历史数据。

四份 v1 示例继续保留在 `geometry-examples/`。v2 示例位于 `geometry-examples/v2/`：标准三面投影、两级新轴、合点引用以及完整图纸 SVG。

## 可导入笔迹样本

使用与设备无关的 `tuheng.stroke/1.0.0`：

```json
{
  "schemaVersion": "tuheng.stroke/1.0.0",
  "coordinateSpace": "VIEW_LOCAL_MM",
  "viewId": "view-0",
  "cssPixelsPerMm": 3,
  "pointerType": "pen",
  "samples": [
    { "x": 0, "y": 0, "pressure": 0.5 },
    { "x": 1, "y": 1, "pressure": 0.5 }
  ]
}
```

样本通过独立运行时 Schema 后，使用现有 addPenStroke 应用到当前选定框架。合成测试样本在 `geometry-examples/v2/stroke-circle.json`，明确不代表真实设备采集；真实设备可输出相同格式，不需要照片识别服务。

## 斜二等轴默认值与电子笔线型修复（2026-11-15）

新建 OBLIQUE_DIMETRIC 文档的 depthAngle 为 -135°、depthScale 为 0.5：图纸 x 向右、z 向上、y 向左下。角度基于图纸 x 正向逆时针，非屏幕 y 向下坐标。历史文件的显式角度（包括原默认 45°）读取和重存时保留，既有题干和学生历史快照不回填。参考 [清华大学出版社轴测图样章，第 5 章，印刷页 120](https://www.tup.tsinghua.edu.cn/upload/books/yz/103003-01.pdf) 的轴间角和缩短系数。

电子笔会话线型不成为新 JSON 字段；使用既有 lineStyle、layerId 与实体 kind 表达结果。辅助直线保存为 line(anchor, direction)，方向归一化，不能通过拉长 segment 假装无限。line 也保留既有 samples、sampling 字段；恢复后 polyline 继承线型与采样证据。未增加契约版本、数据库迁移或第二套笔迹格式。
