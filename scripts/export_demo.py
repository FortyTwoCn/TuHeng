"""Rebuild transparent mock report, schemas and synthetic comparison figure."""
from pathlib import Path

from PIL import Image, ImageDraw

from scripts.generate_samples import font
from src.ai.mock import MockVisionClient
from src.grading.service import GradingService, TeacherInputs, confirm_analysis
from src.preprocessing.pipeline import PreprocessOptions, png_bytes, process_image
from src.reporting.export import json_report, markdown_report
from src.schemas.models import AnalysisResult, GradingReport, StudentEvaluation
from src.utils.config import Settings

ROOT = Path(__file__).resolve().parents[1]


def main():
    docs = ROOT / "docs"
    docs.mkdir(exist_ok=True)
    for name, model in [("analysis", AnalysisResult), ("evaluation", StudentEvaluation), ("report", GradingReport)]:
        import json
        (docs / f"{name}.schema.json").write_text(json.dumps(model.model_json_schema(), ensure_ascii=False, indent=2), encoding="utf-8")
    assets = [process_image((ROOT / f"sample_data/{role}.png").read_bytes(), role, role+"-1")
              for role in ["question", "reference", "student"]]
    service = GradingService(Settings(), MockVisionClient())
    analysis, reply, _ = service.analyze(assets, TeacherInputs())
    report = service.grade(assets, TeacherInputs(), confirm_analysis(analysis.model_dump_json()), reply,
                           submission_id="SYNTHETIC-MOCK-EXAMPLE")
    (ROOT / "sample_data/example_report.mock.json").write_text(json_report(report), encoding="utf-8")
    (ROOT / "sample_data/example_report.mock.md").write_text(markdown_report(report), encoding="utf-8")
    import json
    (docs / "mock_call_trace.json").write_text(json.dumps(service.audit.records, ensure_ascii=False, indent=2), encoding="utf-8")
    photo = (ROOT / "sample_data/perspective_photo.png").read_bytes()
    result = process_image(photo, "student", "synthetic-photo", PreprocessOptions(auto_deskew=False))
    (docs / "preprocessing_quality.json").write_text(result.quality.model_dump_json(indent=2), encoding="utf-8")
    for name, rgb in [("original", result.original), ("corrected", result.corrected), ("enhanced", result.enhanced)]:
        (docs / f"preprocessing_{name}.png").write_bytes(png_bytes(rgb))
    sheet = Image.new("RGB", (1500, 565), "#f0f3f8")
    draw = ImageDraw.Draw(sheet)
    draw.text((20, 12), "SYNTHETIC TEST ONLY / No real student data / No accuracy claim", fill="#23334a", font=font(23))
    for i, (label, rgb) in enumerate([("Original", result.original), ("Perspective corrected", result.corrected), ("Enhanced (not detail recovery)", result.enhanced)]):
        panel = Image.fromarray(rgb)
        panel.thumbnail((480, 440), Image.Resampling.LANCZOS)
        sheet.paste(panel, (10 + i * 500 + (480-panel.width)//2, 90 + (440-panel.height)//2))
        draw.text((20+i*500, 58), label, fill="#23334a", font=font(21))
    draw.text((20, 535), "Original bytes retained; fine-line retention is a heuristic, not a correctness guarantee.", fill="#23334a", font=font(18))
    sheet.save(docs / "preprocessing_comparison.png")
    print(f"Mock example validated; total={report.total_score}; needs_manual_review={report.needs_manual_review}")
    print(f"Synthetic photo perspective={result.quality.perspective_status}; original retained.")


if __name__ == "__main__":
    main()
