"""测试公共夹具：隔离配置（不读写开发机真实 config.local.json / .env）。"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import config as cfg


@pytest.fixture
def isolated_config(monkeypatch: pytest.MonkeyPatch, tmp_path):
    """把页面配置文件指向临时目录、清空环境变量，每次测试都从空配置开始。"""
    for k in ("LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL", "LLM_CONCURRENCY"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setattr(cfg, "_LOCAL_FILE", tmp_path / "config.local.json")
    monkeypatch.setattr(cfg, "_state", cfg._from_env())
    monkeypatch.setattr(cfg, "_source", "env")
    return cfg


@pytest.fixture
def configured_llm(isolated_config, monkeypatch: pytest.MonkeyPatch):
    """配置好一个假 LLM（不发真实请求，仅让 llm_enabled() 为真）。"""
    monkeypatch.setattr(
        cfg, "_state", {"api_key": "sk-test", "base_url": "http://gateway.local/v1", "model": "test-model", "timeout": 30.0}
    )
    return cfg


@pytest.fixture
def client(tmp_path):
    """FastAPI 测试客户端（不发真实 LLM 请求；附件仓库指向临时目录，不污染真实简历存储）。"""
    from app import server as server_mod

    store = tmp_path / "resume_store"
    store.mkdir()
    orig = server_mod.RESUME_STORE_DIR
    server_mod.RESUME_STORE_DIR = store
    try:
        with TestClient(server_mod.app) as c:
            yield c
    finally:
        server_mod.RESUME_STORE_DIR = orig


def fake_eval_result(score: int = 80) -> dict:
    """构造一个最小合规的评估结果（结构对齐 evaluate_with_llm 的返回）。"""
    return {
        "engine": "llm",
        "mode": "match",
        "overall_score": score,
        "verdict": "综合匹配良好",
        "dimensions": [{"name": "技能适配度", "score": score, "comment": "核心技能吻合"}],
        "strengths": ["后端经验扎实"],
        "improvements": [{"title": "缺少高并发经验", "priority": "medium"}],
        "matched_keywords": ["Java"],
        "missing_keywords": ["Kubernetes"],
        "rewritten_summary": "",
        "notice": "",
    }
