from src.schemas.models import GradingReport


def json_report(report: GradingReport):
    return report.model_dump_json(indent=2)


def escape(text):
    return str(text).replace("|", "\\|").replace("\n", "<br>")


def markdown_report(report: GradingReport):
    tag = "MOCK 固定样例（未执行视觉推理）" if report.model_metadata.is_mock else "AI 建议"
    score = "无法可靠评分（null）" if report.total_score is None else f"{report.total_score:g} / 10"
    lines = [f"# 画法几何作业批改报告 · {tag}", "", "**待教师复核，不是教师正式评分。**",
             "单次作业仅反映本题局部表现，不代表学生长期知识掌握度。", "",
             f"提交编号：{report.submission_id}", f"生成时间：{report.created_at.isoformat()}",
             f"建议总分：**{score}**", f"置信度：{report.confidence:.0%}", "",
             "## 题目分析", report.question_analysis.summary,
             "", "### 作图任务", *[f"- {t}" for t in report.question_analysis.tasks],
             "", "### 必需结果", *[f"- {t}" for t in report.question_analysis.required_results],
             "", "### 关键关系与作图步骤", *[f"- {t}" for t in report.question_analysis.key_relationships + report.question_analysis.construction_steps],
             "", "### 可接受的其他方法", *[f"- {t}" for t in report.question_analysis.acceptable_alternatives],
             "", "### 不确定性", *[f"- {t}" for t in report.question_analysis.uncertainties],
             "", "## 逐项评分", "|评分项|要求|得分|满分|状态|依据|置信度|",
             "|---|---|---:|---:|---|---|---:|"]
    rubric = {r.rubric_id: r for r in report.rubric}
    for s in report.rubric_scores:
        lines.append(f"|{s.rubric_id}|{escape(rubric[s.rubric_id].criterion)}|{s.score if s.score is not None else 'null'}|{s.max_score}|{s.status}|{escape(s.evidence)}|{s.confidence:.0%}|")
    lines.extend(["", "## 正确完成的部分", *[f"- {x}" for x in report.correct_parts], "", "## 错误诊断"])
    for m in report.mistakes:
        lines.extend([f"### {m.rubric_id} · {m.category}", m.description, f"原因：{m.reason}",
                      *[f"{i}. {step}" for i, step in enumerate(m.correction_steps, 1)]])
    lines.extend(["", "## 修改建议", *[f"- {x}" for x in report.correction_guidance], "", "## 知识点局部表现"])
    for k in report.knowledge_assessments:
        lines.extend([f"### {k.name}（{k.knowledge_id}）", f"局部评分：{k.score if k.score is not None else 'null'}；{k.status}；置信度 {k.confidence:.0%}",
                      *[f"- 证据：{x}" for x in k.evidence], *[f"- 薄弱环节：{x}" for x in k.weaknesses],
                      *[f"- 学习建议：{x}" for x in k.suggestions]])
    lines.extend(["", "## 复核原因", *[f"- {x}" for x in report.review_reasons], "", "## 图像质量"])
    for q in report.image_quality:
        lines.extend([f"- {q.role}/{q.image_id}：{q.original_width}×{q.original_height} → {q.processed_width}×{q.processed_height}；{q.perspective_status}；清晰度参考 {q.sharpness_reference:.1f}",
                      *[f"  - {x}" for x in q.warnings + q.logs]])
    lines.extend(["", "## 模型元数据", "```json", report.model_metadata.model_dump_json(indent=2), "```"])
    return "\n".join(lines) + "\n"
