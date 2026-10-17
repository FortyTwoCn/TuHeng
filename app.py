"""中文 Streamlit UI. All grading logic lives in src/."""
import json
from hashlib import sha256
from uuid import uuid4

import pandas as pd
import streamlit as st

from src.ai.client import AIError, OpenAICompatibleClient
from src.ai.mock import SAMPLE_DIR, MockVisionClient
from src.grading.service import GradingService, TeacherInputs, confirm_analysis
from src.preprocessing.pipeline import PreprocessOptions, decode_image, png_bytes, process_image
from src.reporting.export import json_report, markdown_report
from src.schemas.models import AnalysisResult
from src.utils.audit import AuditTrail
from src.utils.config import Settings

st.set_page_config(page_title="画法几何 AI 作业批改 · v0.1", page_icon="📐", layout="wide")


def digest(value):
    return sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def error_view(exc):
    st.error(str(exc))
    st.session_state["last_failure"] = {"error": str(exc), "raw_response": getattr(exc, "raw_response", None)}


@st.cache_data(show_spinner=False, max_entries=36)
def cached_process(data, role, image_id, options):
    return process_image(data, role, image_id, options)


def read_assets(role, uploads, use_sample, common):
    items = [(u.getvalue(), i) for i, u in enumerate(uploads or [])]
    if use_sample and not items:
        items = [((SAMPLE_DIR / f"{role}.png").read_bytes(), 0)]
    if len(items) > 6:
        st.error(f"{role} 超过 6 张，请减少图片")
        st.session_state["image_input_error"] = True
        return []
    assets = []
    for data, index in items:
        image_id = f"{role}-{index + 1}"
        key = image_id + "-" + sha256(data).hexdigest()[:12]
        with st.expander(f"{image_id} · 处理对比与手动调整", expanded=len(items) == 1):
            try:
                original, _ = decode_image(data)
                h, w = original.shape[:2]
                rotation = st.selectbox("手动顺时针旋转", [0, 90, 180, 270], key=key+"rot")
                mode = st.selectbox("裁切/透视方式", ["自动保守检测", "保留完整原图", "手动矩形裁切", "手动四角坐标"], key=key+"mode")
                crop, corners = None, None
                if mode == "手动矩形裁切":
                    st.caption(f"坐标基于 EXIF 校正后的原图 {w}×{h}；先裁切，再旋转。请保留所有辅助线和标注。")
                    left, right = st.slider("左右边界", 0, w, (0, w), key=key+"lr")
                    top, bottom = st.slider("上下边界", 0, h, (0, h), key=key+"tb")
                    crop = (left, top, right, bottom)
                elif mode == "手动四角坐标":
                    st.caption("在下方原图读取像素坐标，按左上、右上、右下、左下输入。自动排序仅支持凸四边形。")
                    text = st.text_area("四角坐标 JSON", json.dumps([[0, 0], [w-1, 0], [w-1, h-1], [0, h-1]]), key=key+"corners")
                    corners = tuple(tuple(float(v) for v in p) for p in json.loads(text))
                opts = PreprocessOptions(**common, rotation=rotation, crop=crop, corners=corners,
                                         auto_perspective=mode == "自动保守检测")
                asset = cached_process(data, role, image_id, opts)
                views = st.columns(3)
                for col, array, label in zip(views, [asset.original, asset.corrected, asset.enhanced], ["原图（EXIF 方向校正）", "矫正图", "增强图"]):
                    col.image(array, caption=label, use_container_width=True)
                st.caption(f"原图 {w}×{h} · 清晰度参考 {asset.quality.sharpness_reference:.1f} · 细线保留参考 {asset.quality.thin_line_retention_reference:.1%}")
                st.caption(" / ".join(asset.quality.warnings))
                if asset.quality.failure_reason:
                    st.warning(asset.quality.failure_reason)
                st.json(asset.quality.model_dump(), expanded=False)
                st.download_button("下载增强图", png_bytes(asset.enhanced), image_id+"-enhanced.png", "image/png", key=key+"download")
                assets.append(asset)
            except (ValueError, OSError) as exc:
                st.error(f"{image_id}：{exc}")
                st.session_state["image_input_error"] = True
    return assets


