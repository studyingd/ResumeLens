"""面试官视角：候选人姓名识别 + 基于 JD 与简历的面试问题生成（LLM）。"""

from __future__ import annotations

import json
import re
from pathlib import Path

from .evaluator import MAX_JD_CHARS, MAX_RESUME_CHARS, _extract_json, cap_text, chat_text

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

# 四类题目的定位说明（提示词中逐类展开，数量由使用者自定义）
_CATEGORY_DESCS = {
    "岗位职责": "针对 JD 中每条核心职责出一题，考察候选人胜任该职责的能力。",
    "技能验证": "JD 任职要求中的核心技术项。简历有相关描述的结合其描述追问细节与深度；简历未体现的直接出技术题考察掌握程度（题面本身是技术问题，而非问学习经历）。",
    "情景设计": "基于 JD 职责模拟该岗位的真实工作场景。",
    "软素质": "协作、沟通或成长性。",
}

# 默认题量：约 10 题、以岗位为主线（使用者可在生成前自由调整各类数量）
DEFAULT_QUESTION_COUNTS = {"岗位职责": 4, "技能验证": 3, "情景设计": 2, "软素质": 1}


def normalize_question_counts(raw: dict | None) -> dict:
    """校验并补全题量配置：缺失的类别取默认值，返回四类完整映射。"""
    if raw is None:
        return dict(DEFAULT_QUESTION_COUNTS)
    if not isinstance(raw, dict):
        raise ValueError("题量配置格式不正确")
    unknown = [k for k in raw if k not in DEFAULT_QUESTION_COUNTS]
    if unknown:
        raise ValueError(f"未知的题目类别：{'、'.join(unknown[:3])}")
    counts = dict(DEFAULT_QUESTION_COUNTS)
    for key, val in raw.items():
        if isinstance(val, bool) or not isinstance(val, int):
            raise ValueError(f"「{key}」的题量必须为整数")
        if not 0 <= val <= 10:
            raise ValueError(f"「{key}」的题量需在 0-10 之间")
        counts[key] = val
    total = sum(counts.values())
    if not 1 <= total <= 20:
        raise ValueError("四类题量之和需在 1-20 之间")
    return counts


def _counts_block(counts: dict) -> str:
    """把题量配置渲染成提示词中的题量结构段（数量为硬性要求）。"""
    lines = []
    for i, (cat, desc) in enumerate(_CATEGORY_DESCS.items(), 1):
        n = counts.get(cat, 0)
        lines.append(f"{i}. {cat}（{n} 题）：{desc}" if n > 0 else f"{i}. {cat}（0 题）：不要生成该类问题。")
    total = sum(counts.values())
    return f"题量结构（共 {total} 题；各类数量为硬性要求，必须严格遵守，多出或缺少均不符合要求）：\n" + "\n".join(
        lines
    )


_QUESTIONS_PROMPT_TMPL = """\
你是一位有 15 年经验的技术面试官，以结构化、深挖式的面试风格著称。
你将收到一份【岗位JD】和一位【候选人简历】，请为一场 45 分钟的面试生成问题清单。

出题总原则（最重要，必须遵守）：
- 以岗位JD为出题主线：每道题都必须锚定 JD 中的一条职责或任职要求，题干围绕岗位要求本身展开。
- 简历仅作交叉参照，只在与 JD 相关时使用：
  a) JD 要求且简历中体现了的技能/经历 → 结合简历中的具体描述出题，用于验证真实性与深度；
  b) JD 要求但简历未体现的能力 → 直接出该技能的技术题考察掌握程度，不要问「你目前基础如何」「举一个快速掌握新技能的例子」这类元问题；
  c) 简历中与 JD 无关的内容（无关项目、无关技能）一律不要出题。

{counts_block}

篇幅硬约束（输出预算有限，超长会被截断导致失败）：每题 question ≤ 60 字、intent ≤ 40 字、reference ≤ 90 字，reference 直接列要点、顿号分隔，不要写成段落。

每题必须给出：考察意图（intent，需注明对应 JD 的哪条要求）与参考答案要点（reference，用于面试官评分）。
只输出一个合法 JSON 对象，不要包含 markdown 代码块标记或任何其他文字：
{
  "questions": [
    {"category": "岗位职责|技能验证|情景设计|软素质", "question": "问题原文", "intent": "考察意图（注明对应JD要求）", "reference": "参考答案要点"}
  ],
  "focus_areas": ["本场面试的重点提示，2-4 条"]
}

JSON 格式硬性要求（违反会导致解析失败）：字符串值内部不要使用英文双引号 "，如需引用词语请用中文引号「」；不要出现尾随逗号。"""


def _salvage_questions(raw: str) -> dict:
    """输出被 max_tokens 截断时的补救：扫描 questions 数组中已完整的问题对象重建结果。

    只保留能独立通过 json.loads 的完整对象；一个都拼不出来则放弃。
    """
    s = raw.strip()
    if not s.startswith("{"):
        raise ValueError("模型输出中未找到 JSON")
    m = re.search(r'"questions"\s*:\s*\[', s)
    if not m:
        raise ValueError("模型输出中未找到 JSON")
    objs = []
    depth = 0
    obj_start = None
    in_str = False
    esc = False
    for i in range(m.end(), len(s)):
        ch = s[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            if depth == 0:
                obj_start = i
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0 and obj_start is not None:
                objs.append(json.loads(s[obj_start : i + 1]))
                obj_start = None
        elif ch == "]" and depth == 0:
            break  # 数组正常结束
    if not objs:
        raise ValueError("模型输出中未找到 JSON")
    return {"questions": objs, "focus_areas": []}


async def generate_questions_llm(jd: str, resume: str, counts: dict | None = None) -> dict:
    jd_text, jd_cut = cap_text(jd.strip(), MAX_JD_CHARS)
    resume_text, resume_cut = cap_text(resume, MAX_RESUME_CHARS)
    counts = normalize_question_counts(counts)
    system = _QUESTIONS_PROMPT_TMPL.replace("{counts_block}", _counts_block(counts))
    raw = await chat_text(system, f"【岗位JD】\n{jd_text}\n\n【候选人简历】\n{resume_text}", temperature=0.4)
    salvaged = False
    try:
        data = _extract_json(raw)
    except ValueError:
        # 大题量时模型思考占用输出预算，输出可能在数组中间被截断：捡回已完整的问题对象
        data = _salvage_questions(raw)
        salvaged = True

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

    # 逐类截断：提示词中数量为硬性要求，但模型仍可能超发——超出配置数量的类别尾部截去
    used = dict.fromkeys(counts, 0)
    kept = []
    for q in questions:
        cat = q["category"]
        if cat in used:
            if used[cat] >= counts[cat]:
                continue
            used[cat] += 1
        kept.append(q)
    questions = kept[:30]  # 兜底上限（未知类别不受逐类约束）

    notices = []
    if resume_cut or jd_cut:
        notices.append("简历或 JD 内容过长，已截取前部分生成面试题。")
    if salvaged:
        notices.append("模型输出达到长度上限被截断，已保留前面完整的问题；如需更多可适当减少题量后重试。")
    return {
        "engine": "llm",
        "questions": questions,
        "focus_areas": [str(a) for a in data.get("focus_areas", [])][:4],
        "notice": " ".join(notices),
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
    jd_text, _ = cap_text(jd.strip(), MAX_JD_CHARS)
    resume_text, _ = cap_text(resume, MAX_RESUME_CHARS)
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
        f"【岗位JD】\n{jd_text}\n\n【候选人简历】\n{resume_text}\n\n"
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
