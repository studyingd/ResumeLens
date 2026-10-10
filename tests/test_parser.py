"""parser：文本解码、乱码质量检测、按扩展名分发与错误。"""

from __future__ import annotations

import pytest

from app.parser import MIN_TEXT_LEN, ParseError, _decode_text, _low_quality, extract_text


class TestDecodeText:
    def test_utf8(self):
        assert _decode_text("姓名：张三".encode()) == "姓名：张三"

    def test_gb18030(self):
        assert _decode_text("姓名：张三".encode("gb18030")) == "姓名：张三"

    def test_binary_falls_back_to_replace(self):
        text = _decode_text(bytes(range(128, 256)) * 8)  # 无法按 utf-8/gb18030 解码
        assert "\ufffd" in text


class TestLowQuality:
    def test_clean_text(self):
        assert _low_quality("张三，五年后端开发经验，负责电商系统。") is False

    def test_few_marks_below_absolute_threshold(self):
        assert _low_quality("锟斤拷") is False  # 3 < 5 个，不报

    def test_kuinjinkou_heavy(self):
        assert _low_quality("锟斤拷" * 3) is True

    def test_replacement_char_ratio(self):
        assert _low_quality("\ufffd" * 5 + "好" * 1995) is True  # 5/2000 = 0.25% ≥ 0.2%
        assert _low_quality("\ufffd" * 5 + "好" * 4995) is False  # 0.1% < 0.2%

    def test_empty_safe(self):
        assert _low_quality("") is False


def _txt(data_or_text, name="resume.txt"):
    data = data_or_text.encode("utf-8") if isinstance(data_or_text, str) else data_or_text
    return extract_text(name, data)


class TestExtractText:
    def test_txt_happy(self):
        text = "张三\nJava 后端工程师\n" + "项目经验丰富。\n" * 10
        out, meta = _txt(text)
        assert "张三" in out and meta == {"ocr_used": False}

    def test_garbled_txt_flags_low_quality(self):
        text = "锟斤拷烫烫烫锟斤拷烫烫烫\n" + "简历内容。\n" * 20
        _, meta = _txt(text)
        assert meta.get("low_quality") is True

    def test_gb18030_txt(self):
        text = "李四，前端开发。" + "负责组件库建设。" * 8
        out, meta = _txt(text.encode("gb18030"))
        assert "李四" in out and "low_quality" not in meta

    def test_md_treated_as_text(self):
        text = "# 王五\nPython 工程师\n" + "精通数据管道。 " * 12
        out, _ = _txt(text, "resume.md")
        assert "王五" in out

    def test_too_short_raises_422(self):
        with pytest.raises(ParseError) as ei:
            _txt("太短")
        assert ei.value.status_code == 422

    def test_exact_min_length_passes(self):
        text = "字" * MIN_TEXT_LEN
        out, _ = _txt(text)
        assert len(out) == MIN_TEXT_LEN

    def test_unsupported_extension(self):
        with pytest.raises(ParseError, match="不支持的文件格式"):
            extract_text("photo.jpg", b"\xff\xd8")

    def test_no_extension(self):
        with pytest.raises(ParseError, match="不支持的文件格式"):
            extract_text("resume", b"whatever")
