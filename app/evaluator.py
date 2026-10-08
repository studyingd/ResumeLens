"""评估引擎：LLM 深度评估（OpenAI 兼容协议）+ 本地启发式分析（无需 API Key 的降级方案）。

两种引擎返回同一结果结构：
{
  "engine": "llm" | "heuristic",
  "overall_score": 0-100,
  "verdict": "一句话总评",
  "dimensions": [{"name", "score", "comment"}],
  "strengths": [{"title", "detail"}],
  "improvements": [{"title", "detail", "suggestion", "priority"}],
  "matched_keywords": [...],
  "missing_keywords": [...],
  "rewritten_summary": "..."
}
"""

from __future__ import annotations

import json
import re
import warnings

# jieba 在 Python 3.13 下会触发无害的 SyntaxWarning，在其导入前屏蔽
warnings.filterwarnings("ignore", category=SyntaxWarning, module="jieba.*")
warnings.filterwarnings("ignore", category=SyntaxWarning)

import httpx
import jieba.analyse

from . import config

# ---------------------------------------------------------------------------
# 公共工具
# ---------------------------------------------------------------------------

_EN_WORD = re.compile(r"[A-Za-z][A-Za-z0-9+#./-]{1,}")

_STOPWORDS = {
    # 中文职位描述常见虚词与套话
    "岗位", "职责", "要求", "任职", "资格", "优先", "负责", "完成", "配合", "参与",
    "熟悉", "精通", "掌握", "具备", "具有", "良好", "优秀", "较强", "相关", "以及",
    "我们", "公司", "团队", "工作", "经验", "能力", "学历", "本科", "以上", "大专",
    "职位", "描述", "招聘", "简历", "应聘", "应届", "全职", "兼职", "薪资", "福利",
    "部门", "汇报", "协调", "沟通", "执行", "推动", "确保", "包括", "其他", "等等",
    "岗位职责", "任职要求", "岗位描述", "工作职责", "职位描述", "招聘要求", "加分项",
    "以上学历", "及相关", "及以上",
    "者", "的", "与", "和", "及", "或", "等", "中", "在", "对", "为", "并", "按",
    # 英文常见停用词
    "the", "and", "for", "with", "you", "your", "our", "will", "are", "have",
    "has", "must", "able", "work", "working", "years", "year", "plus", "job",
    "role", "team", "about", "from", "into", "this", "that", "such", "who",
    "using", "used", "use", "new", "strong", "good", "great", "well", "etc",
    "requirements", "responsibilities", "preferred", "qualifications",
}


def _clamp(value: int, low: int = 0, high: int = 100) -> int:
    return max(low, min(high, value))


def _extract_jd_keywords(jd: str, top_k: int = 24) -> list[str]:
    """从 JD 中提取关键词（中文 TF-IDF + 英文词频），按权重排序去重。"""
    candidates: list[tuple[str, float]] = []

    def _norm(kw: str) -> str:
        # 英文统一小写，避免 java/Java 重复
        return kw.strip().lower() if kw.strip().isascii() else kw.strip()

    for kw, weight in jieba.analyse.extract_tags(jd, topK=top_k * 2, withWeight=True):
        kw = _norm(kw)
        if kw and kw not in _STOPWORDS and not kw.isdigit() and kw[0] not in "或及其与和等":
            candidates.append((kw, weight))

    en_counts: dict[str, int] = {}
    for word in _EN_WORD.findall(jd):
        w = word.strip("./-").lower()
        if len(w) > 1 and w not in _STOPWORDS:
            en_counts[w] = en_counts.get(w, 0) + 1
    max_count = max(en_counts.values(), default=1)
    for w, c in en_counts.items():
        # 词频归一化到与 jieba 权重可比的量级（约 0.2 ~ 1.0）
        candidates.append((w, 0.2 + 0.8 * c / max_count))

    # 去重（保留权重高的）、保持权重排序
    seen: dict[str, float] = {}
    for kw, weight in candidates:
        seen[kw] = max(seen.get(kw, 0.0), weight)
    ranked = sorted(seen.items(), key=lambda x: x[1], reverse=True)

    # 合并被分词拆开的常见技术词（如 spring + boot → spring boot）
    jd_lower = jd.lower()
    words = [kw for kw, _ in ranked]
    for a, b in list(zip(words, words[1:])):
        if a.isascii() and b.isascii() and f"{a} {b}" in jd_lower:
            merged = f"{a} {b}"
            w = max(seen[a], seen[b])
            seen.pop(a, None); seen.pop(b, None)
            seen[merged] = w
            ranked = sorted(seen.items(), key=lambda x: x[1], reverse=True)

    return [kw for kw, _ in ranked[:top_k]]


