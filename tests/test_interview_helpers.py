"""interview：候选人姓名识别与题量配置（榜单展示与生成控制的基础）。"""

from __future__ import annotations

import pytest

from app.interview import (
    DEFAULT_QUESTION_COUNTS,
    _bigrams,
    _counts_block,
    _dedupe_questions,
    _salvage_questions,
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


class TestDedupeQuestions:
    def _q(self, question, reference="r"):
        return {"category": "技能验证", "question": question, "intent": "", "reference": reference}

    def test_identical_dropped(self):
        qs = [self._q("请说明 Spring Boot 自动装配的原理"), self._q("请说明 Spring Boot 自动装配的原理！")]
        kept, dropped = _dedupe_questions(qs)
        assert len(kept) == 1 and dropped == 1

    def test_similar_reference_also_dropped(self):
        qs = [
            self._q("订单高并发下如何保障稳定性", "限流、熔断、降级"),
            self._q("大促场景下订单服务如何保障稳定性", "限流、熔断、降级落地"),
        ]
        kept, dropped = _dedupe_questions(qs)
        assert len(kept) == 1 and dropped == 1

    def test_distinct_kept(self):
        qs = [
            self._q("请说明 Spring Boot 自动装配的原理"),
            self._q("MySQL 索引失效的常见场景有哪些"),
            self._q("如何设计订单状态机"),
        ]
        kept, dropped = _dedupe_questions(qs)
        assert len(kept) == 3 and dropped == 0

    def test_bigrams_ignore_whitespace(self):
        assert _bigrams("a b") == _bigrams("ab")
        assert _bigrams("x") == set()


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


if __name__ == "__main__":
    pytest.main([__file__])
