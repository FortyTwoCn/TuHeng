# 画法几何作业批改报告 · MOCK 固定样例（未执行视觉推理）

**待教师复核，不是教师正式评分。**
单次作业仅反映本题局部表现，不代表学生长期知识掌握度。

提交编号：SYNTHETIC-MOCK-EXAMPLE
生成时间：2026-10-17T11:47:02.164810+00:00
建议总分：**5.5 / 10**
置信度：75%

## 题目分析
MOCK 固定样例：根据已知坐标绘制点 A 的两面投影。此内容不是模型对上传图片的识别结果。

### 作图任务
- 画出 a 与 a′
- 校核投影对应并保留细辅助线

### 必需结果
- 投影点位置、对应关系和符号正确

### 关键关系与作图步骤
- 两面投影连线垂直于 X 轴，横坐标对应
- 定位投影连线
- 按给定距离定位两面投影
- 标记投影点名称

### 可接受的其他方法
- 允许使用不同的辅助定位方法，只要最终关系正确且证据充分

### 不确定性
- MOCK 固定数据仅用于验证流程；不代表任何真实学生作业

## 逐项评分
|评分项|要求|得分|满分|状态|依据|置信度|
|---|---|---:|---:|---|---|---:|
|R1|两面投影位置及对应关系|2.0|4.0|部分正确|MOCK 预置：上方投影位置正确，下方投影向右偏移|80%|
|R2|辅助投影连线和作图过程|2.0|4.0|部分正确|MOCK 预置：保留了辅助连线，但连线倾斜，未支持正确对应|80%|
|R3|图线与投影标注规范|1.5|2.0|部分正确|MOCK 预置：下方投影名称误写为大写 A；题设要求小写 a，辅助线已采用细线|80%|

## 正确完成的部分
- MOCK 预置：上方投影点和 X 轴已表达

## 错误诊断
### R1 · 知识性错误
MOCK 预置：下方投影未与上方投影对应
原因：同一点的两面投影应在垂直 X 轴的同一连线上
1. 过上方投影作 X 轴垂线
2. 按题设距离在垂线上重新定位下方投影
3. 复核投影名称与已知坐标
### R2 · 知识性错误
MOCK 预置：辅助投影连线倾斜
原因：连线未满足投影对应关系
1. 先确认 X 轴方向
2. 重新画垂直 X 轴的细辅助线并保留作图过程
### R3 · 作图规范错误
MOCK 预置：下方投影点使用了大写 A
原因：本题约定空间点用 A，投影用小写 a、a′，应区分二者
1. 将下方投影名称由 A 改为 a
2. 复核上方投影的 a′ 名称，并保持辅助线为细线

## 修改建议
- MOCK 固定建议：先校核投影对应关系，再调整点位和辅助线，最后检查标注

## 知识点局部表现
### 投影对应关系（DG-PROJECTION-CORRESPONDENCE）
局部评分：50.0；需要加强；置信度 75%
- 证据：MOCK 固定证据：上下投影未对齐
- 薄弱环节：投影对应关系应用不稳
- 学习建议：练习同一点在两投影面中的对应关系
### 辅助作图线（DG-AUXILIARY-CONSTRUCTION）
局部评分：50.0；需要加强；置信度 75%
- 证据：MOCK 固定证据：辅助线倾斜
- 薄弱环节：辅助定位流程需加强
- 学习建议：练习先画投影连线再定位点
### 图线、符号和标注规范（DG-DRAWING-STANDARDS）
局部评分：75.0；基本掌握；置信度 75%
- 证据：MOCK 固定证据：下方投影误标为大写 A
- 薄弱环节：空间点和投影的符号混淆
- 学习建议：对照本题约定区分 A 与 a、a′，再检查线型

## 复核原因
- MOCK 固定响应，未执行真实视觉推理；待教师复核
- AI 建议，待教师复核；单次作业仅反映本题局部表现，不代表长期掌握度
- MOCK 固定样例：未执行视觉推理，不代表上传图片的实际表现

## 图像质量
- question/question-1：800×650 → 800×650；fallback_original；清晰度参考 1216.1
  - 细线指标只比较矫正图与增强图，无法保证透视、压缩及缩放后的细线均保留
  - 透视/裁切状态：fallback_original
  - 未发现同时满足面积、凸性和内外亮度差的可靠纸张外框；保留原图，可手动裁切/选四角
  - 无可靠 EXIF 方向；绘图上下方向不确定; 水平倾斜小于 0.35°；上下方向仍需用户确认
  - CLAHE=True; 轻去噪=True; 锐化=0.25; 亮度=1.0
  - 锐化不恢复真实细节；未使用生成式修复、图线擦除或自动内容裁边