def _keyword_in_text(kw: str, text_lower: str) -> bool:
    return (kw.lower() in text_lower) if kw.isascii() else (kw in text_lower)


# ---------------------------------------------------------------------------
# 引擎一：LLM 评估
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT = """\
你是一位资深的招聘专家和简历顾问，拥有 15 年科技行业与人力资源经验。
你将收到一份【岗位JD】和一份【简历】，请站在用人方视角，严格但建设性地评估这份简历与该岗位的匹配程度。

评估要求：
1. 优点：指出简历中与岗位强相关、有说服力的亮点（技能、经历、成果、表达方式等），必须引用简历中的具体依据。
2. 待优化点：指出差距与问题（缺失的关键能力、经历相关性弱、表达不量化、结构问题等），每条给出可直接执行的改进建议。
3. 维度评分：从「技能匹配」「经验相关性」「成果量化」「表达与结构」四个维度各打 0-100 分并一句话点评。
4. 关键词：从 JD 中提炼核心关键词，标注简历已覆盖/缺失的。
5. 总分：综合评估 0-100（切勿给中间值扎堆，该低就低）。
6. 改写示范：用 STAR 法则示范改写简历的个人简介/核心优势段落（120 字以内，中文）。

只输出一个合法 JSON 对象，不要包含 markdown 代码块标记或任何其他文字，结构如下：
{
  "overall_score": 0-100 整数,
  "verdict": "一句话总评（40字以内）",
  "dimensions": [{"name": "技能匹配", "score": 0-100, "comment": "一句话"}, ...共4项],
  "strengths": [{"title": "亮点标题", "detail": "具体依据与价值"}] (3-6条),
  "improvements": [{"title": "问题标题", "detail": "问题描述", "suggestion": "具体可执行的改进建议", "priority": "high|medium|low"}] (3-6条),
  "matched_keywords": ["..."],
  "missing_keywords": ["..."],
  "rewritten_summary": "改写示范文本"
}

JSON 格式硬性要求（违反会导致解析失败）：
- 字符串值内部不要使用英文双引号 "，如需引用词语请用中文引号「」；
- 不要出现尾随逗号（如 "high",] 这种 ] 或 } 前的逗号）；
- 所有字符串必须正确闭合。"""


def _fix_missing_commas(s: str) -> str:
    """补全值之间缺失的逗号：
    在值结束（" } ] 或数字）后紧跟新 token（" { [ 数字）时插入逗号，
    典型如数组两个元素间模型漏掉了逗号。"""
    out: list[str] = []
    i, n = 0, len(s)
    in_str = False
    prev = ""  # 上一个非空白字符
    had_space = False  # 当前 token 与前一 token 之间是否有空白（多位数内部无空白，不能误插逗号）
    while i < n:
        ch = s[i]
        if in_str:
            if ch == "\\" and i + 1 < n:  # 转义字符整体保留
                out.append(ch)
                out.append(s[i + 1])
                prev = s[i + 1]
                i += 2
                continue
            if ch == '"':
                in_str = False
            out.append(ch)
            prev = ch
        else:
            if ch in " \t\r\n":
                out.append(ch)
                had_space = True
                i += 1
                continue
            token_start = ch in '"{[' or ch.isdigit() or ch == "-"
            value_ended = prev in ('"', '}', ']') or prev.isdigit()
            if token_start and value_ended and had_space:
                out.append(",")
            if ch == '"':
                in_str = True
            out.append(ch)
            prev = ch
            had_space = False
        i += 1
    return "".join(out)


