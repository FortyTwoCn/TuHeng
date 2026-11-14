# GeometryDocument v2 与兼容

新编辑文档的 schemaVersion 为 `tuheng.geometry/2.0.0`，units 为 `mm`，coordinateSystem 为 `VIEW_LOCAL_WITH_SHEET_TRANSFORM`。`geometry-v1.ts` 保留 `tuheng.geometry/1.0.0` 原契约；`loadGeometryDocument` 和序列化不迁移历史记录，编辑器及新的编辑事务显式调用 `upgradeGeometryDocument`。

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

## 保存与权限

旧 JSON 原样读取；重新编辑得到新 v2 草稿。已有正式快照和批改请求不被就地改写。`combineAnswer` 锁定原有题干、框架、轴、原点、配置和关系，只允许题目许可的 STUDENT 轴及对应派生框架；学生不能声明教师所有权。现有 JSONB 列与版本字符串列足以承载 v2，无新增表或 DDL。

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
