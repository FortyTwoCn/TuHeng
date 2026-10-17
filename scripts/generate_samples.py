"""Synthetic diagrams and explicit mock fixtures. No accuracy claims."""
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]


def font(size=20):
    for path in ["C:/Windows/Fonts/arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def diagram(kind):
    im = Image.new("RGB", (800, 650), "white")
    d = ImageDraw.Draw(im)
    d.text((35, 25), "SYNTHETIC TEST ONLY / NOT STUDENT WORK", fill="black", font=font(22))
    d.text((40, 70), "Point A: x=270, y=160, z=140. Draw a and a'.", fill="black", font=font(18))
    d.line((60, 320, 730, 320), fill="black", width=2)
    d.text((735, 310), "X", fill="black", font=font())
    d.text((40, 310), "O", fill="black", font=font())
    if kind != "question":
        x = 330 if kind == "reference" else 410
        d.ellipse((326, 176, 334, 184), fill="black")
        d.text((340, 155), "a'", fill="black", font=font())
        d.ellipse((x-4, 476, x+4, 484), fill="black")
        d.text((x+10, 475), "a" if kind == "reference" else "A", fill="black", font=font())
        # Deliberately faint 1 px auxiliary and separate dash-dot sample.
        d.line((330, 180, x, 480), fill=(145, 145, 145), width=1)
        for y in range(130, 530, 18):
            d.line((600, y, 600, y+9), fill=(160, 160, 160), width=1)
            d.point((600, y+13), fill=(160, 160, 160))
        d.text((40, 580), "Reference" if kind == "reference" else "Synthetic shifted lower projection", fill="black", font=font(18))
    return np.array(im)


def write_json(path, payload):
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def main():
    sample = ROOT / "sample_data"
    sample.mkdir(exist_ok=True)
    for role in ["question", "reference", "student"]:
        Image.fromarray(diagram(role)).save(sample / f"{role}.png")
    paper = diagram("student")
    canvas = np.full((850, 1100, 3), 65, np.uint8)
    corners = np.array([[160, 70], [950, 145], [890, 790], [75, 720]], np.float32)
    source = np.array([[0, 0], [799, 0], [799, 649], [0, 649]], np.float32)
    matrix = cv2.getPerspectiveTransform(source, corners)
    warped = cv2.warpPerspective(paper, matrix, (1100, 850))
    mask = cv2.warpPerspective(np.full((650, 800), 255, np.uint8), matrix, (1100, 850))
    canvas[mask > 0] = warped[mask > 0]
    # Smooth brightness gradient: reproducible simulated phone lighting.
    illumination = np.linspace(0.73, 1.0, 1100)[None, :, None]
    canvas = np.clip(canvas * illumination, 0, 255).astype(np.uint8)
    Image.fromarray(canvas).save(sample / "perspective_photo.png")

    points = [
        {"knowledge_id": "DG-PROJECTION-CORRESPONDENCE", "name": "投影对应关系", "description": "同一点的两面投影位于同一投影连线上"},
        {"knowledge_id": "DG-AUXILIARY-CONSTRUCTION", "name": "辅助作图线", "description": "通过辅助线定位投影并表达作图过程"},
        {"knowledge_id": "DG-DRAWING-STANDARDS", "name": "图线、符号和标注规范", "description": "区分结果线与细辅助线，正确标记投影名称"},
    ]
    analysis = {
        "question_analysis": {
            "summary": "MOCK 固定样例：根据已知坐标绘制点 A 的两面投影。此内容不是模型对上传图片的识别结果。",
            "question_type": "点的两面投影（程序生成示例）",
            "tasks": ["画出 a 与 a′", "校核投影对应并保留细辅助线"],
            "key_relationships": ["两面投影连线垂直于 X 轴，横坐标对应"],
            "construction_steps": ["定位投影连线", "按给定距离定位两面投影", "标记投影点名称"],
            "required_results": ["投影点位置、对应关系和符号正确"],
            "acceptable_alternatives": ["允许使用不同的辅助定位方法，只要最终关系正确且证据充分"],
            "uncertainties": ["MOCK 固定数据仅用于验证流程；不代表任何真实学生作业"],
            "teacher_rules_used": False,
        },
        "knowledge_points": points,
        "rubric": [
            {"rubric_id": "R1", "criterion": "两面投影位置及对应关系", "max_score": 4.0, "knowledge_ids": [points[0]["knowledge_id"]], "evidence_required": "核对两点相对 X 轴的位置及同一投影连线关系"},
            {"rubric_id": "R2", "criterion": "辅助投影连线和作图过程", "max_score": 4.0, "knowledge_ids": [points[1]["knowledge_id"]], "evidence_required": "核对可见辅助线是否支持正确定位"},
            {"rubric_id": "R3", "criterion": "图线与投影标注规范", "max_score": 2.0, "knowledge_ids": [points[2]["knowledge_id"]], "evidence_required": "检查辅助线粗细，投影点按题设标注小写 a 与 a′"},
        ],
    }
    evaluation = {
        "rubric_scores": [
            {"rubric_id": "R1", "score": 2.0, "max_score": 4.0, "evidence": "MOCK 预置：上方投影位置正确，下方投影向右偏移", "confidence": 0.8, "status": "部分正确"},
            {"rubric_id": "R2", "score": 2.0, "max_score": 4.0, "evidence": "MOCK 预置：保留了辅助连线，但连线倾斜，未支持正确对应", "confidence": 0.8, "status": "部分正确"},
            {"rubric_id": "R3", "score": 1.5, "max_score": 2.0, "evidence": "MOCK 预置：下方投影名称误写为大写 A；题设要求小写 a，辅助线已采用细线", "confidence": 0.8, "status": "部分正确"},
        ], "total_score": 5.5,
        "correct_parts": ["MOCK 预置：上方投影点和 X 轴已表达"],
        "mistakes": [
            {"rubric_id": "R1", "category": "知识性错误", "description": "MOCK 预置：下方投影未与上方投影对应", "reason": "同一点的两面投影应在垂直 X 轴的同一连线上", "correction_steps": ["过上方投影作 X 轴垂线", "按题设距离在垂线上重新定位下方投影", "复核投影名称与已知坐标"]},
            {"rubric_id": "R2", "category": "知识性错误", "description": "MOCK 预置：辅助投影连线倾斜", "reason": "连线未满足投影对应关系", "correction_steps": ["先确认 X 轴方向", "重新画垂直 X 轴的细辅助线并保留作图过程"]},
            {"rubric_id": "R3", "category": "作图规范错误", "description": "MOCK 预置：下方投影点使用了大写 A", "reason": "本题约定空间点用 A，投影用小写 a、a′，应区分二者", "correction_steps": ["将下方投影名称由 A 改为 a", "复核上方投影的 a′ 名称，并保持辅助线为细线"]},
        ],
        "correction_guidance": ["MOCK 固定建议：先校核投影对应关系，再调整点位和辅助线，最后检查标注"],
        "knowledge_assessments": [
            {"knowledge_id": p["knowledge_id"], "name": p["name"], "score": s,
             "evidence": ["MOCK 固定证据：" + e], "weaknesses": [w],
             "suggestions": [sugg], "confidence": 0.75, "status": "需要加强" if s < 60 else "基本掌握"}
            for p, s, e, w, sugg in zip(points, [50.0, 50.0, 75.0],
                ["上下投影未对齐", "辅助线倾斜", "下方投影误标为大写 A"],
                ["投影对应关系应用不稳", "辅助定位流程需加强", "空间点和投影的符号混淆"],
                ["练习同一点在两投影面中的对应关系", "练习先画投影连线再定位点", "对照本题约定区分 A 与 a、a′，再检查线型"])
        ], "confidence": 0.75, "review_reasons": ["MOCK 固定响应，未执行真实视觉推理；待教师复核"],
    }
    write_json(sample / "mock_analysis.json", analysis)
    write_json(sample / "mock_evaluation.json", evaluation)
    print("Generated synthetic fixtures and diagrams; no real student data.")


if __name__ == "__main__":
    main()