def _fix_inner_quotes(s: str) -> str:
    """修复字符串值内部未转义的双引号：
    在字符串内遇到 " 时，向后看第一个非空白字符——若为 , : } ] 之一则视为闭合引号，
    否则判定为值内部引用，转义处理。"""
    out: list[str] = []
    i, n = 0, len(s)
    in_str = False
    while i < n:
        ch = s[i]
        if not in_str:
            if ch == '"':
                in_str = True
            out.append(ch)
        else:
            if ch == "\\" and i + 1 < n:  # 已转义字符原样保留
                out.append(ch)
                out.append(s[i + 1])
                i += 1
            elif ch == '"':
                j = i + 1
                while j < n and s[j] in " \t\r\n":
                    j += 1
                if j >= n or s[j] in ",:}]":
                    in_str = False
                    out.append(ch)
                else:
                    out.append('\\"')
            else:
                out.append(ch)
        i += 1
    return "".join(out)


def _extract_json(raw: str) -> dict:
    """宽容地从模型输出中提取 JSON：
    剥离代码块围栏/前后杂文 → 直接解析 → 逐级尝试修复
    （尾随逗号 → 缺失逗号 → 值内未转义引号 → 组合修复）。"""
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("模型输出中未找到 JSON")
    candidate = text[start : end + 1]
    # 基础修复：去掉尾随逗号（"…",] 或 "…",}）
    no_trailing = re.sub(r",\s*([}\]])", r"\1", candidate)
    # 逐级尝试：原样 → 去尾逗号 → 补缺失逗号 → 转义值内引号 → 组合
    attempts = [
        candidate,
        no_trailing,
        _fix_missing_commas(no_trailing),
        _fix_inner_quotes(no_trailing),
        _fix_missing_commas(_fix_inner_quotes(no_trailing)),
    ]
    for attempt in attempts:
        try:
            return json.loads(attempt)
        except json.JSONDecodeError:
            continue
    raise ValueError("模型输出不是合法 JSON（已尝试自动修复仍失败），请重试")


def format_llm_http_error(status: int, body: str) -> str:
    """将上游 LLM 接口错误转成可读中文提示（兼容 OpenAI / Anthropic 两种错误体）。"""
    msg, code = "", ""
    try:
        err = json.loads(body).get("error", {})
        if isinstance(err, dict):
            msg = str(err.get("message", ""))
            code = str(err.get("code", ""))
    except Exception:  # noqa: BLE001
        pass
    if code == "1113" or "余额不足" in msg or "无可用资源包" in msg:
        return (
            "该模型在此端点余额不足或无可用资源包（智谱错误码 1113）："
            "若你使用 GLM Coding Plan 等套餐，请将 Base URL 改为 Anthropic 兼容端点 "
            "https://open.bigmodel.cn/api/anthropic；或改用免费模型（如 glm-4.5-flash），或充值后重试"
        )
    if status == 401:
        return "鉴权失败（401），请检查 API Key 是否正确"
    if status == 429:
        return "请求过于频繁（429 限流），请稍后重试"
    if status == 404:
        return "接口不存在（404），请检查 Base URL 是否为 OpenAI / Anthropic 兼容地址"
    return f"HTTP {status}：{(msg or body)[:200]}"


def _is_anthropic(base_url: str) -> bool:
    """识别 Anthropic 兼容端点（如智谱 GLM Coding Plan 使用的 /api/anthropic）。"""
    return "/anthropic" in base_url


