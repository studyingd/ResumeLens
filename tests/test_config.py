"""config：优先级、脱敏、Base URL 规范化、并发数（页面设置 > 环境变量 > 默认）。"""

from __future__ import annotations

import json

import pytest


class TestNormalizeBaseUrl:
    def test_strips_trailing_slash(self, isolated_config):
        assert isolated_config.normalize_base_url("http://gw.local/v1/") == "http://gw.local/v1"

    def test_bigmodel_path_completed(self, isolated_config):
        assert (
            isolated_config.normalize_base_url("https://open.bigmodel.cn")
            == "https://open.bigmodel.cn/api/paas/v4"
        )

    def test_anthropic_kept_as_is(self, isolated_config):
        url = "https://open.bigmodel.cn/api/anthropic"
        assert isolated_config.normalize_base_url(url) == url

    def test_empty(self, isolated_config):
        assert isolated_config.normalize_base_url("") == ""


class TestPriority:
    def test_env_only(self, isolated_config, monkeypatch):
        monkeypatch.setenv("LLM_API_KEY", "sk-env")
        monkeypatch.setenv("LLM_BASE_URL", "http://env.local/v1")
        monkeypatch.setenv("LLM_MODEL", "env-model")
        # isolated_config 已把 _state 指向空环境快照，这里重建以读到新环境变量
        monkeypatch.setattr(isolated_config, "_state", isolated_config._from_env())
        cfg = isolated_config.get()
        assert cfg["api_key"] == "sk-env" and cfg["model"] == "env-model"
        assert isolated_config.source() == "env" and isolated_config.llm_enabled()

    def test_page_overrides_env(self, isolated_config, monkeypatch):
        monkeypatch.setenv("LLM_API_KEY", "sk-env")
        monkeypatch.setenv("LLM_BASE_URL", "http://env.local/v1")
        monkeypatch.setattr(isolated_config, "_state", isolated_config._from_env())
        isolated_config.save("sk-page", "http://page.local/v1/", "page-model")
        cfg = isolated_config.get()
        assert cfg["api_key"] == "sk-page" and cfg["base_url"] == "http://page.local/v1"
        assert isolated_config.source() == "local"

    def test_clear_falls_back_to_env(self, isolated_config, monkeypatch):
        monkeypatch.setenv("LLM_API_KEY", "sk-env")
        monkeypatch.setattr(isolated_config, "_state", isolated_config._from_env())
        isolated_config.save("sk-page", "http://page.local/v1", "m")
        isolated_config.save("", "", "")
        assert isolated_config.source() == "env" and isolated_config.get()["api_key"] == "sk-env"

    def test_save_persists_file(self, isolated_config):
        isolated_config.save("sk-persist", "http://p.local/v1", "pm", 3)
        saved = json.loads(isolated_config._LOCAL_FILE.read_text(encoding="utf-8"))
        assert saved == {
            "api_key": "sk-persist",
            "base_url": "http://p.local/v1",
            "model": "pm",
            "llm_concurrency": 3,
        }


class TestMaskedKey:
    def test_masked(self, isolated_config):
        isolated_config.save("sk-1234567890abcd", "http://x.local/v1", "m")
        assert isolated_config.masked_key() == "sk-******abcd"

    def test_short_key_fully_masked(self, isolated_config):
        isolated_config.save("sk-abc", "http://x.local/v1", "m")
        assert set(isolated_config.masked_key()) == {"*"}

    def test_empty(self, isolated_config):
        assert isolated_config.masked_key() == ""


class TestConcurrency:
    def test_default_4(self, isolated_config):
        assert isolated_config.llm_concurrency() == 4

    def test_env_clamped_to_range(self, isolated_config, monkeypatch):
        monkeypatch.setenv("LLM_CONCURRENCY", "16")
        assert isolated_config.llm_concurrency() == 8
        monkeypatch.setenv("LLM_CONCURRENCY", "0")
        assert isolated_config.llm_concurrency() == 1

    def test_env_invalid_falls_back(self, isolated_config, monkeypatch):
        monkeypatch.setenv("LLM_CONCURRENCY", "abc")
        assert isolated_config.llm_concurrency() == 4

    def test_page_overrides_env(self, isolated_config, monkeypatch):
        monkeypatch.setenv("LLM_CONCURRENCY", "2")
        assert isolated_config.llm_concurrency() == 2
        isolated_config.save("sk-c", "http://c.local/v1", "m", 6)
        assert isolated_config.llm_concurrency() == 6

    def test_page_invalid_rejected(self, isolated_config):
        with pytest.raises(ValueError):
            isolated_config.save("sk-c", "http://c.local/v1", "m", 9)
        # 抛错时不落盘非法值；若文件尚未创建则视为通过
        if isolated_config._LOCAL_FILE.exists():
            assert "llm_concurrency" not in json.loads(
                isolated_config._LOCAL_FILE.read_text(encoding="utf-8")
            )
