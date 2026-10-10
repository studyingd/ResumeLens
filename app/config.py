"""运行配置。

优先级：页面设置（config.local.json，可热更新） > 环境变量 / .env > 全部留空。

LLM 配置（支持两种协议，按 Base URL 自动识别）：
    LLM_API_KEY   API 密钥（本地 Ollama 可填任意非空值）
    LLM_BASE_URL  API 地址。不含 /anthropic → OpenAI 兼容（如 https://api.deepseek.com/v1、
                  https://open.bigmodel.cn/api/paas/v4）；含 /anthropic → Anthropic 兼容
                  （如智谱 GLM Coding Plan 套餐专用 https://open.bigmodel.cn/api/anthropic）
    LLM_MODEL     模型名（如 glm-5.3-flash）

不预置任何默认地址/模型：未配置时不启用 AI，首次配置由用户完整填写。
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

# 已知服务商的规范 Base URL：用户填了域名但路径不全时自动补全
# （如智谱必须用完整路径 /api/paas/v4，否则 /models 与 /chat/completions 都会 404）
_KNOWN_BASE_FIXES: list[tuple[str, str]] = [
    ("bigmodel.cn", "https://open.bigmodel.cn/api/paas/v4"),
]


def normalize_base_url(url: str) -> str:
    """规范化 Base URL：去除尾部斜杠；已知服务商域名路径不全时修正为规范地址。

    注意：Anthropic 兼容端点（如 /api/anthropic，GLM Coding Plan 套餐使用）保持原样，
    不做改写。
    """
    url = (url or "").strip().rstrip("/")
    if "/anthropic" in url:
        return url
    for host, canonical in _KNOWN_BASE_FIXES:
        if host in url and url != canonical:
            return canonical
    return url


def _from_env() -> dict:
    return {
        "api_key": os.getenv("LLM_API_KEY", "").strip(),
        "base_url": (os.getenv("LLM_BASE_URL") or "").strip(),
        "model": (os.getenv("LLM_MODEL") or "").strip(),
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
        if isinstance(saved.get("llm_concurrency"), int):
            _state["llm_concurrency"] = saved["llm_concurrency"]
        _source = "local"


_load_local_overrides()


def get() -> dict:
    """返回当前生效的 LLM 配置快照（含 Base URL 规范化）。"""
    snapshot = dict(_state)
    snapshot["base_url"] = normalize_base_url(snapshot["base_url"])
    return snapshot


def source() -> str:
    """配置来源："local"（页面设置）或 "env"。"""
    return _source


def llm_enabled() -> bool:
    return bool(_state["api_key"])


def llm_concurrency() -> int:
    """批量评估的 LLM 并发上限（页面设置优先于环境变量 LLM_CONCURRENCY，默认 4，范围 1-8）。

    并发过高易触发上游限流（429，事务式设计下会终止整批）；
    若同账号还有其他应用占用配额，可将该值调回 2。
    """
    raw = _state.get("llm_concurrency") or os.getenv("LLM_CONCURRENCY", "4")
    try:
        return max(1, min(8, int(raw)))
    except (TypeError, ValueError):
        return 4


def save(api_key: str, base_url: str, model: str, concurrency: int | None = None) -> None:
    """保存页面设置。api_key 为空表示清除本机配置、回到环境变量。

    concurrency 为页面设置的批量并发数（1-8）；None 表示未改动，沿用现有生效值。
    """
    global _state, _source
    api_key = (api_key or "").strip()
    if not api_key:
        _LOCAL_FILE.unlink(missing_ok=True)
        _state = _from_env()
        _source = "env"
        return
    _state = _from_env()
    _state["api_key"] = api_key
    _state["base_url"] = normalize_base_url(base_url)
    if (model or "").strip():
        _state["model"] = model.strip()
    saved = {"api_key": _state["api_key"], "base_url": _state["base_url"], "model": _state["model"]}
    if concurrency is not None:
        if not (isinstance(concurrency, int) and 1 <= concurrency <= 8):
            raise ValueError("批量评估并发数需在 1-8 之间")
        _state["llm_concurrency"] = concurrency
        saved["llm_concurrency"] = concurrency
    _LOCAL_FILE.write_text(json.dumps(saved, ensure_ascii=False, indent=2), encoding="utf-8")
    _source = "local"


def masked_key() -> str:
    key = _state["api_key"]
    if not key:
        return ""
    if len(key) <= 8:
        return "*" * len(key)
    return f"{key[:3]}******{key[-4:]}"
