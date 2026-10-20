# 验证策略

纯单元测试无需网站/数据库/Redis：contracts、整数分、评分证据与不确定性、权限、截止时间、变换、Provider 响应适配/超时。Mock 仅在测试注入。

集成测试使用独立测试命名数据，连接真实 PostgreSQL、Redis 与 MinIO，覆盖建题→发布→上传→提交→outbox→core mock→复核→发布→学生查看→错题，以及授权、幂等与已发布保护。

Playwright：真实 Auth.js 登录，学生上传、教师发布/复核、管理员账户操作。压测脚本使用专用测试学生，不在生产运行。每次运行输出实际结果，最终记录于 DELIVERY.md。

真实模型手动验收：设置 AI_API_KEY/AI_BASE_URL/AI_MODEL，确认服务支持 image_url 视觉与 json_object 或 json_schema，启动 worker；创建点投影题和参考图，教师确认，学生提交可读 JPG；核对 run 的 prompt/config/strategy 版本、建议与证据，教师修正发布。比较辅助线保留和原图。用同一题重复不同模型/提示词版本，人工标注对比，不推断准确率。
