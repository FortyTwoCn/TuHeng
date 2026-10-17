import json

import httpx
import pytest
from pydantic import SecretStr

from src.ai.client import AIError, OpenAICompatibleClient
from src.ai.mock import MockVisionClient
from src.grading.service import GradingService, TeacherInputs, confirm_analysis
from src.reporting.export import json_report, markdown_report
from src.schemas.models import GradingReport
from src.utils.audit import AuditTrail
from src.utils.config import Settings


def test_two_stage_pipeline_no_paid_api(settings, assets, tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    client = MockVisionClient()
    audit = AuditTrail(settings)
    service = GradingService(settings, client, audit)
    analysis, reply, _ = service.analyze(assets, TeacherInputs())
    confirmed = confirm_analysis(analysis.model_dump_json())
    report = service.grade(assets, TeacherInputs(), confirmed, reply)
    assert report.total_score == 5.5
    assert report.model_metadata.is_mock and report.needs_manual_review
    assert report.model_metadata.rubric_sha256 == confirmed.digest
    assert all("role=student" not in json.dumps(c, ensure_ascii=False) for c in client.calls[0]["messages"])
    stage_b = json.dumps(client.calls[1]["messages"], ensure_ascii=False)
    assert all("role="+role in stage_b for role in ["question", "reference", "student"])
    assert len(audit.records) == 2 and not list(tmp_path.iterdir())
    assert "base64" not in json.dumps(audit.records)


def test_openai_wire_two_stages_without_network(settings, assets, analysis_data, evaluation_data):
    calls = []
    def handler(request):
        payload = json.loads(request.content)
        assert any(x.get("type") == "image_url" for x in payload["messages"][1]["content"])
        raw = analysis_data if len(calls) == 0 else evaluation_data
        calls.append(payload)
        return httpx.Response(200, json={"id": f"wire-{len(calls)}", "choices": [{"message": {"content": json.dumps(raw, ensure_ascii=False)}, "finish_reason": "stop"}]})
    cfg = Settings(api_key=SecretStr("offline-placeholder"), model="wire-test", max_retries=0)
    client = OpenAICompatibleClient(cfg, httpx.MockTransport(handler))
    service = GradingService(cfg, client)
    analysis, reply, _ = service.analyze(assets, TeacherInputs())
    report = service.grade(assets, TeacherInputs(), confirm_analysis(analysis.model_dump_json()), reply)
    # This adapter is the production code path, but the HTTP response is controlled.
    assert report.total_score == 5.5 and len(calls) == 2
    assert report.model_metadata.stage_b_request_id == "wire-2"


def test_unrecognizable_yields_null_not_zero(settings, assets):
    service = GradingService(settings, MockVisionClient("unrecognizable"))
    analysis, reply, _ = service.analyze(assets, TeacherInputs())
    report = service.grade(assets, TeacherInputs(), confirm_analysis(analysis.model_dump_json()), reply)
    assert report.total_score is None
    assert all(s.score is None for s in report.rubric_scores)
    assert all(k.score is None and k.status == "证据不足" for k in report.knowledge_assessments)
    assert report.needs_manual_review


@pytest.mark.parametrize("missing_role", ["question", "reference", "student"])
def test_missing_images(settings, assets, analysis_data, missing_role):
    selected = [a for a in assets if a.role != missing_role]
    service = GradingService(settings, MockVisionClient())
    confirmed = confirm_analysis(json.dumps(analysis_data, ensure_ascii=False))
    from src.ai.client import ModelReply
    with pytest.raises(ValueError, match="缺少图片"):
        service.grade(selected, TeacherInputs(), confirmed, ModelReply("{}"))


@pytest.mark.parametrize("scenario", ["api_error", "invalid_json"])
def test_failures_are_explicit_and_audited(settings, assets, scenario):
    service = GradingService(settings, MockVisionClient(scenario))
    with pytest.raises(AIError):
        service.analyze(assets, TeacherInputs())
    assert service.audit.records[-1]["error"]
    if scenario == "invalid_json":
        assert service.audit.records[-1]["raw_response"] == '{"broken":'


def test_teacher_rules_cannot_be_silently_ignored(settings, assets):
    service = GradingService(settings, MockVisionClient())
    with pytest.raises(AIError, match="教师提供了评分细则"):
        service.analyze(assets, TeacherInputs(teacher_rubric="对应关系占 6 分，其他占 4 分"))


def test_model_cannot_change_confirmed_rubric(settings, assets, analysis_data, evaluation_data):
    evaluation_data["rubric_scores"][0]["max_score"] = 5.0
    client = MockVisionClient(responses={"question_analysis": json.dumps(analysis_data), "student_evaluation": json.dumps(evaluation_data)})
    service = GradingService(settings, client)
    analysis, reply, _ = service.analyze(assets, TeacherInputs())
    with pytest.raises(AIError, match="修改确认的评分项满分"):
        service.grade(assets, TeacherInputs(), confirm_analysis(analysis.model_dump_json()), reply)
    assert service.audit.records[-1]["stage"] == "report_validation"


def test_report_exports_are_complete(mock_report):
    data = json_report(mock_report)
    parsed = GradingReport.model_validate_json(data)
    markdown = markdown_report(parsed)
    assert "MOCK" in markdown and "待教师复核" in markdown and "长期" in markdown
    assert "5.5 / 10" in markdown
    assert all(k.knowledge_id in markdown for k in parsed.knowledge_assessments)
    assert "schema_version" in markdown


def test_persistence_is_opt_in_and_excludes_images(tmp_path, assets):
    cfg = Settings(persist_local_logs=True, local_log_dir=str(tmp_path))
    service = GradingService(cfg, MockVisionClient())
    service.analyze(assets, TeacherInputs())
    records = list(tmp_path.glob("*.json"))
    assert len(records) == 1
    text = records[0].read_text(encoding="utf-8")
    assert "raw_response" in text and "sha256" in text
    assert "base64" not in text and "api_key" not in text