async def chat_text(system: str, user: str, *, temperature: float = 0.3) -> str:
    """统一 LLM 调用入口：按 Base URL 自动适配 OpenAI 兼容 / Anthropic 兼容协议，返回文本。

    - OpenAI 兼容：POST {base}/chat/completions，Bearer 鉴权，取 choices[0].message.content
    - Anthropic 兼容：POST {base}/v1/messages，x-api-key 鉴权，拼接 content 中 type=text 的块
      （thinking 模型的思考块会被自动忽略）
    """
    cfg = config.get()
    if not cfg["base_url"] or not cfg["model"]:
        raise RuntimeError("AI 配置不完整（缺少 Base URL 或模型名称），请在右上角设置中补全")

    if _is_anthropic(cfg["base_url"]):
        payload = {
            "model": cfg["model"],
            "max_tokens": 16384,  # thinking 模型思考边占用输出预算，上限给足避免 JSON 被截断
            "temperature": temperature,
            "thinking": {"type": "disabled"},  # 结构化任务关闭深度思考：更快更省，避免思考耗尽预算
            "system": system,
            "messages": [{"role": "user", "content": user}],
        }
        headers = {"x-api-key": cfg["api_key"], "anthropic-version": "2023-06-01"}
        url = f"{cfg['base_url']}/v1/messages"
    else:
        payload = {
            "model": cfg["model"],
            "temperature": temperature,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }
        headers = {"Authorization": f"Bearer {cfg['api_key']}"}
        url = f"{cfg['base_url']}/chat/completions"

    async with httpx.AsyncClient(timeout=cfg["timeout"]) as client:
        resp = await client.post(url, json=payload, headers=headers)
    if resp.status_code != 200:
        raise RuntimeError(format_llm_http_error(resp.status_code, resp.text))
    data = resp.json()
    if _is_anthropic(cfg["base_url"]):
        return "".join(
            b.get("text", "") for b in data.get("content", []) if isinstance(b, dict) and b.get("type") == "text"
        )
    return data["choices"][0]["message"]["content"]


async def evaluate_with_llm(jd: str, resume: str) -> dict:
    raw = await chat_text(
        _SYSTEM_PROMPT,
        f"【岗位JD】\n{jd}\n\n【简历】\n{resume}",
        temperature=0.3,
    )
    result = _extract_json(raw)
    result["engine"] = "llm"
    result["overall_score"] = _clamp(int(round(float(result.get("overall_score", 60)))))
    return result


# ---------------------------------------------------------------------------
# 引擎二：本地启发式分析（无 API Key 时自动启用）
# ---------------------------------------------------------------------------

_SECTIONS = {
    "教育背景": ["教育", "学历", "大学", "学院", "本科", "硕士", "博士", "GPA", "毕业"],
    "工作经历": ["工作经历", "工作背景", "实习", "任职", "就职"],
    "项目经历": ["项目", "工程", "课题"],
    "技能清单": ["技能", "技术栈", "工具", "语言", "证书", "认证"],
}
_NUM = re.compile(r"\d+(?:\.\d+)?\s*[%％万wW千万亿]|[$￥€]\s?\d|\d{2,}")
_ACTION_VERBS = ["负责", "主导", "设计", "实现", "优化", "搭建", "开发", "落地", "推进", "达成", "提升", "降低", "重构", "量化"]


