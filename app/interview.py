"""面试官视角：候选人姓名识别 + 基于 JD 与简历的面试问题生成。

问题生成同样走双引擎：LLM 深度生成（结构化面试题单）+ 本地模板兜底。
"""

from __future__ import annotations

import re
from pathlib import Path

from .evaluator import _extract_jd_keywords, _extract_json, _keyword_in_text, chat_text

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


def regen_question_heuristic(
    jd: str, resume: str, category: str, current: str, others: list[str]
) -> dict:
    """本地模板替换：优先取同类别且未与保留题重复的模板题；池耗尽则给开放深挖题。"""
    pool = questions_heuristic(jd, resume)["questions"]
    exclude = set(others) | {current}
    for q in pool:
        if q["question"] not in exclude and (not category or q["category"] == category):
            return q
    for q in pool:
        if q["question"] not in exclude:
            return q
    return {
        "category": category or "综合",
        "question": (
            "请挑选你过往经历中最能体现岗位胜任力的一件事，完整讲述：背景与目标、"
            "你的关键决策与取舍、遇到的最大困难与解法、以及最终的量化结果与复盘。"
        ),
        "intent": "开放性深挖题，考察决策质量、结果意识与复盘深度",
        "reference": "关注决策逻辑是否清晰、是否有量化结果、复盘是否触及方法论层面",
    }


# ---------------------------------------------------------------------------
# 面试问题：本地模板引擎
# ---------------------------------------------------------------------------


def _kw_tokens(kw: str) -> frozenset[str]:
    """按分隔符把关键词切成 token 集合（「python/fastapi」→ {python, fastapi}）。"""
    return frozenset(t for t in re.split(r"[/,\s、|&+·]+", kw) if t)


def _dedupe_keywords(keywords: list[str]) -> list[str]:
    """去掉被其他关键词完全包含的冗余项（已有「python/fastapi」就不再保留「fastapi」），
    避免生成两道几乎相同的技术题；按 token 而非子串判断，所以「java」不会被「javascript」误删。"""
    toks = {kw: _kw_tokens(kw) for kw in keywords}
    return [kw for kw in keywords if not any(toks[kw] < toks[o] for o in keywords if o != kw)]


def _kw_label(kw: str) -> str:
    """关键词在题干中的展示：复合词（python/fastapi）用顿号连接，读起来更自然。"""
    parts = [t for t in re.split(r"[/、]+", kw) if t]
    return "、".join(parts) if len(parts) > 1 else kw


def questions_heuristic(jd: str, resume: str) -> dict:
    """JD 主线出题：每题锚定 JD 关键词；简历仅在与 JD 相关时交叉引用。"""
    resume_lower = resume.lower()
    # 出题前先去掉互为包含的冗余关键词，否则会出两道几乎相同的技术题；
    # 评分用的关键词提取（evaluator）不经过这里，覆盖统计不受影响
    keywords = _dedupe_keywords(_extract_jd_keywords(jd))
    matched = [kw for kw in keywords if _keyword_in_text(kw, resume_lower)]
    missing = [kw for kw in keywords if kw not in matched]

    questions: list[dict] = []
    used: set[str] = set()  # 已被前面的题占用的关键词，避免不同类别重复考同一个点

    # 岗位职责：针对 JD 核心关键词（职责向）出题
    for kw in keywords[:3]:
        used.add(kw)
        questions.append(
            {
                "category": "岗位职责",
                "question": f"这个岗位的核心工作涉及「{_kw_label(kw)}」。请结合你过往的经历，谈谈在这类工作中你会如何规划、执行，以及用什么指标衡量做得好不好？",
                "intent": f"对应 JD 要求「{_kw_label(kw)}」，考察方法论与结果意识",
                "reference": "关注是否有完整的规划→执行→度量闭环，能否给出可量化的好坏标准",
            }
        )

    # 技能验证（简历命中）：优先考职责题未覆盖的技能，结合简历细节追问
    bullets_with_kw = [
        re.sub(r"^\s*[-•·*]\s*", "", ln).strip()
        for ln in resume.splitlines()
        if re.match(r"^\s*[-•·*]", ln)
        and any(_keyword_in_text(kw, ln.lower()) for kw in matched)
    ]
    for kw in ([k for k in matched if k not in used] or matched)[:2]:
        used.add(kw)
        related = next((b for b in bullets_with_kw if _keyword_in_text(kw, b.lower())), "")
        anchor = f"简历中提到「{related[:50]}」，与 JD 的「{_kw_label(kw)}」要求直接相关。" if related else f"JD 要求熟悉「{_kw_label(kw)}」，"
        questions.append(
            {
                "category": "技能验证",
                "question": f"{anchor}请介绍你在「{_kw_label(kw)}」上最有代表性的一次实践：当时的背景、方案取舍和量化结果分别是什么？",
                "intent": f"对应 JD 要求「{_kw_label(kw)}」，结合简历描述验证经验真实性与深度",
                "reference": "合格回答应包含具体场景、方案对比与量化结果；若只能复述概念则经验存疑",
            }
        )

    # 技能验证（简历未体现）：JD 要求但简历未提及 → 直接出技术题考察掌握程度，不问学习经历
    for kw in ([k for k in missing if k not in used] or missing)[:2]:
        used.add(kw)
        questions.append(
            {
                "category": "技能验证",
                "question": f"JD 要求掌握「{_kw_label(kw)}」。请说明其核心机制或常用方案，再举一个你实际用过（或深入研究过）的场景：当时如何选型、踩过什么坑、如何验证效果？",
                "intent": f"对应 JD 要求「{_kw_label(kw)}」，简历未体现 → 直接考察该技能的实际掌握程度",
                "reference": f"能讲清「{_kw_label(kw)}」的核心机制与真实场景取舍为合格；只会背概念、答不出场景细节则掌握程度存疑",
            }
        )

    # 情景设计：基于 JD 首要职责构造场景
    top_kw = _kw_label(keywords[0]) if keywords else "核心业务"
    questions.append(
        {
            "category": "情景设计",
            "question": f"假设入职后第一周，你接手了与「{top_kw}」相关的一个正在进行的任务，前任同事已离职且文档缺失。请描述你的接管思路与优先级排序。",
            "intent": f"对应 JD 职责「{top_kw}」，考察实际接手工作的方法论",
            "reference": "应体现：先梳理现状与风险→快速对齐干系人→分清止损与长期优化→建立节奏与文档",
        }
    )

    questions.append(
        {
            "category": "软素质",
            "question": "请分享一次与同事（或跨团队）意见严重分歧的经历：你们分歧的点是什么？你如何推进并最终落地？",
            "intent": "考察协作方式、沟通韧性与结果导向",
            "reference": "关注是否倾听对方论据、是否用数据/事实推动决策，而非情绪或职级",
        }
    )

    focus = ["出题主线为岗位 JD 的职责与任职要求，简历仅作交叉验证"]
    if missing:
        focus.append(f"重点考察 JD 要求但简历未体现的能力：{'、'.join(_kw_label(k) for k in missing[:4])}")
    if matched:
        focus.append(f"验证简历与 JD 双双命中的核心经验：{'、'.join(_kw_label(k) for k in matched[:4])}")

    return {
        "engine": "heuristic",
        "questions": questions[:9],
        "focus_areas": focus,
        "notice": "当前为本地模板问题（未配置 LLM_API_KEY）。配置 AI 评估后可获得针对该岗位的深度定制面试题。",
    }
