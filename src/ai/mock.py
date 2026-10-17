"""Explicit opt-in canned responses for offline plumbing tests only."""
import copy
import json
from pathlib import Path

from src.ai.client import AIError, ModelReply

SAMPLE_DIR = Path(__file__).resolve().parents[2] / "sample_data"


class MockVisionClient:
    is_mock = True
    model = "MOCK-FIXTURE-NO-VISUAL-INFERENCE"

    def __init__(self, scenario="normal", responses: dict[str, str] | None = None):
        self.scenario, self.responses = scenario, responses
        self.calls = []

    def complete(self, stage, messages, schema):
        self.calls.append({"stage": stage, "messages": messages})
        if self.responses is not None:
            return ModelReply(self.responses[stage], "mock-explicit-test-response")
        if self.scenario == "api_error":
            raise AIError("MOCK 模拟 API HTTP 503；未执行网络请求")
        if self.scenario == "invalid_json":
            return ModelReply('{"broken":', "mock-invalid-json")
        filename = "mock_analysis.json" if stage == "question_analysis" else "mock_evaluation.json"
        payload = json.loads((SAMPLE_DIR / filename).read_text(encoding="utf-8"))
        if stage == "student_evaluation" and self.scenario == "unrecognizable":
            payload = copy.deepcopy(payload)
            for score in payload["rubric_scores"]:
                score.update(score=None, status="无法识别", confidence=0.1,
                             evidence="MOCK：模拟模糊遮挡，无法辨认学生图线")
            for assessment in payload["knowledge_assessments"]:
                assessment.update(score=None, status="证据不足", confidence=0.1,
                                  evidence=["MOCK：无法辨认，不能判断知识掌握情况"], weaknesses=[],
                                  suggestions=["重新拍摄，保留所有投影点和辅助线"])
            payload.update(total_score=None, correct_parts=[], mistakes=[], confidence=0.1,
                           correction_guidance=["MOCK：请补充清晰原图，再由教师复核"],
                           review_reasons=["MOCK：图片不可辨认；分数为 null"])
        return ModelReply(json.dumps(payload, ensure_ascii=False), "mock-fixed-" + stage, {})
