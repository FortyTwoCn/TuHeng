# 批改契约 v1

GradingRequest 固定题目、答案、rubric、模型配置、strategy 与 prompt 版本，包含资源引用，不包含学生姓名。图像适配器按引用加载私有数据，转 data URL 只存在调用内存中。

阶段接口：ImagePreprocessing → QuestionAnalysis → ReferenceAnalysis → RubricResolution → SubmissionAnalysis → GradingEvaluation → ResultValidation → GradingReport。首版分析/评价合并一次视觉请求，阶段保留明确类型边界；不声称独立几何检测能力。

Provider 只返回未知数据与调用统计；core 通过 Zod、ID 完整性、分数范围、证据、重复关联错误及总分验证生成稳定业务结果。未知项 null，总分不能确定时 null。未确认答案、低质量、不确定/缺证据均 requiresReview。所有正式作业必须教师复核。

提示词在 packages/grading-core/src/prompts.ts 代码版本管理；Worker 使用 run 创建时快照。升级新增版本，不原地修改旧版本。替换模型实现只需实现 VisionProvider；替换算法实现 GradingEngine，不改 UI。

原始响应与规范化建议分开持久化，仅教师授权范围可查看规范化建议；不将原始响应暴露给学生。运行 Mock 必须 NODE_ENV=test 且显式注入，生产缺 key 返回 BLOCKED_CONFIG，不编造分数。

几何批注采用归一化处理图坐标，记录 assetVersion；无法验证定位时不生成批注。模型自报 confidence 不当作准确率。