def evaluate_heuristic(jd: str, resume: str) -> dict:
    resume_lower = resume.lower()
    keywords = _extract_jd_keywords(jd)
    matched = [kw for kw in keywords if _keyword_in_text(kw, resume_lower)]
    missing = [kw for kw in keywords if kw not in matched]
    coverage = len(matched) / len(keywords) if keywords else 0.5

    nums = _NUM.findall(resume)
    bullets = len([ln for ln in resume.splitlines() if ln.strip().startswith(("-", "•", "·", "*", "•"))])
    verbs_hit = [v for v in _ACTION_VERBS if v in resume]
    sections_hit = [name for name, cues in _SECTIONS.items() if any(c in resume for c in cues)]
    has_contact = bool(re.search(r"1[3-9]\d{9}|[\w.+-]+@[\w-]+\.[\w.]+", resume))

    # --- 维度评分 ---
    skill_score = _clamp(round(28 + coverage * 65))  # 关键词覆盖主导
    years = re.findall(r"(\d+)\s*年", jd)
    exp_score = _clamp(round(60 if not years else 40 + coverage * 45))
    quant_density = len(nums) / max(len(resume) / 1000, 1)
    quant_score = _clamp(round(min(len(nums), 12) * 6 + min(bullets, 15) * 2))
    struct_score = _clamp(
        30
        + len(sections_hit) * 12
        + (12 if has_contact else 0)
        + min(len(verbs_hit), 8) * 2
    )

    dimensions = [
        {"name": "技能匹配", "score": skill_score, "comment": f"JD 核心关键词覆盖 {coverage:.0%}（命中 {len(matched)}/{len(keywords)}）"},
        {"name": "经验相关性", "score": exp_score, "comment": "基于关键词与经历信号的粗略估计" if not years else f"岗位对年限有要求（{'+'.join(sorted(set(years)))} 年），已结合覆盖度估算"},
        {"name": "成果量化", "score": quant_score, "comment": f"检测到 {len(nums)} 处量化数据、{bullets} 条要点式描述"},
        {"name": "表达与结构", "score": struct_score, "comment": f"识别到 {len(sections_hit)}/4 个标准模块" + ("，含联系方式" if has_contact else "，未见联系方式")},
    ]

    # --- 优点 ---
    strengths: list[dict] = []
    if matched:
        top = "、".join(matched[:8])
        strengths.append({"title": "岗位关键词覆盖良好", "detail": f"简历命中了 JD 中的核心关键词：{top}"})
    if len(nums) >= 5:
        strengths.append({"title": "成果有数据支撑", "detail": f"共 {len(nums)} 处量化表述（百分比/金额/规模），比纯定性描述更有说服力"})
    if bullets >= 6:
        strengths.append({"title": "要点式表达清晰", "detail": f"检测到 {bullets} 条要点（bullet），信息密度高、便于 HR 快速扫描"})
    if sections_hit:
        strengths.append({"title": "简历结构完整", "detail": f"包含 {'、'.join(sections_hit)} 等标准模块"})
    if not strengths:
        strengths.append({"title": "已提供基础信息", "detail": "简历内容可被正常解析；建议按下方优化建议补充岗位相关内容"})

    # --- 待优化点 ---
    improvements: list[dict] = []
    if missing:
        top_missing = "、".join(missing[:6])
        improvements.append({
            "title": "缺失 JD 核心关键词",
            "detail": f"以下 JD 关键词未在简历中出现：{top_missing}",
            "suggestion": "若你具备这些技能/经历，将其自然融入项目描述与技能清单；若不具备，优先补齐其中 1-2 项最核心的",
            "priority": "high",
        })
    if len(nums) < 3:
        improvements.append({
            "title": "量化表达不足",
            "detail": f"仅检测到 {len(nums)} 处量化数据，经历多为定性描述",
            "suggestion": "用「动作 + 对象 + 结果 + 数据」改写，如：优化查询逻辑，接口 P99 延迟从 800ms 降至 120ms",
            "priority": "high" if len(nums) == 0 else "medium",
        })
    if not has_contact:
        improvements.append({
            "title": "缺少联系方式",
            "detail": "未检测到手机号或邮箱",
            "suggestion": "在简历顶部添加手机号与常用邮箱，避免因无法联系而错失面试机会",
            "priority": "high",
        })
    missing_sections = [n for n in _SECTIONS if n not in sections_hit]
    if missing_sections:
        improvements.append({
            "title": "简历模块不完整",
            "detail": f"未识别到 {'、'.join(missing_sections)} 模块（或标题不常规）",
            "suggestion": "使用「教育背景 / 工作经历 / 项目经历 / 技能」等标准标题命名模块，便于 HR 与 ATS 系统解析",
            "priority": "low",
        })
    if len(resume) < 600:
        improvements.append({
            "title": "简历篇幅偏短",
            "detail": f"正文约 {len(resume)} 字符，信息量可能不足",
            "suggestion": "补充 1-2 段与目标岗位强相关的项目/实习经历，突出你的角色与贡献",
            "priority": "medium",
        })

    overall = _clamp(round(
        skill_score * 0.35 + exp_score * 0.25 + quant_score * 0.2 + struct_score * 0.2
    ))
    if overall >= 75:
        verdict = "匹配度较高，重点打磨细节即可冲刺面试"
    elif overall >= 55:
        verdict = "基本匹配，补齐关键差距后竞争力会明显提升"
    else:
        verdict = "与岗位存在明显差距，建议针对性重写相关经历"

    return {
        "engine": "heuristic",
        "overall_score": overall,
        "verdict": verdict,
        "dimensions": dimensions,
        "strengths": strengths[:6],
        "improvements": improvements[:6],
        "matched_keywords": matched[:16],
        "missing_keywords": missing[:12],
        "rewritten_summary": "",
        "notice": "当前为本地启发式分析（未配置 LLM_API_KEY）。配置 .env 后可获得逐句深度的 AI 评估与简介改写示范。",
    }
