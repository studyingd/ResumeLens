"""面试官视角：候选人姓名识别 + 基于 JD 与简历的面试问题生成（LLM）。"""

from __future__ import annotations

import re
from pathlib import Path

from .evaluator import _extract_json, chat_text

# ---------------------------------------------------------------------------
# 候选人姓名识别
# ---------------------------------------------------------------------------

_NAME_BLACKLIST = {
    "个人简历", "简历", "教育背景", "工作经历", "项目经历", "专业技能", "技能清单",
    "自我评价", "个人简介", "个人优势", "实习经历", "校园经历", "获奖经历",
    "基本信息", "工作背景", "专业能力", "求职意向",
}


def guess_candidate_name(resume_text: str, filename: str) -> str:
    """从简历文本前几行识别姓名，失败则回退到文件名。"""
    lines = [ln.strip() for ln in resume_text.splitlines() if ln.strip()][:10]

    # 1) 显式「姓名：张三」
    for ln in lines:
        m = re.match(r"^姓\s*名\s*[:：]?\s*([一-龥]{2,4}|[A-Za-z][A-Za-z .]{1,20})", ln)
        if m:
            return m.group(1).strip()

    # 2) 前 5 行中符合姓名特征的短行（无数字、非模块标题）
    for ln in lines[:5]:
        if ln in _NAME_BLACKLIST or any(c.isdigit() for c in ln):
            continue
        if re.fullmatch(r"[一-龥]{2,4}", ln):
            return ln
        if re.fullmatch(r"[A-Za-z][A-Za-z .]{1,24}", ln) and len(ln.split()) <= 3:
            return ln.title()

    # 3) 文件名回退
    stem = Path(filename).stem.strip()
    return (stem or "未知候选人")[:20]


# ---------------------------------------------------------------------------
# 面试问题：LLM 引擎
# ---------------------------------------------------------------------------

_QUESTIONS_PROMPT = """\
你是一位有 15 年经验的技术面试官，以结构化、深挖式的面试风格著称。
你将收到一份【岗位JD】和一位【候选人简历】，请为一场 45 分钟的面试生成问题清单。

出题总原则（最重要，必须遵守）：
- 以岗位JD为出题主线：每道题都必须锚定 JD 中的一条职责或任职要求，题干围绕岗位要求本身展开。
- 简历仅作交叉参照，只在与 JD 相关时使用：
  a) JD 要求且简历中体现了的技能/经历 → 结合简历中的具体描述出题，用于验证真实性与深度；
  b) JD 要求但简历未体现的能力 → 直接出该技能的技术题考察掌握程度，不要问「你目前基础如何」「举一个快速掌握新技能的例子」这类元问题；
  c) 简历中与 JD 无关的内容（无关项目、无关技能）一律不要出题。

题量结构（约 10 题）：
1. 岗位职责（3-4 题）：针对 JD 中每条核心职责出一题，考察候选人胜任该职责的能力。
2. 技能验证（3-4 题）：JD 任职要求中的核心技术项。简历有相关描述的结合其描述追问细节与深度；简历未体现的直接出技术题考察掌握程度（题面本身是技术问题，而非问学习经历）。
3. 情景设计（1-2 题）：基于 JD 职责模拟该岗位的真实工作场景。
4. 软素质（1 题）：协作、沟通或成长性。

每题必须给出：考察意图（intent，需注明对应 JD 的哪条要求）与参考答案要点（reference，用于面试官评分）。
只输出一个合法 JSON 对象，不要包含 markdown 代码块标记或任何其他文字：
{
  "questions": [
    {"category": "岗位职责|技能验证|情景设计|软素质", "question": "问题原文", "intent": "考察意图（注明对应JD要求）", "reference": "参考答案要点"}
  ],
  "focus_areas": ["本场面试的重点提示，2-4 条"]
}

JSON 格式硬性要求（违反会导致解析失败）：字符串值内部不要使用英文双引号 "，如需引用词语请用中文引号「」；不要出现尾随逗号。"""


async def generate_questions_llm(jd: str, resume: str) -> dict:
    raw = await chat_text(_QUESTIONS_PROMPT, f"【岗位JD】\n{jd}\n\n【候选人简历】\n{resume}", temperature=0.4)
    data = _extract_json(raw)

    questions = []
    for q in data.get("questions", []):
        if isinstance(q, dict) and q.get("question"):
            questions.append(
                {
                    "category": str(q.get("category", "综合")),
                    "question": str(q["question"]),
                    "intent": str(q.get("intent", "")),
                    "reference": str(q.get("reference", "")),
                }
            )
    if not questions:
        raise ValueError("模型未返回有效问题")

    return {
        "engine": "llm",
        "questions": questions[:10],
        "focus_areas": [str(a) for a in data.get("focus_areas", [])][:4],
    }


# ---------------------------------------------------------------------------
# 面试问题：单题重新生成（面试官对某一题不满意时替换该题）
# ---------------------------------------------------------------------------


async def regen_question_llm(
    jd: str, resume: str, category: str, current: str, others: list[str]
) -> dict:
    """重新生成一道题：保持原题类别、锚定 JD、与保留题目不重复。"""
    cat = category or "综合"
    others_text = "\n".join(f"- {o}" for o in others[:20] if o.strip()) or "- （无）"
    system = (
        "你是一位有 15 年经验的技术面试官。一场面试的题单已经确定，面试官对其中一道题不满意，需要你重新出一道来替换它。\n\n"
        "要求（必须遵守）：\n"
        "- 新题必须锚定【岗位JD】中的某条职责或任职要求，以岗位为出题主线；简历仅作交叉参照。\n"
        f"- 考察类别保持不变：category 必须为「{cat}」。\n"
        "- 与【其余保留的题目】不重复，考察角度需与原题有明显差异。\n"
        "- 给出考察意图（intent，注明对应 JD 的哪条要求）与参考答案要点（reference）。\n\n"
        "只输出一个合法 JSON 对象，不要包含 markdown 代码块标记或任何其他文字：\n"
        '{"category": "…", "question": "…", "intent": "…", "reference": "…"}\n\n'
        "JSON 格式硬性要求：字符串值内部不要使用英文双引号，如需引用词语请用中文引号「」；不要出现尾随逗号。"
    )
    user = (
        f"【岗位JD】\n{jd}\n\n【候选人简历】\n{resume}\n\n"
        f"【需要替换的原题】（类别：{cat}）\n{current}\n\n【其余保留的题目】\n{others_text}"
    )
    raw = await chat_text(system, user, temperature=0.7)
    data = _extract_json(raw)
    if not isinstance(data, dict) or not str(data.get("question", "")).strip():
        raise ValueError("模型未返回有效问题")
    return {
        "category": str(data.get("category") or cat),
        "question": str(data["question"]).strip(),
        "intent": str(data.get("intent", "")),
        "reference": str(data.get("reference", "")),
    }