- reference/reference-1：800×650 → 800×650；fallback_original；清晰度参考 1462.4
  - 细线指标只比较矫正图与增强图，无法保证透视、压缩及缩放后的细线均保留
  - 透视/裁切状态：fallback_original
  - 未发现同时满足面积、凸性和内外亮度差的可靠纸张外框；保留原图，可手动裁切/选四角
  - 无可靠 EXIF 方向；绘图上下方向不确定; 水平倾斜小于 0.35°；上下方向仍需用户确认
  - CLAHE=True; 轻去噪=True; 锐化=0.25; 亮度=1.0
  - 锐化不恢复真实细节；未使用生成式修复、图线擦除或自动内容裁边
- student/student-1：800×650 → 800×650；fallback_original；清晰度参考 1702.8
  - 细线指标只比较矫正图与增强图，无法保证透视、压缩及缩放后的细线均保留
  - 透视/裁切状态：fallback_original
  - 未发现同时满足面积、凸性和内外亮度差的可靠纸张外框；保留原图，可手动裁切/选四角
  - 无可靠 EXIF 方向；绘图上下方向不确定; 水平倾斜小于 0.35°；上下方向仍需用户确认
  - CLAHE=True; 轻去噪=True; 锐化=0.25; 亮度=1.0
  - 锐化不恢复真实细节；未使用生成式修复、图线擦除或自动内容裁边

## 模型元数据
```json
{
  "provider": "MOCK / 固定响应 / 非真实推理",
  "model": "MOCK-FIXTURE-NO-VISUAL-INFERENCE",
  "is_mock": true,
  "stage_a_request_id": "mock-fixed-question_analysis",
  "stage_b_request_id": "mock-fixed-student_evaluation",
  "stage_a_usage": {},
  "stage_b_usage": {},
  "input_manifest": [
    {
      "role": "question",
      "image_id": "question-1",
      "variant": "original",
      "mime": "image/png",
      "bytes": 12775,
      "width": 800,
      "height": 650,
      "source_sha256": "9f18baddcf7fdfb36fc4ca234d51364b5269e22b75bc4232027734f4d15641d2",
      "sha256": "9f18baddcf7fdfb36fc4ca234d51364b5269e22b75bc4232027734f4d15641d2"
    },
    {
      "role": "question",
      "image_id": "question-1",
      "variant": "enhanced",
      "mime": "image/png",
      "bytes": 13631,
      "width": 800,
      "height": 650,
      "source_sha256": "9f18baddcf7fdfb36fc4ca234d51364b5269e22b75bc4232027734f4d15641d2",
      "sha256": "dcc1f44a8b12f6e239f2cb7e5ec7ad59e562b60a26fedf403c8660b512d8a8c0"
    },
    {
      "role": "reference",
      "image_id": "reference-1",
      "variant": "original",
      "mime": "image/png",
      "bytes": 15088,
      "width": 800,
      "height": 650,
      "source_sha256": "c2cc5c0a96d4fe9f846056af21421cc4dc624390d3ee9a7f0895989beca79908",
      "sha256": "c2cc5c0a96d4fe9f846056af21421cc4dc624390d3ee9a7f0895989beca79908"
    },
    {
      "role": "reference",
      "image_id": "reference-1",
      "variant": "enhanced",
      "mime": "image/png",
      "bytes": 16534,
      "width": 800,
      "height": 650,
      "source_sha256": "c2cc5c0a96d4fe9f846056af21421cc4dc624390d3ee9a7f0895989beca79908",
      "sha256": "6a52e84f012fe4ec72d125ec3ccd536a6ccf3c48d907278a4d6950d4af5484a0"
    },
    {
      "role": "student",
      "image_id": "student-1",
      "variant": "original",
      "mime": "image/png",
      "bytes": 17357,
      "width": 800,
      "height": 650,
      "source_sha256": "f49a8fa72a4932664c1b757e515fd91823a6145d8f66c839a4b78a3be0cb40b2",
      "sha256": "f49a8fa72a4932664c1b757e515fd91823a6145d8f66c839a4b78a3be0cb40b2"
    },
    {
      "role": "student",
      "image_id": "student-1",
      "variant": "enhanced",
      "mime": "image/png",
      "bytes": 19615,
      "width": 800,
      "height": 650,
      "source_sha256": "f49a8fa72a4932664c1b757e515fd91823a6145d8f66c839a4b78a3be0cb40b2",
      "sha256": "221529f55a4770f62d8bb4cc88f6057b7d2c65721776e4d13e99ac8f0deb569b"
    }
  ],
  "duration_seconds": 0.058,
  "rubric_sha256": "3b63a7f1840ccc75b28c682923b1abd691af47d6a57e61ed5512281af97066ac",
  "teacher_confirmed_at": "2026-10-17T11:47:02.106283Z",
  "schema_version": "0.1"
}
```