def show_report(report):
    if report.model_metadata.is_mock:
        st.warning("MOCK 固定样例 · 未执行视觉推理 · 分数不代表上传图片的真实表现")
    st.info("AI 建议 · 待教师复核。单次作业只反映本题局部表现，不代表长期掌握度。")
    cols = st.columns(3)
    cols[0].metric("建议总分 / 10", "待复核（null）" if report.total_score is None else f"{report.total_score:g}")
    cols[1].metric("模型自报置信度（未校准）", f"{report.confidence:.0%}")
    cols[2].metric("教师复核", "必需")
    rubric = {r.rubric_id: r for r in report.rubric}
    st.subheader("逐项评分")
    st.dataframe(pd.DataFrame([{"评分项": s.rubric_id, "要求": rubric[s.rubric_id].criterion,
        "得分": s.score, "满分": s.max_score, "状态": s.status, "依据": s.evidence,
        "置信度": s.confidence} for s in report.rubric_scores]), hide_index=True, use_container_width=True)
    st.subheader("正确完成的部分")
    for text in report.correct_parts:
        st.write("• " + text)
    st.subheader("错误诊断与具体修改步骤")
    if not report.mistakes:
        st.write("没有可报告的明确错误；也可能证据不足，请结合复核原因判断。")
    for m in report.mistakes:
        with st.expander(f"{m.rubric_id} · {m.category} · {m.description}", expanded=True):
            st.write("原因：" + m.reason)
            for i, step in enumerate(m.correction_steps, 1):
                st.write(f"{i}. {step}")
    for text in report.correction_guidance:
        st.write("• " + text)
    st.subheader("知识点本题局部表现")
    st.caption("0–100 是本题表现参考值；置信度为模型自报，未经统计校准。证据不足项保留 null，不绘制为 0。")
    numeric = [{"知识点": k.name, "局部表现": k.score} for k in report.knowledge_assessments if k.score is not None]
    if numeric:
        st.bar_chart(pd.DataFrame(numeric).set_index("知识点"), y="局部表现", horizontal=True)
    st.dataframe(pd.DataFrame([{"ID": k.knowledge_id, "知识点": k.name, "评分": k.score,
        "状态": k.status, "证据": "；".join(k.evidence), "薄弱环节": "；".join(k.weaknesses),
        "学习建议": "；".join(k.suggestions), "置信度": k.confidence} for k in report.knowledge_assessments]),
        hide_index=True, use_container_width=True)
    st.subheader("待复核原因")
    for reason in report.review_reasons:
        st.write("• " + reason)
    a, b = st.columns(2)
    a.download_button("下载 JSON 报告", json_report(report), f"{report.submission_id}.json", "application/json")
    b.download_button("下载 Markdown 报告", markdown_report(report), f"{report.submission_id}.md", "text/markdown")
    with st.expander("完整报告与模型元数据"):
        st.json(report.model_dump(mode="json"))


