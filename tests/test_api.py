import json
from base64 import b64decode
from io import BytesIO

import httpx
import numpy as np
import pytest
from PIL import Image
from pydantic import SecretStr

from src.ai.client import AIError, ModelReply, OpenAICompatibleClient, parse_response
from src.ai.images import encode_for_api, image_content
from src.schemas.models import AnalysisResult
from src.utils.config import Settings


def api_settings(**overrides):
    return Settings(api_key=SecretStr("offline-test-placeholder"), model="offline-test-vision", max_retries=0, **overrides)


def test_request_has_roles_correct_mime_and_size(assets):
    cfg = api_settings()
    content, manifest = image_content(assets, cfg, "both")
    labels = [item["text"] for item in content if item["type"] == "text"]
    assert any("role=reference" in label for label in labels)
    assert any("role=student" in label for label in labels)
    assert len(manifest) == 6
    for item in [x for x in content if x["type"] == "image_url"]:
        header, encoded = item["image_url"]["url"].split(",", 1)
        data = b64decode(encoded)
        image = Image.open(BytesIO(data))
        assert header == "data:image/" + ("png" if image.format == "PNG" else "jpeg") + ";base64"
        assert max(image.size) <= cfg.max_image_side
        assert len(data) <= cfg.max_image_bytes


def test_jpeg_compression_budget():
    rgb = np.random.default_rng(11).integers(0, 256, (1000, 1000, 3), dtype=np.uint8)
    cfg = Settings(max_image_bytes=150000)
    data, mime, size = encode_for_api(rgb, cfg)
    assert mime == "image/jpeg"
    assert Image.open(BytesIO(data)).format == "JPEG"
    assert len(data) <= cfg.max_image_bytes and max(size) <= 1600


def test_complete_real_adapter_with_transport_fixture(analysis_data):
    def handler(request):
        assert str(request.url) == "https://api.openai.com/v1/chat/completions"
        payload = json.loads(request.content)
        assert payload["response_format"]["type"] == "json_schema"
        assert payload["model"] == "offline-test-vision"
        return httpx.Response(200, json={"id": "test-request", "choices": [{"message": {"content": json.dumps(analysis_data)}, "finish_reason": "stop"}], "usage": {"prompt_tokens": 10, "nested": {}}})
    client = OpenAICompatibleClient(api_settings(response_format="json_schema"), httpx.MockTransport(handler))
    reply = client.complete("question_analysis", [], AnalysisResult.model_json_schema())
    assert reply.request_id == "test-request"
    assert reply.usage == {"prompt_tokens": 10}
    assert parse_response(reply, AnalysisResult).rubric[0].max_score == 4.0


@pytest.mark.parametrize("code", [400, 401, 403, 429, 500, 503])
def test_http_errors_never_return_scores(code):
    client = OpenAICompatibleClient(api_settings(), httpx.MockTransport(lambda request: httpx.Response(code, text="provider failure")))
    with pytest.raises(AIError, match=f"HTTP {code}"):
        client.complete("student_evaluation", [], {})


def test_timeout_never_returns_scores():
    def handler(request):
        raise httpx.ReadTimeout("test timeout", request=request)
    client = OpenAICompatibleClient(api_settings(), httpx.MockTransport(handler))
    with pytest.raises(AIError, match="超时失败"):
        client.complete("student_evaluation", [], {})


def test_retry_transient_error_then_success(monkeypatch):
    calls = []
    def handler(request):
        calls.append(request)
        return httpx.Response(503) if len(calls) == 1 else httpx.Response(200, json={"choices": [{"message": {"content": "{}"}}]})
    monkeypatch.setattr("src.ai.client.time.sleep", lambda seconds: None)
    cfg = Settings(api_key=SecretStr("offline-placeholder"), model="test", max_retries=2)
    assert OpenAICompatibleClient(cfg, httpx.MockTransport(handler)).complete("test", [], {}).raw == "{}"
    assert len(calls) == 2


def test_invalid_json_keeps_raw_response():
    raw = '{"broken":'
    with pytest.raises(AIError) as exc:
        parse_response(ModelReply(raw), AnalysisResult)
    assert exc.value.raw_response == raw


@pytest.mark.parametrize("body", [{}, {"choices": []}, {"choices": [{"message": {"content": None}}]}])
def test_incompatible_response_preserved(body):
    client = OpenAICompatibleClient(api_settings(), httpx.MockTransport(lambda request: httpx.Response(200, json=body)))
    with pytest.raises(AIError) as exc:
        client.complete("test", [], {})
    assert exc.value.raw_response is not None


def test_truncated_response_preserved():
    body = {"choices": [{"message": {"content": '{"cut":'}, "finish_reason": "length"}]}
    client = OpenAICompatibleClient(api_settings(), httpx.MockTransport(lambda request: httpx.Response(200, json=body)))
    with pytest.raises(AIError, match="截断") as exc:
        client.complete("test", [], {})
    assert exc.value.raw_response == '{"cut":'


def test_missing_configuration_and_request_budget():
    with pytest.raises(AIError, match="缺少 API 配置"):
        OpenAICompatibleClient(Settings()).complete("test", [], {})
    cfg = api_settings(max_request_bytes=1000000)
    with pytest.raises(AIError, match="完整请求超过"):
        OpenAICompatibleClient(cfg).complete("test", [{"content": "x"*1000000}], {})


def test_api_key_repr_is_redacted():
    cfg = api_settings()
    assert "offline-test-placeholder" not in repr(cfg)


def test_compatible_api_allows_null_usage():
    body = {"id": "nullable-usage", "choices": [{"message": {"content": "{}"}}], "usage": None}
    client = OpenAICompatibleClient(api_settings(), httpx.MockTransport(lambda request: httpx.Response(200, json=body)))
    reply = client.complete("test", [], {})
    assert reply.usage == {} and reply.request_id == "nullable-usage"


@pytest.mark.parametrize("body", [[], {"choices": [None]}, {"choices": [{"message": 3}]}])
def test_malformed_compatible_response_is_reported(body):
    client = OpenAICompatibleClient(api_settings(), httpx.MockTransport(lambda request: httpx.Response(200, json=body)))
    with pytest.raises(AIError, match="格式不兼容") as exc:
        client.complete("test", [], {})
    assert exc.value.raw_response is not None
