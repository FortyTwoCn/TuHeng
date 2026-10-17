import os
from pathlib import Path
from urllib.parse import urlsplit

from dotenv import load_dotenv
from pydantic import Field, SecretStr, field_validator

from src.schemas.models import StrictModel


class Settings(StrictModel):
    base_url: str = "https://api.openai.com/v1"
    api_key: SecretStr = SecretStr("")
    model: str = ""
    timeout_seconds: float = Field(default=120.0, ge=1, le=600)
    max_retries: int = Field(default=2, ge=0, le=5)
    response_format: str = "json_object"
    max_output_tokens: int = Field(default=6000, ge=500, le=32000)
    max_image_side: int = Field(default=1600, ge=512, le=4096)
    max_image_bytes: int = Field(default=1500000, ge=100000, le=10000000)
    max_request_bytes: int = Field(default=18000000, ge=1000000, le=50000000)
    persist_local_logs: bool = False
    local_log_dir: str = "artifacts"

    @field_validator("base_url")
    @classmethod
    def valid_url(cls, value):
        parts = urlsplit(value)
        if parts.scheme not in {"http", "https"} or not parts.netloc or parts.username or parts.password:
            raise ValueError("base_url 必须是无内嵌凭据的 HTTP(S) URL")
        if parts.query or parts.fragment:
            raise ValueError("base_url 不可包含查询参数或片段")
        return value.rstrip("/")

    @field_validator("response_format")
    @classmethod
    def valid_format(cls, value):
        if value not in {"json_schema", "json_object", "none"}:
            raise ValueError("AI_RESPONSE_FORMAT 应为 json_schema、json_object 或 none")
        return value

    @property
    def missing(self):
        return [name for name, value in [("OPENAI_BASE_URL", self.base_url), ("OPENAI_API_KEY", self.api_key.get_secret_value()), ("OPENAI_MODEL", self.model)] if not value.strip()]

    @classmethod
    def from_env(cls, env_file: Path | None = None):
        load_dotenv(env_file or Path.cwd() / ".env", override=False)
        return cls(
            base_url=os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1"),
            api_key=SecretStr(os.getenv("OPENAI_API_KEY", "")), model=os.getenv("OPENAI_MODEL", ""),
            timeout_seconds=float(os.getenv("AI_TIMEOUT_SECONDS", "120")),
            max_retries=int(os.getenv("AI_MAX_RETRIES", "2")),
            response_format=os.getenv("AI_RESPONSE_FORMAT", "json_object"),
            max_output_tokens=int(os.getenv("AI_MAX_OUTPUT_TOKENS", "6000")),
            max_image_side=int(os.getenv("AI_MAX_IMAGE_SIDE", "1600")),
            max_image_bytes=int(os.getenv("AI_MAX_IMAGE_BYTES", "1500000")),
            max_request_bytes=int(os.getenv("AI_MAX_REQUEST_BYTES", "18000000")),
            persist_local_logs=os.getenv("PERSIST_LOCAL_LOGS", "false").lower() == "true",
            local_log_dir=os.getenv("LOCAL_LOG_DIR", "artifacts"),
        )
