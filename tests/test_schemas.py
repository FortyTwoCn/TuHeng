import copy
import json

import jsonschema
import pytest
from pydantic import ValidationError

from src.schemas.models import AnalysisResult, GradingReport, StudentEvaluation


def test_json_schema_and_round_trip(mock_report):
    payload = json.loads(mock_report.model_dump_json())
    schema = GradingReport.model_json_schema()
    jsonschema.Draft202012Validator.check_schema(schema)
    jsonschema.validate(payload, schema)
    assert GradingReport.model_validate_json(json.dumps(payload)).total_score == 5.5
    assert payload["needs_manual_review"] is True
    assert payload["model_metadata"]["is_mock"] is True


def test_rubric_sum_must_equal_ten(analysis_data):
    analysis_data["rubric"][0]["max_score"] = 3.5
    with pytest.raises(ValidationError, match="严格等于 10"):
        AnalysisResult.model_validate(analysis_data)


@pytest.mark.parametrize("score", [-0.5, 10.5, 1.1, "2", True])
def test_invalid_score_range_type_and_step(evaluation_data, score):
    evaluation_data["rubric_scores"][0]["score"] = score
    with pytest.raises(ValidationError):
        StudentEvaluation.model_validate(evaluation_data)


def test_item_score_cannot_exceed_max(evaluation_data):
    evaluation_data["rubric_scores"][0]["score"] = 4.5
    with pytest.raises(ValidationError, match="不得超过满分"):
        StudentEvaluation.model_validate(evaluation_data)


def test_total_is_recomputable(evaluation_data):
    valid = StudentEvaluation.model_validate(evaluation_data)
    assert sum(s.score for s in valid.rubric_scores) == valid.total_score
    evaluation_data["total_score"] = 6.0
    with pytest.raises(ValidationError, match="总分必须等于"):
        StudentEvaluation.model_validate(evaluation_data)


def test_null_total_required_if_any_item_unknown(evaluation_data):
    score = evaluation_data["rubric_scores"][0]
    score.update(score=None, status="无法识别")
    with pytest.raises(ValidationError, match="总分必须为 null"):
        StudentEvaluation.model_validate(evaluation_data)
    evaluation_data["total_score"] = None
    assert StudentEvaluation.model_validate(evaluation_data).total_score is None


def test_unrecognized_cannot_be_scored_zero(evaluation_data):
    evaluation_data["rubric_scores"][0].update(score=0.0, status="无法识别")
    with pytest.raises(ValidationError, match="null 得分"):
        StudentEvaluation.model_validate(evaluation_data)


def test_extra_fields_forbidden(evaluation_data):
    evaluation_data["fake_score"] = 10
    with pytest.raises(ValidationError):
        StudentEvaluation.model_validate(evaluation_data)


@pytest.mark.parametrize("mutation", ["missing_rubric", "changed_max", "duplicate_kp", "missing_kp", "bad_name", "unknown_mistake"])
def test_report_rejects_cross_reference_errors(mock_report, mutation):
    payload = copy.deepcopy(mock_report.model_dump())
    if mutation == "missing_rubric":
        payload["rubric_scores"].pop()
        payload["total_score"] = 4.0
    elif mutation == "changed_max":
        payload["rubric_scores"][0]["max_score"] = 5.0
    elif mutation == "duplicate_kp":
        payload["knowledge_assessments"].append(payload["knowledge_assessments"][0])
    elif mutation == "missing_kp":
        payload["knowledge_assessments"].pop()
    elif mutation == "bad_name":
        payload["knowledge_assessments"][0]["name"] = "错误名称"
    else:
        payload["mistakes"][0]["rubric_id"] = "R99"
    with pytest.raises(ValidationError):
        GradingReport.model_validate(payload)


def test_insufficient_knowledge_evidence_must_not_get_number(evaluation_data):
    evaluation_data["knowledge_assessments"][0]["status"] = "证据不足"
    with pytest.raises(ValidationError, match="知识点评分必须为 null"):
        StudentEvaluation.model_validate(evaluation_data)
