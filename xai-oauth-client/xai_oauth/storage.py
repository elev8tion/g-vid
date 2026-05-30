"""Token storage for xAI OAuth (simple JSON file, modeled after Hermes)."""

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict

DEFAULT_TOKEN_PATH = Path.home() / ".xai-oauth" / "tokens.json"


def get_token_path() -> Path:
    """Return the path where tokens are stored."""
    return Path(os.getenv("XAI_OAUTH_TOKEN_PATH", DEFAULT_TOKEN_PATH))


def ensure_token_dir() -> None:
    path = get_token_path()
    path.parent.mkdir(parents=True, exist_ok=True)


def _read_tokens_raw() -> Dict[str, Any]:
    path = get_token_path()
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text())
    except Exception:
        return {}


def save_tokens(tokens: Dict[str, Any], discovery: Dict[str, Any] = None) -> None:
    """Save tokens + discovery info."""
    ensure_token_dir()
    path = get_token_path()

    data = {
        "tokens": tokens,
        "discovery": discovery or {},
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    path.write_text(json.dumps(data, indent=2))


def load_tokens() -> Dict[str, Any]:
    """Load tokens from disk."""
    raw = _read_tokens_raw()
    return raw.get("tokens", {})


def load_full_state() -> Dict[str, Any]:
    """Return the full stored state (tokens + discovery)."""
    return _read_tokens_raw()


def clear_tokens() -> None:
    path = get_token_path()
    if path.exists():
        path.unlink()