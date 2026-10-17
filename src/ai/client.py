"""OpenAI-compatible Chat Completions, with no automatic fake fallback."""
import json
import time
from dataclasses import dataclass, field
from typing import Protocol

import httpx
from pydantic import BaseModel, ValidationError

from src.utils.config import Settings


class AIError(RuntimeError):
    def __init__(self, message: str, raw_response: str | None = None):
        super().__init__(message)
        self.raw_response = raw_response


@dataclass
class ModelReply:
    raw: str
    request_id: str | None = None
    usage: dict[str, int] = field(default_factory=dict)


class VisionClient(Protocol):
    is_mock: bool
    model: str

    def complete(self, stage: str, messages: list[dict], schema: dict) -> ModelReply: ...


def parse_response(reply: ModelReply, model_type: type[BaseModel]):
    raw = reply.raw.strip()
    if raw.startswith("```json") and raw.endswith("```"):
        raw = raw[7:-3].strip()
    try:
        return model_type.model_validate_json(raw)
    except (ValidationError, ValueError) as exc:
        raise AIError(f"模型 JSON/Schema/业务校验失败：{exc}", raw_response=reply.raw) from exc


class OpenAICompatibleClient:
    is_mock = False

    def __init__(self, settings: Settings, transport: httpx.BaseTransport | None = None):
        self.settings = settings
        self.model = settings.model
        self.transport = transport

    def complete(self, stage, messages, schema):
        cfg = self.settings
        if cfg.missing:
            raise AIError("缺少 API 配置：" + "、".join(cfg.missing))
        payload = {"model": cfg.model, "messages": messages, "max_tokens": cfg.max_output_tokens}
        if cfg.response_format == "json_schema":
            payload["response_format"] = {"type": "json_schema", "json_schema": {
                "name": stage, "strict": True, "schema": schema}}
        elif cfg.response_format == "json_object":
            payload["response_format"] = {"type": "json_object"}
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        if len(encoded) > cfg.max_request_bytes:
            raise AIError("完整请求超过 AI_MAX_REQUEST_BYTES，请减少图像或文本")
        headers = {"Authorization": "Bearer " + cfg.api_key.get_secret_value(), "Content-Type": "application/json"}
        with httpx.Client(timeout=cfg.timeout_seconds, transport=self.transport, follow_redirects=False) as client:
            for attempt in range(cfg.max_retries + 1):
                try:
                    response = client.post(cfg.base_url + "/chat/completions", content=encoded, headers=headers)
                    if response.status_code in {408, 429, 500, 502, 503, 504} and attempt < cfg.max_retries:
                        time.sleep(min(2**attempt, 4))
                        continue
                    if not response.is_success:
                        # Do not expose headers, credentials, or provider echo bodies.
                        raise AIError(f"API HTTP {response.status_code}；检查网络、配额、模型视觉能力和结构化输出设置。未生成分数。")
                    try:
                        body = response.json()
                        choice = body["choices"][0]
                        message = choice["message"]
                        raw = message.get("content")
                        if not isinstance(raw, str) or not raw.strip():
                            raise ValueError("模型返回空内容或拒绝回答")
                        if choice.get("finish_reason") == "length":
                            raise AIError("模型输出被 token 上限截断，请提高上限后重新生成", raw)
                        usage_body = body.get("usage") or {}
                        usage = {k: v for k, v in usage_body.items()
                                 if isinstance(v, int) and not isinstance(v, bool)}
                        request_id = response.headers.get("x-request-id") or body.get("id")
                        return ModelReply(raw, request_id if isinstance(request_id, str) else None, usage)
                    except (KeyError, TypeError, ValueError, IndexError, AttributeError) as exc:
                        raise AIError("API 返回格式不兼容或内容为空", response.text) from exc
                except (httpx.TimeoutException, httpx.NetworkError, httpx.RemoteProtocolError) as exc:
                    if attempt >= cfg.max_retries:
                        raise AIError(f"API 网络/超时失败（{type(exc).__name__}）；未生成分数") from exc
                    time.sleep(min(2**attempt, 4))
        raise AIError("API 未返回有效响应")
