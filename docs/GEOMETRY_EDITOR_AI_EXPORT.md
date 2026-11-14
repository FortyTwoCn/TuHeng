# 几何评分证据

旧图片请求继续使用 contractVersion 1 和 geometry-review/1.0.0。几何请求使用兼容扩展的 contractVersion 1、独立 geometryEvidence 字段和新增 geometry-review/1.1.0 提示词。旧快照与旧提示词继续解析。

geometryEvidence 包含冻结题干、实际作答、公共模块分析的关系及确定性中文描述。至少提供有效图片或非空几何答案。仅有题干不构成答案。纯几何输入通过同一 Provider 文本消息发送。

几何批注使用 entityIds 和 relationIds，程序校验对象、关系和错误 ID。无效定位被过滤并标记复核。教师仍通过 GradeDecision 确认和发布成绩。

geometry-core 的 exportGeometryBundle 返回 document、derivedRelations、narrative。scheduleRun 在提交事务内生成证据并保存到 GradingRun.request，重试直接读取该快照。geometry-core 完全不依赖模型。

自然语言示例文件为 geometry-examples/VHW_PROJECTION.txt。示例的 V、H 投影 x 坐标分别为 10 和 12，导出明确记录 2.000mm 偏差。未知空间坐标写为“未知”。约束声明与计算关系分别标注来源。

geometry-review/1.0.0 的模型输出 Schema 保留旧字段集合，1.1.0 的 Schema 要求 geometryAnnotations 数组，兼容严格 JSON Schema Provider。运行时结果读取允许旧记录缺少该数组。
