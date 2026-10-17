"""Closed, strict schemas. Arithmetic and semantic invariants run server-side."""
from datetime import datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Text = Annotated[str, Field(min_length=1, max_length=12000)]
Confidence = Annotated[float, Field(ge=0, le=1)]
HalfScore = Annotated[float, Field(ge=0, le=10, multiple_of=0.5)]
Points = Annotated[float, Field(gt=0, le=10, multiple_of=0.5)]
KnowledgeID = Annotated[str, Field(pattern=r"^DG-[A-Z0-9-]+$")]


def add_scores(values) -> Decimal:
    return sum((Decimal(str(v)) for v in values), Decimal(0))


def unique(values, name):
    if len(values) != len(set(values)):
        raise ValueError(f"{name} 不得重复")


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, str_strip_whitespace=True)


class KnowledgePoint(StrictModel):
    knowledge_id: KnowledgeID
    name: Text
    description: Text


class QuestionAnalysis(StrictModel):
    summary: Text
    question_type: Text
    tasks: Annotated[list[Text], Field(min_length=1)]
    key_relationships: list[Text]
    construction_steps: list[Text]
    required_results: list[Text]
    acceptable_alternatives: list[Text]
    uncertainties: list[Text]
    teacher_rules_used: bool


class RubricItem(StrictModel):
    rubric_id: Annotated[str, Field(pattern=r"^R[0-9]+$")]
    criterion: Text
    max_score: Points
    knowledge_ids: Annotated[list[KnowledgeID], Field(min_length=1)]
    evidence_required: Text


class AnalysisResult(StrictModel):
    question_analysis: QuestionAnalysis
    knowledge_points: Annotated[list[KnowledgePoint], Field(min_length=1)]
    rubric: Annotated[list[RubricItem], Field(min_length=1)]

    @model_validator(mode="after")
    def consistent_analysis(self):
        unique([x.knowledge_id for x in self.knowledge_points], "知识点 ID")
        unique([x.rubric_id for x in self.rubric], "评分项 ID")
        if add_scores(x.max_score for x in self.rubric) != Decimal(10):
            raise ValueError("评分项满分之和必须严格等于 10")
        known = {x.knowledge_id for x in self.knowledge_points}
        for item in self.rubric:
            unique(item.knowledge_ids, "评分项知识点 ID")
            if not set(item.knowledge_ids) <= known:
                raise ValueError("评分项引用了未定义的知识点")
        if known != {k for r in self.rubric for k in r.knowledge_ids}:
            raise ValueError("每个知识点必须关联至少一个评分项")
        return self


class RubricScore(StrictModel):
    rubric_id: str
    score: HalfScore | None
    max_score: Points
    evidence: Text
    confidence: Confidence
    status: Literal["正确", "部分正确", "错误", "无法识别", "待复核"]

    @model_validator(mode="after")
    def valid_score(self):
        if self.score is not None and self.score > self.max_score:
            raise ValueError("单项得分不得超过满分")
        if self.status in {"无法识别", "待复核"} and self.score is not None:
            raise ValueError("无法识别或证据待复核项必须使用 null 得分")
        if self.score is None and self.status not in {"无法识别", "待复核"}:
            raise ValueError("null 得分必须说明无法识别或待复核")
        if self.status == "正确" and self.score != self.max_score:
            raise ValueError("正确项必须获得该项满分")
        return self


class Mistake(StrictModel):
    rubric_id: str
    category: Literal["知识性错误", "作图规范错误", "图片模糊", "无法识别"]
    description: Text
    reason: Text
    correction_steps: Annotated[list[Text], Field(min_length=1)]


class KnowledgeAssessment(StrictModel):
    knowledge_id: KnowledgeID
    name: Text
    score: Annotated[float, Field(ge=0, le=100)] | None
    evidence: Annotated[list[Text], Field(min_length=1)]
    weaknesses: list[Text]
    suggestions: Annotated[list[Text], Field(min_length=1)]
    confidence: Confidence
    status: Literal["掌握良好", "基本掌握", "需要加强", "证据不足"]

    @model_validator(mode="after")
    def evidence_or_null(self):
        if (self.status == "证据不足") != (self.score is None):
            raise ValueError("证据不足时知识点评分必须为 null；其余状态必须有评分")
        return self


class StudentEvaluation(StrictModel):
    rubric_scores: Annotated[list[RubricScore], Field(min_length=1)]
    total_score: HalfScore | None
    correct_parts: list[Text]
    mistakes: list[Mistake]
    correction_guidance: list[Text]
    knowledge_assessments: Annotated[list[KnowledgeAssessment], Field(min_length=1)]
    confidence: Confidence
    review_reasons: Annotated[list[Text], Field(min_length=1)]

    @model_validator(mode="after")
    def recomputable_total(self):
        unique([x.rubric_id for x in self.rubric_scores], "评分结果 ID")
        if any(x.score is None for x in self.rubric_scores):
            if self.total_score is not None:
                raise ValueError("存在无法判定的评分项，总分必须为 null")
        elif self.total_score is None or add_scores(x.score for x in self.rubric_scores) != Decimal(str(self.total_score)):
            raise ValueError("总分必须等于所有评分项得分之和")
        return self


class ImageQuality(StrictModel):
    image_id: str
    role: Literal["question", "reference", "student"]
    source_sha256: str
    original_width: int
    original_height: int
    processed_width: int
    processed_height: int
    sharpness_reference: float
    mean_brightness: float
    perspective_status: str
    failure_reason: str | None
    orientation_status: str
    thin_line_retention_reference: float
    warnings: list[str]
    logs: list[str]


class ModelMetadata(StrictModel):
    provider: str
    model: str
    is_mock: bool
    stage_a_request_id: str | None
    stage_b_request_id: str | None
    stage_a_usage: dict[str, int]
    stage_b_usage: dict[str, int]
    input_manifest: list[dict[str, str | int]]
    duration_seconds: float
    rubric_sha256: str
    teacher_confirmed_at: datetime
    schema_version: Literal["0.1"]


class GradingReport(AnalysisResult, StudentEvaluation):
    submission_id: str
    max_score: Literal[10]
    needs_manual_review: Literal[True]
    image_quality: list[ImageQuality]
    model_metadata: ModelMetadata
    created_at: datetime

    @model_validator(mode="after")
    def references_match(self):
        rubric = {r.rubric_id: r for r in self.rubric}
        if set(rubric) != {s.rubric_id for s in self.rubric_scores}:
            raise ValueError("评分结果必须与确认的评分项一一对应")
        for score in self.rubric_scores:
            if score.max_score != rubric[score.rubric_id].max_score:
                raise ValueError("模型不得修改确认的评分项满分")
        kp = {k.knowledge_id: k.name for k in self.knowledge_points}
        unique([k.knowledge_id for k in self.knowledge_assessments], "知识点评估 ID")
        if set(kp) != {k.knowledge_id for k in self.knowledge_assessments}:
            raise ValueError("每个知识点必须有且仅有一条局部评估")
        for assessment in self.knowledge_assessments:
            if kp[assessment.knowledge_id] != assessment.name:
                raise ValueError("知识点 ID 与名称不一致")
        if any(m.rubric_id not in rubric for m in self.mistakes):
            raise ValueError("错误诊断引用未知评分项")
        return self
