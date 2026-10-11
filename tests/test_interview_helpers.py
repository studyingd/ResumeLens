"""interview：候选人姓名识别与题量配置（榜单展示与生成控制的基础）。"""

from __future__ import annotations

import pytest

from app.interview import (
    DEFAULT_QUESTION_COUNTS,
    _counts_block,
    _focus_block,
    _normalize_category,
    _salvage_questions,
    _shortage_block,
    guess_candidate_name,
    normalize_question_counts,
)


def resume_with_lines(*lines: str) -> str:
    return "\n".join(lines) + "\n" + "项目经验若干。\n" * 5


class TestQuestionCounts:
    def test_defaults_when_none(self):
        assert normalize_question_counts(None) == DEFAULT_QUESTION_COUNTS

    def test_partial_uses_defaults(self):
        counts = normalize_question_counts({"软素质": 0})
        assert counts["软素质"] == 0 and counts["岗位职责"] == 4

    def test_all_zero_rejected(self):
        with pytest.raises(ValueError, match="1-20"):
            normalize_question_counts({k: 0 for k in DEFAULT_QUESTION_COUNTS})

    def test_value_out_of_range(self):
        with pytest.raises(ValueError, match="0-10"):
            normalize_question_counts({"岗位职责": 11})
        with pytest.raises(ValueError, match="0-10"):
            normalize_question_counts({"岗位职责": -1})

    def test_non_int_rejected(self):
        with pytest.raises(ValueError, match="整数"):
            normalize_question_counts({"岗位职责": "3"})

    def test_unknown_category_rejected(self):
        with pytest.raises(ValueError, match="未知"):
            normalize_question_counts({"综合素质": 2})

    def test_total_over_20_rejected(self):
        with pytest.raises(ValueError, match="1-20"):
            normalize_question_counts({"岗位职责": 10, "技能验证": 10, "情景设计": 5})

    def test_counts_block_content(self):
        block = _counts_block({"岗位职责": 3, "技能验证": 4, "情景设计": 0, "软素质": 1})
        assert "共 8 题" in block
        assert "岗位职责（3 题）" in block and "技能验证（4 题）" in block
        assert "情景设计（0 题）：不要生成该类问题。" in block


class TestSalvageQuestions:
    def test_truncated_mid_object_keeps_complete_ones(self):
        raw = (
            '{\n  "questions": [\n'
            '    {"category": "岗位职责", "question": "q1", "intent": "i", "reference": "r"},\n'
            '    {"category": "技能验证", "question": "q2", "intent": "i", "reference": "r"},\n'
            '    {"category": "软素质", "question": "q3", "int'  # 在第三个对象中间被截断
        )
        data = _salvage_questions(raw)
        assert [q["question"] for q in data["questions"]] == ["q1", "q2"]
        assert data["focus_areas"] == []

    def test_quotes_and_escapes_inside_values(self):
        raw = (
            '{"questions": [{'
            '"question": "问「双引号 \\" 转义 {与} 括号", "intent": "i", "reference": "r"}'
            ', {"question": "截'
        )
        data = _salvage_questions(raw)
        assert data["questions"][0]["question"].endswith("括号")

    def test_no_questions_key_raises(self):
        with pytest.raises(ValueError):
            _salvage_questions('{"other": [1, 2]')

    def test_no_complete_object_raises(self):
        with pytest.raises(ValueError):
            _salvage_questions('{"questions": [{"question": "q1')


class TestFocusBlock:
    def test_empty_when_none(self):
        assert _focus_block(None, None) == ""
        assert _focus_block("", "  ") == ""

    def test_snippet_and_emphasis_rendered(self):
        block = _focus_block("负责库存打减方案", "重点验证真实性")
        assert "负责库存打减方案" in block and "重点验证真实性" in block
        assert block.startswith("面试官指定了重点简历片段")

    def test_emphasis_only(self):
        block = _focus_block(None, "往高并发正确性上问")
        assert "出题侧重" in block and "面试官指定了重点简历片段" not in block


class TestNormalizeCategory:
    def test_variants_map_to_canonical(self):
        """模型输出的变体标签归一到四类白名单，避免绕过逐类题量约束。"""
        assert _normalize_category("情景设计题") == "情景设计"
        assert _normalize_category("技能验证（技术深度）") == "技能验证"
        assert _normalize_category(" 岗位 职责 ") == "岗位职责"
        assert _normalize_category("软素质-沟通") == "软素质"

    def test_unknown_kept_and_empty_fallback(self):
        assert _normalize_category("综合能力") == "综合能力"
        assert _normalize_category("") == "综合"
        assert _normalize_category(None) == "综合"


