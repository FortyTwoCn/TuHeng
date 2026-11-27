# 分步作图动画契约

[图纸 JSON 契约](GEOMETRY_EDITOR_SCHEMA.md) · [编辑器操作](GEOMETRY_EDITOR_INTERACTION.md)

完整图纸的可选 `constructionAnimation` 与独立 `.animation.json` 交换的是同一份 `tuheng.construction-animation/1.0.0` 对象。编辑器可从任一载体导入动画到当前图纸。若包含 `editorType`，它必须与当前图纸一致。同一工程图的图元 ID、视图 ID 和图纸坐标应在生成与挂载时固定。[独立动画 JSON Schema](geometry-schemas/tuheng.construction-animation.schema.json) · [完整图纸 JSON Schema](geometry-schemas/tuheng.geometry.schema.json)

## 字段

| 字段 | 要求 |
| --- | --- |
| `schemaVersion` | 固定为 `tuheng.construction-animation/1.0.0`。 |
| `editorType` | 可选。使用当前图纸的类型，例如 `THREE_VIEW` 或 `VH_PROJECTION`。 |
| `title`、`description` | 中文标题与课题说明。标题为 1 至 120 字符。说明最多 4000 字符，可为空。 |
| `phases` | 最多 64 个阶段。每项有唯一 `id`、从 0 连续递增的 `order` 和非空 `title`。无分组时传空数组。 |
| `steps` | 1 至 200 步。每项有唯一 `id`、从 0 连续递增的 `order`、可选的现有 `phaseId`、`title`、`narration`、`kind` 与 `entityIds`。讲解为 1 至 4000 字符，可使用换行。 |
| `entityIds` | 正式实体 ID，按实际笔顺排列。只有临时线、擦除目标或最终加深时可传空数组。每个引用列表内 ID 唯一。 |
| `constructionEntityIds` | 可选。当前步先描画的正式辅助线 ID。 |
| `temporaryGuides` | 可选，每步最多 120 条。包含步内唯一 `id`、可选 `viewId`、`kind`、`from`、`to` 和可选 `label`。类型为 `PROJECTION`、`MITER`、`EXTENSION` 或 `ALIGNMENT`，端点必须不同。 |
| `focusPoints` | 可选，每步最多 120 个。包含步内唯一 `id`、`position`、`kind` 和可选 `label`。特殊点 `SPECIAL` 为橙色，一般点 `GENERAL` 为绿色。 |
| `eraseEntityIds` | 仅在 `ERASE` 使用。该步以虚点标明正式实体，后续步骤将它隐藏。 |
| `highlightRole`、`durationMs` | 可选。相贯线用 `INTERSECTION_CURVE` 并在加深时保留红色。推荐时长为 250 至 30,000 毫秒整数。 |

用 `CENTERLINE` 确定基准，用 `CONSTRUCT` 作投影或定位，用 `DRAW` 逐笔画轮廓，用 `ERASE` 标记待擦除区段，最后用 `DEEPEN` 按实线、虚线和中心线整理成图。作图线先描，定位点接着标示，当前轮廓按 `entityIds` 错峰描画。播放过去步骤时可直接跳转重现其状态。

## 给生成模型的输入与校验

1. 提供图纸 JSON、独立动画 Schema 和教学目标。保留正式实体的 ID、几何、线型和视图坐标。已知答案图片的几何先经图纸契约核验，再以该图纸作为动画生成的输入。
2. 令模型输出一个纯 JSON 对象。按真实作图先后排列步骤，阶段只作讲解分组。在 `narration` 中写清取点依据、对正关系和笔顺。共享图纸坐标系的辅助线端点与定位点直接用毫米 `{ "x": 数值, "y": 数值 }`，Y 向上。视图局部坐标需先按图纸的 `transform` 换算。
3. 用 `normalizeConstructionAnimation(input, doc)` 验证模型对象，或用 `parseConstructionAnimationJson(text, doc)` 验证文件。得到通过校验的对象后，用 `withConstructionAnimation(doc, animation)` 生成待保存文档。在浏览器复用正常导入、历史和提交入口。
4. 修正诊断中的准确路径，例如 `$.steps[1].entityIds[0]` 或 `$.constructionAnimation.steps[1].temporaryGuides[0].viewId`。数组索引从 0 开始。读取阶段顺序、引用真实性和导入完整性以运行时校验为准。

临时线和定位点随动画保存。评分使用正式几何快照与计算关系。动画擦除是播放状态，正式几何仍由编辑命令维护。

## 可直接导入的完整示例

把下面的动画导入「最小线段」图纸。首先标出 A 和 B 与同一高度的引导线，再画正式线段并加深。[配套线段图纸](geometry-examples/AI-LINE-V3.json)

```json
{
  "schemaVersion": "tuheng.construction-animation/1.0.0",
  "editorType": "VHW_PROJECTION",
  "title": "描画线段 AB",
  "description": "使用现有端点定位后依次构造和加深。",
  "phases": [
    { "id": "draw", "order": 0, "title": "定位与描画" },
    { "id": "finish", "order": 1, "title": "检查加深" }
  ],
  "steps": [
    {
      "id": "line",
      "order": 0,
      "phaseId": "draw",
      "title": "用端点定位线段",
      "narration": "1. 沿定位线找 A、B。\n2. 从 A 到 B 描画线段。",
      "kind": "DRAW",
      "entityIds": ["segment-ab"],
      "temporaryGuides": [
        { "id": "align", "viewId": "view-0", "kind": "ALIGNMENT", "from": { "x": -60, "y": 10 }, "to": { "x": -10, "y": 10 } }
      ],
      "focusPoints": [
        { "id": "A", "position": { "x": -15, "y": 10 }, "kind": "SPECIAL", "label": "A" },
        { "id": "B", "position": { "x": -55, "y": 10 }, "kind": "GENERAL", "label": "B" }
      ]
    },
    {
      "id": "ink",
      "order": 1,
      "phaseId": "finish",
      "title": "检查并加深 AB",
      "narration": "确认端点后用可见轮廓实线加深。",
      "kind": "DEEPEN",
      "entityIds": []
    }
  ]
}
```

贯通孔三视图示例涵盖中心基准、蓝色投影、红色轮廓、45° 传宽、孔口和虚线、定位点、擦除与加深。完整图纸与独立动画可互相核对。[带动画的完整图纸](geometry-examples/construction/THREE-VIEW-CONSTRUCTION.json) · [独立动画文件](geometry-examples/construction/THREE-VIEW-CONSTRUCTION.animation.json)
