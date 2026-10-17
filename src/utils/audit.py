"""Minimal trace: no input filenames, base64, credentials or original image files."""
import json
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from src.utils.config import Settings


class AuditTrail:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.records: list[dict] = []

    def record(self, stage: str, manifest: list[dict], raw: str | None, error: str | None = None):
        item = {"event_id": uuid4().hex, "created_at": datetime.now(timezone.utc).isoformat(),
                "stage": stage, "input_manifest": manifest, "raw_response": raw, "error": error}
        self.records.append(item)
        if self.settings.persist_local_logs:
            folder = Path(self.settings.local_log_dir)
            folder.mkdir(parents=True, exist_ok=True)
            target = folder / (item["event_id"] + ".json")
            with target.open("x", encoding="utf-8") as handle:
                json.dump(item, handle, ensure_ascii=False, indent=2)
