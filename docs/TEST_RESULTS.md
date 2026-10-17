# 实际验证结果

记录时间：2026-10-17 19:49:04 CST（Asia/Shanghai）。环境：Linux x86_64、Python 3.12.14。Windows 启动命令已提供，尚未在真实 Windows 机器执行。

## 自动化测试

- 测试：**70 passed / 0 failed / 0 errors / 0 skipped**。
- pytest 报告耗时：7.318 秒。
- 代码行覆盖率（src + app）：**91.85%**。这是代码执行覆盖率，不是作业识别或评分准确率。
- `ruff check .`：通过。
- 可编辑安装 `pip install --no-deps --no-build-isolation -e .`：通过。
- `pip check`：No broken requirements found。
- 未调用任何付费视觉 API。

可核验原始证据：`test-output.txt`、`test-results.xml`、`coverage.xml`、`requirements-tested.txt`。请使用 README 中命令重新执行；时间会随机器变化。

|覆盖内容|证据|
|---|---|
|OpenCV 已知变换透视恢复、纸张自动检测|test_preprocessing.py|
|无边框/错误裁切/无效四角回退，原图保留|test_preprocessing.py|
|1 像素细线、虚线、点划线保留参考|test_preprocessing.py|
|EXIF、手动裁切旋转、图片内容格式与透明底|test_preprocessing.py|
|JSON Schema、范围、0.5 步长、满分合计、得分合计、知识点引用|test_schemas.py|
|无法识别使用 null，不将证据不足评为零分|test_schemas.py、test_integration.py|
|缺图、HTTP 错误、超时、有限重试、截断和损坏 JSON|test_api.py、test_integration.py|
|视觉请求角色、真实 MIME、图像尺寸/字节数与请求预算|test_api.py|
|兼容服务 usage=null 与异常响应结构|test_api.py|
|两个 AI 阶段和真实 HTTP 适配器的受控响应测试|test_integration.py|
|教师确认门槛、编辑后失效、完整 Mock 报告展示|test_app.py|
|默认不落盘，显式开启审计时不保存图片/base64|test_integration.py|

## 实际服务与浏览器

使用 `streamlit run app.py --server.address 127.0.0.1 --server.port 8501` 启动；健康端点 `/_stcore/health` 返回 HTTP 200。

Playwright + 系统 Chromium 实际打开页面，将程序生成的三张 PNG 分别通过三个文件上传控件上传，切换明确标识的 Mock 模式，依次点击分析、教师确认、Mock 批改，检查 5.5 分、待教师复核与 Mock 标记。**0 个页面脚本异常**。这是界面/数据链路验收，未执行真实视觉推理。

证据：`browser_check.json`、`ui_initial.png`、`ui_report.png`。图像预处理证据：`preprocessing_comparison.png` 和 `preprocessing_quality.json`。

可选浏览器复现：先启动 Streamlit，再安装 `pip install -e '.[browser]'`、`python -m playwright install chromium`，运行 `python -m scripts.browser_smoke`。系统已有 Chromium 时可通过 `BROWSER_EXECUTABLE` 指向其可执行文件。本次 Linux 使用 `/usr/bin/chromium`。

## 修复及未验证范围

检查中修复了上传失败图片被略过后仍可继续批改的问题；无效输入现在阻止批改并使旧结果失效。兼容服务 `usage: null` 和异常消息结构会受控处理，解析失败保留原始响应。浏览器测试还调整了等待异步组件渲染的方式，避免截图和分数断言抢在组件完成之前。

**真实视觉模型手工验收尚未执行**：当前未配置可用的 `OPENAI_API_KEY` 和已确认的视觉模型。现有环境的网络访问策略也不能证明任意模型端点可达。详情见 `REAL_MODEL_TEST.md`。不存在真实学生作业准确率结论。

自动化样本全部为程序生成的基础线图或可控响应，不能验证复杂题型、未知纸张背景、手写符号识别、等价方法识别或教师评分一致性。方向纠偏、边框识别、图片压缩和细线保留均有实际局限，需按真实模型流程人工验收。所有报告仍为 AI 建议，待教师复核。
