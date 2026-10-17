import json
from pathlib import Path

import pytest

from src.ai.mock import MockVisionClient
from src.grading.service import GradingService, TeacherInputs, confirm_analysis
from src.preprocessing.pipeline import PreprocessOptions, process_image
from src.utils.config import Settings

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def settings():
    return Settings()


@pytest.fixture
def analysis_data():
    return json.loads((ROOT / "sample_data/mock_analysis.json").read_text(encoding="utf-8"))


@pytest.fixture
def evaluation_data():
    return json.loads((ROOT / "sample_data/mock_evaluation.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="session")
def assets():
    return [process_image((ROOT / f"sample_data/{role}.png").read_bytes(), role, role+"-1",
                          PreprocessOptions(auto_deskew=False)) for role in ["question", "reference", "student"]]


@pytest.fixture
def mock_report(settings, assets):
    service = GradingService(settings, MockVisionClient())
    analysis, reply, _ = service.analyze(assets, TeacherInputs())
    return service.grade(assets, TeacherInputs(), confirm_analysis(analysis.model_dump_json()), reply)
