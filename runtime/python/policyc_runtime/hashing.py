import hashlib
import json
from typing import Any


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha256(value: str | bytes) -> str:
    data = value.encode() if isinstance(value, str) else value
    return hashlib.sha256(data).hexdigest()


def stable_id(prefix: str, value: Any, length: int = 16) -> str:
    return f"{prefix}_{sha256(canonical_json(value))[:length]}"
