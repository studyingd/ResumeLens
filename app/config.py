"""运行配置。

优先级：页面设置（config.local.json，可热更新） > 环境变量 / .env > 内置默认值。

LLM 配置（OpenAI 兼容协议，适用于 DeepSeek / Kimi / OpenAI / Ollama 等）：
    LLM_API_KEY   API 密钥（本地 Ollama 可填任意非空值）
    LLM_BASE_URL  API 地址，默认 https://api.deepseek.com/v1
    LLM_MODEL     模型名，默认 deepseek-chat

未配置 API Key 时自动使用本地启发式分析引擎。
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

_LOCAL_FILE = BASE_DIR / "config.local.json"

# 上传限制
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB
ALLOWED_EXTENSIONS = {".pdf", ".docx", ".txt", ".md"}

_DEFAULT_BASE_URL = "https://api.deepseek.com/v1"
_DEFAULT_MODEL = "deepseek-chat"


def _from_env() -> dict:
    return {
        "api_key": os.getenv("LLM_API_KEY", "").strip(),
        "base_url": (os.getenv("LLM_BASE_URL") or _DEFAULT_BASE_URL).strip().rstrip("/"),
        "model": (os.getenv("LLM_MODEL") or _DEFAULT_MODEL).strip(),
        "timeout": float(os.getenv("LLM_TIMEOUT", "120")),
    }


_state: dict = _from_env()
_source: str = "env"


def _load_local_overrides() -> None:
    """启动时读取页面保存的配置（仅当存有 API Key 时才覆盖环境变量）。"""
    global _state, _source
    if not _LOCAL_FILE.exists():
        return
    try:
        saved = json.loads(_LOCAL_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return
    if saved.get("api_key"):
        _state["api_key"] = saved["api_key"]
        if saved.get("base_url"):
            _state["base_url"] = saved["base_url"].rstrip("/")
        if saved.get("model"):
            _state["model"] = saved["model"]
        _source = "local"


_load_local_overrides()


def get() -> dict:
    """返回当前生效的 LLM 配置快照。"""
    return dict(_state)


def source() -> str:
    """配置来源："local"（页面设置）或 "env"。"""
    return _source


def llm_enabled() -> bool:
    return bool(_state["api_key"])


def save(api_key: str, base_url: str, model: str) -> None:
    """保存页面设置。api_key 为空表示清除本机配置、回到环境变量。"""
    global _state, _source
    api_key = (api_key or "").strip()
    if not api_key:
        _LOCAL_FILE.unlink(missing_ok=True)
        _state = _from_env()
        _source = "env"
        return
    _state = _from_env()
    _state["api_key"] = api_key
    if (base_url or "").strip():
        _state["base_url"] = base_url.strip().rstrip("/")
    if (model or "").strip():
        _state["model"] = model.strip()
    _LOCAL_FILE.write_text(
        json.dumps(
            {"api_key": _state["api_key"], "base_url": _state["base_url"], "model": _state["model"]},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    _source = "local"


def masked_key() -> str:
    key = _state["api_key"]
    if not key:
        return ""
    if len(key) <= 8:
        return "*" * len(key)
    return f"{key[:3]}******{key[-4:]}"
