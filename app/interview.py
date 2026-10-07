"""面试官视角：候选人姓名识别 + 基于 JD 与简历的面试问题生成。

问题生成同样走双引擎：LLM 深度生成（结构化面试题单）+ 本地模板兜底。
"""

from __future__ import annotations

import re
from pathlib import Path

import httpx

from . import config
from .evaluator import _extract_jd_keywords, _extract_json, _keyword_in_text

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
  b) JD 要求但简历未体现的能力 → 出题探测其基础与学习潜力；
  c) 简历中与 JD 无关的内容（无关项目、无关技能）一律不要出题。

题量结构（约 10 题）：
1. 岗位职责（4-5 题）：针对 JD 中每条核心职责出一题，考察候选人胜任该职责的能力。
2. 技能验证（2-3 题）：JD 任职要求中的核心技术项；若简历有相关描述则结合其描述追问细节，没有则直接考察掌握程度。
3. 短板探测（1-2 题）：JD 明确要求但简历未体现的能力。
4. 情景设计（1-2 题）：基于 JD 职责模拟该岗位的真实工作场景。
5. 软素质（1 题）：协作、沟通或成长性。

每题必须给出：考察意图（intent，需注明对应 JD 的哪条要求）与参考答案要点（reference，用于面试官评分）。
只输出一个合法 JSON 对象，不要包含 markdown 代码块标记或任何其他文字：
{
  "questions": [
    {"category": "岗位职责|技能验证|短板探测|情景设计|软素质", "question": "问题原文", "intent": "考察意图（注明对应JD要求）", "reference": "参考答案要点"}
  ],
  "focus_areas": ["本场面试的重点提示，2-4 条"]
}"""


async def generate_questions_llm(jd: str, resume: str) -> dict:
    cfg = config.get()
    payload = {
        "model": cfg["model"],
        "temperature": 0.4,
        "messages": [
            {"role": "system", "content": _QUESTIONS_PROMPT},
            {"role": "user", "content": f"【岗位JD】\n{jd}\n\n【候选人简历】\n{resume}"},
        ],
    }
    async with httpx.AsyncClient(timeout=cfg["timeout"]) as client:
        resp = await client.post(
            f"{cfg['base_url']}/chat/completions",
            json=payload,
            headers={"Authorization": f"Bearer {cfg['api_key']}"},
        )
    if resp.status_code != 200:
        raise RuntimeError(f"LLM 接口返回 {resp.status_code}")
    data = _extract_json(resp.json()["choices"][0]["message"]["content"])

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
# 面试问题：本地模板引擎
# ---------------------------------------------------------------------------


def questions_heuristic(jd: str, resume: str) -> dict:
    """JD 主线出题：每题锚定 JD 关键词；简历仅在与 JD 相关时交叉引用。"""
    resume_lower = resume.lower()
    keywords = _extract_jd_keywords(jd)
    matched = [kw for kw in keywords if _keyword_in_text(kw, resume_lower)]
    missing = [kw for kw in keywords if kw not in matched]

    questions: list[dict] = []

    # 岗位职责：针对 JD 核心关键词（职责向）出题
    for kw in keywords[:3]:
        questions.append(
            {
                "category": "岗位职责",
                "question": f"这个岗位的核心工作涉及「{kw}」。请结合你过往的经历，谈谈在这类工作中你会如何规划、执行，以及用什么指标衡量做得好不好？",
                "intent": f"对应 JD 要求「{kw}」，考察方法论与结果意识",
                "reference": "关注是否有完整的规划→执行→度量闭环，能否给出可量化的好坏标准",
            }
        )

    # 技能验证：JD 要求且简历命中的关键词，结合简历细节追问
    bullets_with_kw = [
        re.sub(r"^\s*[-•·*]\s*", "", ln).strip()
        for ln in resume.splitlines()
        if re.match(r"^\s*[-•·*]", ln)
        and any(_keyword_in_text(kw, ln.lower()) for kw in matched)
    ]
    for kw in matched[:2]:
        related = next((b for b in bullets_with_kw if _keyword_in_text(kw, b.lower())), "")
        anchor = f"简历中提到「{related[:50]}」，与 JD 的「{kw}」要求直接相关。" if related else f"JD 要求熟悉「{kw}」，"
        questions.append(
            {
                "category": "技能验证",
                "question": f"{anchor}请介绍你在「{kw}」上最有代表性的一次实践：当时的背景、方案取舍和量化结果分别是什么？",
                "intent": f"对应 JD 要求「{kw}」，结合简历描述验证经验真实性与深度",
                "reference": "合格回答应包含具体场景、方案对比与量化结果；若只能复述概念则经验存疑",
            }
        )

    # 短板探测：JD 要求但简历未体现
    for kw in missing[:2]:
        questions.append(
            {
                "category": "短板探测",
                "question": f"岗位会较多用到「{kw}」，你目前在这方面的基础如何？请举一个你快速掌握新技能并落地的例子。",
                "intent": f"对应 JD 要求「{kw}」，评估差距大小与学习潜力",
                "reference": "关注学习路径的具体性、自驱力与迁移能力",
            }
        )

    # 情景设计：基于 JD 首要职责构造场景
    top_kw = keywords[0] if keywords else "核心业务"
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
        focus.append(f"重点探测 JD 要求但简历缺失的能力：{'、'.join(missing[:4])}")
    if matched:
        focus.append(f"验证简历与 JD 双双命中的核心经验：{'、'.join(matched[:4])}")

    return {
        "engine": "heuristic",
        "questions": questions[:9],
        "focus_areas": focus,
        "notice": "当前为本地模板问题（未配置 LLM_API_KEY）。配置 AI 评估后可获得针对该岗位的深度定制面试题。",
    }
