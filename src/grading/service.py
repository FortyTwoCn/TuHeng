import json
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from hashlib import sha256
from uuid import uuid4

from src.ai.client import AIError, ModelReply, VisionClient, parse_response
from src.ai.images import image_content
from src.ai.prompts import COMMON, KNOWLEDGE_CATALOG, STAGE_A, STAGE_B
from src.preprocessing.pipeline import ImageAsset
from src.schemas.models import AnalysisResult, GradingReport, ModelMetadata, StudentEvaluation
from src.utils.audit import AuditTrail
from src.utils.config import Settings


@dataclass(frozen=True)
class TeacherInputs:
    question_text: str = ""
    answer_notes: str = ""
    teacher_rubric: str = ""


@dataclass(frozen=True)
class ConfirmedAnalysis:
    analysis_json: str
    confirmed_at: datetime
    digest: str


def confirm_analysis(analysis_json: str):
    parsed = AnalysisResult.model_validate_json(analysis_json)
    canonical = parsed.model_dump_json()
    return ConfirmedAnalysis(canonical, datetime.now(timezone.utc), sha256(canonical.encode()).hexdigest())


def validate_images(assets: list[ImageAsset], require_student: bool):
    for role in ("question", "reference", "student") if require_student else ("question", "reference"):
        selected = [a for a in assets if a.role == role]
        if not selected:
            raise ValueError(f"缺少图片：{role}。题目、标准答案和学生作答必须独立上传。")
        if len(selected) > 6:
            raise ValueError(f"{role} 最多支持 6 张图片，请分批测试")
    unique_ids = [a.image_id for a in assets]
    if len(set(unique_ids)) != len(unique_ids):
        raise ValueError("image_id 不得重复")


class GradingService:
    def __init__(self, settings: Settings, client: VisionClient, audit: AuditTrail | None = None):
        self.settings, self.client = settings, client
        self.audit = audit or AuditTrail(settings)

    def _call(self, stage, model_type, prompt, payload, assets, variants):
        content, manifest = image_content(assets, self.settings, variants)
        user_text = json.dumps(payload, ensure_ascii=False)
        if len(user_text) > 80000:
            raise ValueError("补充文字或评分细则过长，请限制在 8 万字符以内")
        schema = model_type.model_json_schema()
        messages = [
            {"role": "system", "content": COMMON + prompt + "\nJSON Schema:\n" + json.dumps(schema, ensure_ascii=False)},
            {"role": "user", "content": [{"type": "text", "text": user_text}] + content},
        ]
        reply = None
        try:
            reply = self.client.complete(stage, messages, schema)
            result = parse_response(reply, model_type)
            self.audit.record(stage, manifest, reply.raw)
            return result, reply, manifest
        except AIError as exc:
            self.audit.record(stage, manifest, exc.raw_response or (reply.raw if reply else None), str(exc))
            raise

    def analyze(self, assets, inputs: TeacherInputs, variants="both"):
        validate_images(assets, False)
        selected = [a for a in assets if a.role in {"question", "reference"}]
        result, reply, manifest = self._call("question_analysis", AnalysisResult, STAGE_A,
            {"teacher_material": inputs.__dict__, "knowledge_catalog": KNOWLEDGE_CATALOG}, selected, variants)
        if inputs.teacher_rubric.strip() and not result.question_analysis.teacher_rules_used:
            raise AIError("教师提供了评分细则，但模型未声明采用。请重新生成或人工编辑后确认。", reply.raw)
        for point in result.knowledge_points:
            if KNOWLEDGE_CATALOG.get(point.knowledge_id) != point.name:
                raise AIError("模型使用了目录之外的知识点 ID 或不一致名称；请重新生成", reply.raw)
        return result, reply, manifest

    def grade(self, assets, inputs: TeacherInputs, confirmed: ConfirmedAnalysis,
              stage_a_reply: ModelReply, variants="both", submission_id: str | None = None):
        validate_images(assets, True)
        analysis = AnalysisResult.model_validate_json(confirmed.analysis_json)
        if sha256(analysis.model_dump_json().encode()).hexdigest() != confirmed.digest:
            raise ValueError("已确认细则摘要校验失败，请重新确认")
        started = time.monotonic()
        result, reply, manifest = self._call("student_evaluation", StudentEvaluation, STAGE_B,
            {"teacher_material": inputs.__dict__, "confirmed_analysis": analysis.model_dump(mode="json"),
             "image_quality": [a.quality.model_dump() for a in assets]}, assets, variants)
        payload = {**analysis.model_dump(), **result.model_dump(), "submission_id": submission_id or uuid4().hex,
            "max_score": 10, "needs_manual_review": True, "image_quality": [a.quality for a in assets],
            "model_metadata": ModelMetadata(
                provider="MOCK / 固定响应 / 非真实推理" if self.client.is_mock else self.settings.base_url,
                model=self.client.model, is_mock=self.client.is_mock,
                stage_a_request_id=stage_a_reply.request_id, stage_b_request_id=reply.request_id,
                stage_a_usage=stage_a_reply.usage, stage_b_usage=reply.usage, input_manifest=manifest,
                duration_seconds=round(time.monotonic() - started, 3), rubric_sha256=confirmed.digest,
                teacher_confirmed_at=confirmed.confirmed_at, schema_version="0.1"),
            "created_at": datetime.now(timezone.utc)}
        reasons = payload["review_reasons"]
        reasons.append("AI 建议，待教师复核；单次作业仅反映本题局部表现，不代表长期掌握度")
        if self.client.is_mock:
            reasons.append("MOCK 固定样例：未执行视觉推理，不代表上传图片的实际表现")
        reference_hashes = {sha256(a.source_bytes).hexdigest() for a in assets if a.role == "reference"}
        if any(sha256(a.source_bytes).hexdigest() in reference_hashes for a in assets if a.role == "student"):
            reasons.append("学生图片与参考答案存在完全相同文件，请核对上传角色")
        try:
            return GradingReport.model_validate(payload)
        except ValueError as exc:
            self.audit.record("report_validation", manifest, reply.raw, str(exc))
            raise AIError(f"批改报告交叉校验失败：{exc}", reply.raw) from exc
