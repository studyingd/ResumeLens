"""evaluator 纯函数：截断、钳位、HTTP 错误转写、模型输出 JSON 修复。"""

from __future__ import annotations

import pytest

from app.evaluator import (
    MAX_JD_CHARS,
    MAX_RESUME_CHARS,
    _clamp,
    _extract_json,
    cap_text,
    format_llm_http_error,
)


class TestCapText:
    def test_short_untouched(self):
        assert cap_text("abc", 10) == ("abc", False)

    def test_exact_boundary_not_cut(self):
        assert cap_text("a" * 100, 100) == ("a" * 100, False)

    def test_long_cut(self):
        text, cut = cap_text("a" * 250, 100)
        assert text == "a" * 100 and cut is True

    def test_limits_reasonable(self):
        # 护栏存在且数量级符合预期：简历 24000 / JD 8000
        assert 10000 < MAX_RESUME_CHARS <= 50000
        assert 2000 < MAX_JD_CHARS <= 20000


class TestClamp:
    @pytest.mark.parametrize(("value", "expected"), [(-5, 0), (0, 0), (72, 72), (120, 100)])
    def test_values(self, value, expected):
        assert _clamp(value) == expected


class TestFormatLlmHttpError:
    def test_openai_style_body(self):
        body = '{"error": {"message": "Insufficient Balance"}}'
        assert "Insufficient Balance" in format_llm_http_error(402, body)
        assert "402" in format_llm_http_error(402, body)

    def test_anthropic_style_body(self):
        # 非专用分支的状态码下，应提取 error.message 作为可读信息
        body = '{"type": "error", "error": {"message": "upstream overloaded"}}'
        msg = format_llm_http_error(503, body)
        assert "upstream overloaded" in msg and "503" in msg

    def test_html_body_falls_back_to_snippet(self):
        msg = format_llm_http_error(200, "<html><body>Gateway</body></html>")
        assert "Gateway" in msg

    def test_empty_body(self):
        assert "500" in format_llm_http_error(500, "")


class TestExtractJson:
    def test_plain(self):
        assert _extract_json('{"a": 1}') == {"a": 1}

    def test_code_fence(self):
        assert _extract_json('```json\n{"a": 1}\n```') == {"a": 1}

    def test_surrounding_prose(self):
        raw = '以下是评估结果：\n{"a": 1}\n希望对你有帮助'
        assert _extract_json(raw) == {"a": 1}

    def test_trailing_comma(self):
        assert _extract_json('{"a": [1, 2,],}') == {"a": [1, 2]}

    def test_missing_comma_between_items(self):
        raw = '{"improvements": [{"title": "A", "priority": "high"} {"title": "B"}]}'
        out = _extract_json(raw)
        assert len(out["improvements"]) == 2

    def test_inner_unescaped_quotes(self):
        raw = '{"verdict": "他说"很好""}'
        out = _extract_json(raw)
        assert "很好" in out["verdict"]

    def test_no_json_raises(self):
        with pytest.raises(ValueError, match="未找到 JSON"):
            _extract_json("抱歉，我无法处理该请求。")

    def test_unfixable_raises(self):
        with pytest.raises(ValueError, match="合法 JSON"):
            _extract_json('{"a": [1, 2}')