def main():
    st.title("📐 画法几何及机械制图 · AI 作业批改")
    st.caption("v0.1 验证 Demo ｜ 图像预处理 → 题意与细则确认 → 逐项评估 → 教师复核")
    st.info("所有结果为 AI 建议，必须由教师复核。请上传匿名材料；调用真实 API 时，所选图片和补充文字会发送给配置的服务。")
    try:
        settings = Settings.from_env()
    except ValueError as exc:
        st.error(f"环境配置无效：{exc}")
        st.stop()
    with st.sidebar:
        st.header("运行与 API 状态")
        mode = st.radio("运行模式", ["真实视觉 API", "Mock 流程测试（固定响应）"])
        is_mock = mode.startswith("Mock")
        if settings.missing:
            st.warning("缺少配置：" + "、".join(settings.missing))
        else:
            st.success("配置字段已齐备；视觉能力和连通性尚需实际调用验证")
        st.write("API 地址：", settings.base_url)
        st.write("模型：", settings.model or "未设置")
        st.caption("密钥仅从环境变量读取，界面不回显。真实 API 失败不会自动切换 Mock。")
        if settings.persist_local_logs:
            st.warning("已开启本地日志：模型原始响应可能含个人信息，请主动清理 artifacts。")
        scenario_label = st.selectbox("Mock 场景", ["正常样例", "无法辨认", "API 错误", "损坏 JSON"], disabled=not is_mock)
        scenario = {"正常样例": "normal", "无法辨认": "unrecognizable", "API 错误": "api_error", "损坏 JSON": "invalid_json"}[scenario_label]
        if is_mock:
            st.warning("Mock 不分析图片，使用固定样例。修改细则结构后可能触发预期的交叉校验错误。")
        use_sample = st.checkbox("未上传区域使用程序生成样例", value=False)
        st.header("预处理参数")
        common = {"clahe": st.checkbox("自适应对比度 CLAHE", True),
                  "denoise": st.checkbox("轻度保边去噪", True),
                  "auto_deskew": st.checkbox("按可靠水平线轻度纠偏", True),
                  "sharpen": st.slider("锐化强度（不恢复真实细节）", 0.0, 1.5, 0.25, 0.05),
                  "brightness": st.slider("亮度系数", 0.7, 1.3, 1.0, 0.05)}
        variants_label = st.selectbox("发送给模型的图片", ["原图与增强图（推荐）", "仅原图", "仅增强图"])
        variants = {"原图与增强图（推荐）": "both", "仅原图": "original", "仅增强图": "enhanced"}[variants_label]
        st.caption(f"请求长边 ≤{settings.max_image_side}px，每张编码 ≤{settings.max_image_bytes // 1000}KB。缩放/压缩可能影响细线，细小标注请裁切局部后补充上传。")
        if st.button("清空当前会话与预处理缓存"):
            cached_process.clear()
            st.session_state.clear()
            st.rerun()
    st.subheader("1 · 三类独立输入")
    columns = st.columns(3)
    assets = []
    st.session_state["image_input_error"] = False
    for col, role, title in zip(columns, ["question", "reference", "student"], ["A. 题目", "B. 标准答案（教师参考）", "C. 学生答案"]):
        with col:
            st.markdown(f"**{title}**")
            uploads = st.file_uploader(title, type=["jpg", "jpeg", "png"], accept_multiple_files=True, key="upload-"+role)
            st.caption("最多 6 张，每张 ≤20 MiB / 2400 万像素。按上传顺序发送。")
            assets.extend(read_assets(role, uploads, use_sample, common))
    with st.expander("教师补充材料与匿名测试编号", expanded=True):
        question = st.text_area("教师补充题目文字", max_chars=16000)
        answer = st.text_area("教师补充答案说明", max_chars=16000)
        rules = st.text_area("教师给定评分细则（优先采用；请核对转换后的 10 分制）", max_chars=16000)
        anonymous = st.text_input("学生匿名测试编号（可选；不要填写姓名学号）", max_chars=64)
    inputs = TeacherInputs(question, answer, rules)
    context = digest({"assets": [a.fingerprint for a in assets if a.role != "student"], "inputs": inputs.__dict__,
                      "mode": mode, "scenario": scenario, "variants": variants,
                      "input_error": st.session_state["image_input_error"],
                      "api": [settings.base_url, settings.model, settings.response_format]})
    if st.session_state.get("context") != context:
        for key in ["analysis", "stage_a_reply", "confirmed", "report", "last_failure"]:
            st.session_state.pop(key, None)
        st.session_state["context"] = context
        st.session_state["editor_version"] = uuid4().hex
    audit = st.session_state.setdefault("audit", AuditTrail(settings))
    audit.settings = settings
    client = MockVisionClient(scenario) if is_mock else OpenAICompatibleClient(settings)
    service = GradingService(settings, client, audit)
    ready_a = not st.session_state["image_input_error"] and all(any(a.role == r for a in assets) for r in ["question", "reference"])
    ready_b = ready_a and any(a.role == "student" for a in assets)
    st.subheader("2 · 题目分析与评分细则确认")
    if st.button("分析题目与标准答案", disabled=not ready_a or (bool(settings.missing) and not is_mock), type="primary"):
        for key in ["confirmed", "report", "analysis", "last_failure"]:
            st.session_state.pop(key, None)
        try:
            with st.status("阶段 A：准备图像并分析题目/参考答案…", expanded=True) as status:
                result, reply, _ = service.analyze(assets, inputs, variants)
                st.session_state.update(analysis=result, stage_a_reply=reply, editor_version=uuid4().hex)
                status.update(label="阶段 A 完成；请编辑并确认细则", state="complete")
        except (AIError, ValueError, OSError) as exc:
            error_view(exc)
    if "analysis" in st.session_state:
        analysis = st.session_state["analysis"]
        st.write(analysis.question_analysis.summary)
        with st.expander("题意、几何关系、步骤和不确定性", expanded=True):
            st.json(analysis.question_analysis.model_dump())
        st.caption("以下 JSON 可直接编辑。评分项满分必须为 0.5 的倍数且合计 10；知识点 ID 必须与细则关联一致。")
        version = st.session_state["editor_version"]
        q_json = st.text_area("可编辑题目分析 JSON", analysis.question_analysis.model_dump_json(indent=2), height=200, key="qa-"+version)
        k_json = st.text_area("可编辑知识点 JSON", json.dumps([k.model_dump() for k in analysis.knowledge_points], ensure_ascii=False, indent=2), height=200, key="kp-"+version)
        r_json = st.text_area("可编辑评分细则 JSON", json.dumps([r.model_dump() for r in analysis.rubric], ensure_ascii=False, indent=2), height=260, key="rb-"+version)
        try:
            edited = AnalysisResult.model_validate_json(json.dumps({"question_analysis": json.loads(q_json), "knowledge_points": json.loads(k_json), "rubric": json.loads(r_json)}, ensure_ascii=False))
            canonical = edited.model_dump_json()
            if "confirmed" in st.session_state and st.session_state["confirmed"].analysis_json != canonical:
                st.session_state.pop("confirmed", None)
                st.session_state.pop("report", None)
            st.success("结构校验通过：评分项满分合计 10 分。请人工核对题意、知识点和评分规则。")
            if st.button("确认以上题意、知识点与评分细则"):
                st.session_state["confirmed"] = confirm_analysis(canonical)
                st.session_state.pop("report", None)
        except (ValueError, json.JSONDecodeError) as exc:
            st.session_state.pop("confirmed", None)
            st.session_state.pop("report", None)
            st.error(f"编辑内容校验失败：{exc}")
    confirmed = st.session_state.get("confirmed")
    if confirmed:
        st.info("评分细则已确认。修改图片、补充材料或细则将使相关确认/报告失效。")
    report_context = digest({"context": context, "assets": [a.fingerprint for a in assets],
                             "rubric": confirmed.digest if confirmed else None, "anonymous": anonymous})
    if st.session_state.get("report_context") != report_context:
        st.session_state.pop("report", None)
        st.session_state["report_context"] = report_context
    st.subheader("3 · AI 批改与报告")
    if st.button("开始 AI 批改" if not is_mock else "开始 Mock 流程测试（非真实批改）",
                 disabled=not (confirmed and ready_b) or (bool(settings.missing) and not is_mock), type="primary"):
        st.session_state.pop("report", None)
        st.session_state.pop("last_failure", None)
        try:
            with st.status("阶段 B：逐项评估学生答案，校验分数和报告…", expanded=True) as status:
                report = service.grade(assets, inputs, confirmed, st.session_state["stage_a_reply"], variants,
                                       submission_id=(anonymous + "-" if anonymous else "") + uuid4().hex[:12])
                st.session_state["report"] = report
                status.update(label="报告生成并通过后端校验；待教师复核", state="complete")
        except (AIError, ValueError, OSError) as exc:
            error_view(exc)
    if "report" in st.session_state:
        show_report(st.session_state["report"])
    if "last_failure" in st.session_state:
        with st.expander("最近失败信息与原始响应（可重新点击生成）", expanded=True):
            failure = st.session_state["last_failure"]
            st.error(failure["error"])
            if failure["raw_response"]:
                st.code(failure["raw_response"], language="json")
                st.download_button("下载失败原始响应", failure["raw_response"], "failed-response.txt", "text/plain")
    with st.expander("本会话调用记录（默认不落盘）"):
        st.caption("原始上传文件仅用于会话/内存处理；记录输入哈希、尺寸、模型响应和错误。清空会话会清理本应用的会话记录与处理缓存。")
        st.json(audit.records, expanded=False)


if __name__ == "__main__":
    main()