class TestShortageBlock:
    def _q(self, cat):
        return {"category": cat, "question": "q", "intent": "", "reference": ""}

    def test_shortage_reported(self):
        qs = [self._q("岗位职责")] * 2
        block = _shortage_block(qs, {"岗位职责": 3, "技能验证": 3, "情景设计": 2, "软素质": 1})
        assert "「岗位职责」缺 1 题" in block and "「技能验证」缺 3 题" in block

    def test_exact_match_silent(self):
        counts = {"岗位职责": 2, "技能验证": 1, "情景设计": 0, "软素质": 0}
        qs = [self._q("岗位职责")] * 2 + [self._q("技能验证")]
        assert _shortage_block(qs, counts) == ""


class TestExplicitLabel:
    def test_chinese(self):
        assert guess_candidate_name(resume_with_lines("姓名：张三", "五年经验"), "f.txt") == "张三"

    def test_chinese_no_colon(self):
        assert guess_candidate_name(resume_with_lines("姓名 张三丰"), "f.txt") == "张三丰"

    def test_english(self):
        assert guess_candidate_name(resume_with_lines("姓名：John Smith"), "f.txt") == "John Smith"


class TestShortLineHeuristic:
    def test_bare_chinese_name(self):
        assert guess_candidate_name(resume_with_lines("张三", "求职意向：后端工程师"), "f.txt") == "张三"

    def test_blacklist_line_skipped(self):
        # 首行是模块标题而非姓名 → 应跳过标题，落到第 2 行的姓名
        assert guess_candidate_name(resume_with_lines("个人简历", "李四"), "f.txt") == "李四"

    def test_line_with_digits_skipped(self):
        # 「联系方式 13800000000」含数字，不应误判为姓名
        name = guess_candidate_name(resume_with_lines("13800000000", "王五"), "f.txt")
        assert name == "王五"

    def test_english_title_cased(self):
        assert guess_candidate_name(resume_with_lines("zhang san"), "f.txt") == "Zhang San"


class TestFilenameFallback:
    def test_stem(self):
        assert guess_candidate_name(resume_with_lines("教育背景", "工作经历"), "王小明_后端.pdf") == "王小明_后端"

    def test_long_stem_truncated(self):
        name = guess_candidate_name(resume_with_lines("教育背景"), "超" * 50 + ".txt")
        assert len(name) <= 20

    def test_empty_filename(self):
        assert guess_candidate_name(resume_with_lines("专业技能"), "") == "未知候选人"


JD = "负责后端服务的设计与开发，参与系统架构优化，保障线上稳定性，要求熟悉 MySQL 与缓存。" * 2
RESUME = "张三，5 年后端经验。主导电商订单系统重构：引入 MySQL 慢查询治理，优化索引与执行计划，QPS 提升 3 倍。"


class TestRegenQuestionPrompt:
    """单题重生成的提示词：锚定片段/补充要求注入，无锚定时回退 JD 主线。"""

    def _capture_chat(self, monkeypatch):
        import asyncio

        from app import interview

        captured = {}

        async def fake_chat(system, user, temperature=0.7, **kwargs):
            captured["system"] = system
            captured["user"] = user
            return '{"category": "技能验证", "question": "新题", "intent": "i", "reference": "r"}'

        monkeypatch.setattr(interview, "chat_text", fake_chat)
        return interview, captured, asyncio

    def test_focus_and_hint_injected(self, monkeypatch):
        interview, captured, asyncio = self._capture_chat(monkeypatch)
        q = asyncio.run(
            interview.regen_question_llm(
                JD,
                RESUME,
                "技能验证",
                "旧题",
                ["保留题 A", "保留题 B"],
                focus_snippet="主导订单系统重构，引入 MySQL 慢查询治理",
                hint="往索引与执行计划细节上问",
            )
        )
        assert q["question"] == "新题"
        assert q["category"] == "技能验证"
        assert "【简历锚定片段】" in captured["user"]
        assert "慢查询治理" in captured["user"]
        assert "【面试官补充要求】" in captured["user"]
        assert "索引与执行计划" in captured["user"]
        assert "优先围绕【简历锚定片段】" in captured["system"]
        assert "保留题 A" in captured["user"]

    def test_no_focus_falls_back_to_jd_line(self, monkeypatch):
        interview, captured, asyncio = self._capture_chat(monkeypatch)
        q = asyncio.run(interview.regen_question_llm(JD, RESUME, "技能验证", "旧题", []))
        assert q["question"] == "新题"
        assert "【简历锚定片段】" not in captured["user"]
        assert "以岗位为出题主线" in captured["system"]

    def test_hint_without_focus(self, monkeypatch):
        interview, captured, asyncio = self._capture_chat(monkeypatch)
        asyncio.run(interview.regen_question_llm(JD, RESUME, "技能验证", "旧题", [], hint="换角度"))
        assert "【面试官补充要求】" in captured["user"]
        assert "【简历锚定片段】" not in captured["user"]


if __name__ == "__main__":
    pytest.main([__file__])
