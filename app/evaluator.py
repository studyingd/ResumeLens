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
        if a not in seen or b not in seen:
            continue  # 已被此前的合并移除，跳过
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

评分导向（重要）：本次评估的核心是「专业技能与经历同岗位的适配度」——
技能是否对口、经验深度与广度是否满足、成果是否可验证。格式类问题（乱码与错别字、日期错误、
证书/技能罗列重复或分类混乱、排版不规整、模块命名不常规等）不作为评分依据：
- 待优化点中，格式类问题合计最多提 1 条，且优先级不得高于 medium；其余名额全部用于能力与岗位适配的差距
  （缺失的关键技能、经验深度不足、方向不符、成果缺乏依据等）。
- 总分与 verdict 不得因格式问题拉低：若「技能匹配」「经验相关性」均 ≥80，总分不应低于 70。
能力差距才是主要扣分项。

评估要求：
1. 优点：指出简历中与岗位强相关、有说服力的亮点（技能对口、经历相关、成果可验证等），必须引用简历中的具体依据。
2. 待优化点：以能力与岗位的适配差距为主（缺失的关键能力、经验相关性弱、方向不符、成果无量化依据等），
   格式类问题合计最多 1 条且优先级不高于 medium；每条给出可直接执行的改进建议，并用 action 标注处理动作：
   - 删除：完全重复或无信息量的内容应直接删掉
   - 精简：值得保留但需压缩合并
   - 补充：缺失的关键内容需要补上
   - 改写：信息有价值但表达方式有问题（无法归入前三类时使用）
   其中 original_text 与 revised_text 尽可能必填：只要问题能对应到简历中的具体内容（描述空泛、不量化、表达不当、信息模糊等），
   original_text 就必须逐字摘录简历中与该问题最相关的原句/要点（保持原文、单条不超过约 80 字），
   并在 revised_text 中给出对应的改写示范（动作+结果+数据，无真实数据时用 X%、N 次等占位符并保持可信）；
   仅当问题确实无法对应任何原文（如缺少某模块、缺失关键词）时，才允许两项均为空字符串。
   摘录原文时其中的英文双引号请替换为中文引号「」。
3. 维度评分：从「技能匹配」「经验相关性」「成果量化」「表达与结构」四个维度各打 0-100 分并一句话点评；
   前两个维度是核心，表达与结构仅反映可读性，不应拉低能力过硬者的总分。
4. 关键词：从 JD 中提炼核心关键词，标注简历已覆盖/缺失的。
5. 总分：综合评估 0-100（切勿给中间值扎堆，该低就低）；以技能匹配与经验相关性为主（约八成权重），
   格式问题最多轻微影响总分——技能过硬但排版欠佳的候选人不应因此被明显压分，反之亦然。
6. 改写示范：用 STAR 法则示范改写简历的个人简介/核心优势段落（120 字以内，中文）。

只输出一个合法 JSON 对象，不要包含 markdown 代码块标记或任何其他文字，结构如下：
{
  "overall_score": 0-100 整数,
  "verdict": "一句话总评（40字以内）",
  "dimensions": [{"name": "技能匹配", "score": 0-100, "comment": "一句话"}, ...共4项],
  "strengths": [{"title": "亮点标题", "detail": "具体依据与价值"}] (3-6条),
  "improvements": [{"title": "问题标题", "detail": "问题描述", "suggestion": "具体可执行的改进建议", "priority": "high|medium|low", "action": "改写|精简|删除|补充", "original_text": "简历原文摘录（无则空字符串）", "revised_text": "改写示范（无则空字符串）"}] (3-6条),
  "matched_keywords": ["..."],
  "missing_keywords": ["..."],
  "rewritten_summary": "改写示范文本"
}

JSON 格式硬性要求（违反会导致解析失败）：
- 字符串值内部不要使用英文双引号 "，如需引用词语请用中文引号「」；
- 不要出现尾随逗号（如 "high",] 这种 ] 或 } 前的逗号）；
- 所有字符串必须正确闭合。"""


_REVIEW_SYSTEM_PROMPT = """\
你是一位资深的招聘专家和简历顾问，拥有 15 年科技行业与人力资源经验。
你将只收到一份【简历】，没有目标岗位 JD。请站在招聘方视角，对这份简历做一次「内容为王」的深度体检：
简历的核心是内容（做了什么、难度与规模、成果与影响、成长轨迹），格式与结构只是外壳——
评估与建议必须以内容为主，格式问题仅在明显影响阅读时才提。

评估要求：
1. 内容优先评估：
   - 经历含金量：事情的难度、负责范围与独立性（主导还是参与）、技术/业务复杂度
   - 成果与量化：有没有可验证的数据与业务影响
   - 聚焦与一致性：职业主线是否清晰，技能与经历是否互相支撑，有无偏离主线的凑数内容
   - 成长轨迹：职责与负责范围是否随时间递进
2. 冗余治理（重点）：逐段检查内容重复与冗余——同一职责在不同模块反复出现、技能清单与项目描述重复罗列、
   空话套话（如「负责日常开发工作」类无信息量描述）、与职业方向无关的凑数经历。
   对每处问题用 action 字段明确标注处理动作：
   - 删除：完全重复或无信息量的内容应直接删掉
   - 精简：值得保留但需压缩合并（几处相近表述合并为一处）
   - 补充：缺失的关键内容需要补上（量化数据、项目背景与个人角色等）
   - 改写：信息有价值但表达方式有问题（无法归入前三类时使用）
3. 优点：指出内容层面真正有说服力的亮点（有含金量的经历、可验证的成果、清晰的成长），必须引用简历中的具体依据。
4. 维度评分：从「经历含金量」「成果量化」「聚焦与一致性」「表达与结构」四个维度各打 0-100 分并一句话点评；
   总分以内容维度为主（约八成权重），格式仅轻微影响——内容强而格式糙的简历不应被打低分，反之亦然。
5. 关键词：从简历中提炼已呈现的核心技能关键词放入 matched_keywords；再基于其经历推断职业方向，在 missing_keywords 中列出 2-6 个值得补充的技能/关键词方向。
6. 改写示范：用 STAR 法则示范改写简历的个人简介/核心优势段落（120 字以内，中文）。

其中待优化项的 original_text 与 revised_text 尽可能必填：只要问题能对应到简历中的具体内容（描述空泛、不量化、
重复冗余、表达不当、信息模糊等），original_text 就必须逐字摘录简历中与该问题最相关的原句/要点（保持原文、
单条不超过约 80 字），并在 revised_text 中给出对应的处理示范（删除类可给删除后的替代表述，精简类给压缩后版本，
改写类给动作+结果+数据的版本，无真实数据时用 X%、N 次等占位符并保持可信）；
仅当问题确实无法对应任何原文（如缺少某模块）时，才允许两项均为空字符串。
摘录原文时其中的英文双引号请替换为中文引号「」。

只输出一个合法 JSON 对象，不要包含 markdown 代码块标记或任何其他文字，结构如下：
{
  "overall_score": 0-100 整数,
  "verdict": "一句话总评（40字以内）",
  "dimensions": [{"name": "经历含金量", "score": 0-100, "comment": "一句话"}, ...共4项],
  "strengths": [{"title": "亮点标题", "detail": "具体依据与价值"}] (3-6条),
  "improvements": [{"title": "问题标题", "detail": "问题描述", "suggestion": "具体可执行的改进建议", "priority": "high|medium|low", "action": "改写|精简|删除|补充", "original_text": "简历原文摘录（无则空字符串）", "revised_text": "处理示范（无则空字符串）"}] (3-6条),
  "matched_keywords": ["简历中呈现的核心技能关键词"],
  "missing_keywords": ["建议补充的技能/关键词方向"],
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
    """评估简历：提供 JD 时做岗位匹配分析，留空时做无岗位的简历体检。"""
    if jd.strip():
        system, user, mode = _SYSTEM_PROMPT, f"【岗位JD】\n{jd}\n\n【简历】\n{resume}", "match"
    else:
        system, user, mode = _REVIEW_SYSTEM_PROMPT, f"【简历】\n{resume}", "review"
    # 结构化输出偶发畸形（引号/逗号失误导致 JSON 解析失败），自动重试一次并微调温度换一个采样
    result = None
    last_err: ValueError | None = None
    for attempt in range(2):
        raw = await chat_text(system, user, temperature=0.3 if attempt == 0 else 0.5)
        try:
            result = _extract_json(raw)
            break
        except ValueError as exc:
            last_err = exc
    if result is None:
        raise last_err  # type: ignore[misc]
    result["engine"] = "llm"
    result["mode"] = mode
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
# 含金量信号：体现主导性与独立负责范围的强动词（体检模式的「经历含金量」维度使用）
_STRONG_VERBS = ["主导", "独立", "牵头", "架构", "从0", "从 0", "搭建", "负责", "带领", "培养"]


def evaluate_heuristic(jd: str, resume: str) -> dict:
    jd = jd.strip()
    resume_lower = resume.lower()
    keywords = _extract_jd_keywords(jd) if jd else []
    matched = [kw for kw in keywords if _keyword_in_text(kw, resume_lower)]
    missing = [kw for kw in keywords if kw not in matched]
    coverage = (len(matched) / len(keywords)) if keywords else 0.0
    has_jd = bool(keywords)

    nums = _NUM.findall(resume)
    bullets = len([ln for ln in resume.splitlines() if ln.strip().startswith(("-", "•", "·", "*", "•"))])
    verbs_hit = [v for v in _ACTION_VERBS if v in resume]
    sections_hit = [name for name, cues in _SECTIONS.items() if any(c in resume for c in cues)]
    has_contact = bool(re.search(r"1[3-9]\d{9}|[\w.+-]+@[\w-]+\.[\w.]+", resume))
    # 行级重复检测：同一行（去符号后≥8字）出现≥2次视为内容冗余
    line_counts: dict[str, int] = {}
    for ln in resume.splitlines():
        key = ln.strip(" -•·*\t")
        if len(key) >= 8:
            line_counts[key] = line_counts.get(key, 0) + 1
    dup_lines = [k for k, c in line_counts.items() if c >= 2]

    quant_score = _clamp(round(min(len(nums), 12) * 6 + min(bullets, 15) * 2))
    struct_score = _clamp(
        30
        + len(sections_hit) * 12
        + (12 if has_contact else 0)
        + min(len(verbs_hit), 8) * 2
    )

    # --- 维度评分 ---
    if has_jd:
        skill_score = _clamp(round(28 + coverage * 65))  # 关键词覆盖主导
        years = re.findall(r"(\d+)\s*年", jd)
        exp_score = _clamp(round(60 if not years else 40 + coverage * 45))
        dimensions = [
            {"name": "技能匹配", "score": skill_score, "comment": f"JD 核心关键词覆盖 {coverage:.0%}（命中 {len(matched)}/{len(keywords)}）"},
            {"name": "经验相关性", "score": exp_score, "comment": "基于关键词与经历信号的粗略估计" if not years else f"岗位对年限有要求（{'+'.join(sorted(set(years)))} 年），已结合覆盖度估算"},
            {"name": "成果量化", "score": quant_score, "comment": f"检测到 {len(nums)} 处量化数据、{bullets} 条要点式描述"},
            {"name": "表达与结构", "score": struct_score, "comment": f"识别到 {len(sections_hit)}/4 个标准模块" + ("，含联系方式" if has_contact else "，未见联系方式")},
        ]
    else:
        # 简历体检模式：无 JD，内容为王——含金量与量化优先，格式结构降权
        # 提取简历自身技能关键词前先剔除联系方式，避免邮箱/手机号被当作关键词
        resume_for_kw = re.sub(r"[\w.+-]+@[\w-]+\.[\w.]+|1[3-9]\d{9}", " ", resume)
        resume_kws = _extract_jd_keywords(resume_for_kw, top_k=16)
        matched = resume_kws  # 以简历自身技能关键词作为「已呈现」
        missing = []
        # 含金量：强动词（主导/独立/架构…）+ 量化数据密度，内容信号优先
        strong_hits = [v for v in _STRONG_VERBS if v in resume]
        content_score = _clamp(round(28 + len(strong_hits) * 7 + min(len(nums), 10) * 3))
        focus_score = _clamp(round(30 + min(len(resume_kws), 16) * 4))
        dimensions = [
            {"name": "经历含金量", "score": content_score, "comment": f"强动作动词命中 {len(strong_hits)} 个、量化数据 {len(nums)} 处，主导性与成果密度越高含金量越足"},
            {"name": "成果量化", "score": quant_score, "comment": f"检测到 {len(nums)} 处量化数据、{bullets} 条要点式描述"},
            {"name": "聚焦与一致性", "score": focus_score, "comment": f"识别到 {len(resume_kws)} 个技能/领域关键词，主线越聚焦一致性越好"},
            {"name": "表达与结构", "score": struct_score, "comment": f"识别到 {len(sections_hit)}/4 个标准模块" + ("，含联系方式" if has_contact else "，未见联系方式") + f"，动作动词命中 {len(verbs_hit)} 个"},
        ]

    # --- 优点 ---
    strengths: list[dict] = []
    if has_jd and matched:
        top = "、".join(matched[:8])
        strengths.append({"title": "岗位关键词覆盖良好", "detail": f"简历命中了 JD 中的核心关键词：{top}"})
    elif not has_jd and len(matched) >= 8:
        top = "、".join(matched[:8])
        strengths.append({"title": "技能方向清晰", "detail": f"简历呈现出明确的技能关键词：{top}"})
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
    if dup_lines:
        dup_preview = "、".join(f"「{d[:20]}」" for d in dup_lines[:3])
        improvements.append({
            "title": "存在重复内容",
            "detail": f"以下内容在简历中重复出现：{dup_preview}，浪费篇幅且显得未经整理",
            "suggestion": "完全重复的条目只保留最相关的一处（其余删除）；若几处表述相近但侧重不同，合并精简为一句话",
            "priority": "medium",
            "action": "精简",
            "original_text": dup_lines[0][:120],
            "revised_text": "（保留最相关一处、删除其余；若侧重不同可合并为）主导 ××，兼顾 ××，使 ×× 提升 X%",
        })
    if has_jd and missing:
        top_missing = "、".join(missing[:6])
        improvements.append({
            "title": "缺失 JD 核心关键词",
            "detail": f"以下 JD 关键词未在简历中出现：{top_missing}",
            "suggestion": "若你具备这些技能/经历，将其自然融入项目描述与技能清单；若不具备，优先补齐其中 1-2 项最核心的",
            "priority": "high",
            "action": "补充",
        })
    if len(nums) < 3:
        # 引用首条无量化的要点作为原文对照，并给出改写结构示范
        first_plain = next(
            (ln.strip(" -•·*\t") for ln in resume.splitlines()
             if ln.strip().startswith(("-", "•", "·", "*")) and not _NUM.search(ln)),
            "",
        )
        improvements.append({
            "title": "量化表达不足",
            "detail": f"仅检测到 {len(nums)} 处量化数据，经历多为定性描述",
            "suggestion": "用「动作 + 对象 + 结果 + 数据」改写，如：优化查询逻辑，接口 P99 延迟从 800ms 降至 120ms",
            "priority": "high" if len(nums) == 0 else "medium",
            "action": "改写",
            "original_text": first_plain[:120],
            "revised_text": (
                "（按此结构改写上条原文）主导/负责 ××，通过 ×× 方法，使 ×× 指标提升 X%（请替换为真实数据）"
                if first_plain else ""
            ),
        })
    if not has_contact:
        improvements.append({
            "title": "缺少联系方式",
            "detail": "未检测到手机号或邮箱",
            "suggestion": "在简历顶部添加手机号与常用邮箱，避免因无法联系而错失面试机会",
            "priority": "high",
            "action": "补充",
        })
    missing_sections = [n for n in _SECTIONS if n not in sections_hit]
    if missing_sections:
        improvements.append({
            "title": "简历模块不完整",
            "detail": f"未识别到 {'、'.join(missing_sections)} 模块（或标题不常规）",
            "suggestion": "使用「教育背景 / 工作经历 / 项目经历 / 技能」等标准标题命名模块，便于 HR 与 ATS 系统解析",
            "priority": "low",
            "action": "补充",
        })
    if len(resume) < 600:
        improvements.append({
            "title": "简历篇幅偏短",
            "detail": f"正文约 {len(resume)} 字符，信息量可能不足",
            "suggestion": "补充 1-2 段与目标方向强相关的项目/实习经历，突出你的角色与贡献",
            "priority": "medium",
            "action": "补充",
        })

    if has_jd:
        overall = _clamp(round(
            skill_score * 0.35 + exp_score * 0.25 + quant_score * 0.2 + struct_score * 0.2
        ))
        if overall >= 75:
            verdict = "匹配度较高，重点打磨细节即可冲刺面试"
        elif overall >= 55:
            verdict = "基本匹配，补齐关键差距后竞争力会明显提升"
        else:
            verdict = "与岗位存在明显差距，建议针对性重写相关经历"
        notice = "当前为本地启发式分析（未配置 LLM_API_KEY）。配置 .env 后可获得逐句深度的 AI 评估与简介改写示范。"
    else:
        # 内容为主（含金量+量化+聚焦约 85%），格式结构仅占 15%
        overall = _clamp(round(
            content_score * 0.3 + quant_score * 0.3 + focus_score * 0.25 + struct_score * 0.15
        ))
        if overall >= 75:
            verdict = "简历质量较高，微调细节即可放心投递"
        elif overall >= 55:
            verdict = "简历基础尚可，按建议逐项优化后竞争力会明显提升"
        else:
            verdict = "简历存在较多短板，建议对照下方建议逐条改写"
        notice = (
            "未提供岗位 JD，本次为简历通用体检。粘贴目标岗位 JD 后重新分析，可获得匹配度评分与岗位关键词对照。"
            "当前为本地启发式分析（未配置 LLM_API_KEY），配置后可获得逐句深度的 AI 体检与简介改写示范。"
        )

    return {
        "engine": "heuristic",
        "mode": "match" if has_jd else "review",
        "overall_score": overall,
        "verdict": verdict,
        "dimensions": dimensions,
        "strengths": strengths[:6],
        "improvements": improvements[:6],
        "matched_keywords": matched[:16],
        "missing_keywords": missing[:12],
        "rewritten_summary": "",
        "notice": notice,
    }


# ---------------------------------------------------------------------------
# 岗位推荐（体检后：推荐岗位方向 + 各招聘平台搜索关键词）
# 注：主流招聘平台均无公开职位搜索 API，本功能推荐「岗位方向 + 精准搜索词」，
#     由前端生成各平台搜索直达链接，合规且不依赖爬取。
# ---------------------------------------------------------------------------

_JOB_RECOMMEND_PROMPT = """\
你是一位资深的职业顾问和猎头，熟悉国内主流招聘平台（BOSS直聘、智联招聘、前程无忧、猎聘等）的职位命名习惯。
你将收到一份【简历】，请基于其技能、经历与职业阶段，推荐最合适的求职岗位方向，
用于求职者在招聘平台精准搜索与投递。

要求：
1. positions：推荐 3-5 个岗位方向，按匹配度从高到低排序：
   - title：使用招聘平台常见的职位命名（如「Python 后端开发工程师」「电商产品经理」），不要自造生僻头衔；
   - industry：所属行业/业务方向（如 互联网/电商/金融科技）；
   - level：按简历阶段推断（如 应届生 / 1-3年 / 3-5年 / 5年以上）；
   - salary_range：该方向的市场参考区间（如 15-25K·14薪），不确定则留空字符串；
   - match_reason：为什么适合，必须引用简历中的具体依据；跨方向推荐需说明可行性；
   - search_keywords：1-3 组适合在招聘平台搜索的关键词（不含城市名）；
   - cities：依据简历地域线索与行业分布推荐 2-3 个城市，无依据则留空数组。
2. gap_skills：为扩大岗位选择面，建议补齐的 2-4 项技能/证书/经历。
3. 不要虚构简历中不存在的经历。

只输出一个合法 JSON 对象，不要包含 markdown 代码块标记或任何其他文字，结构如下：
{
  "positions": [{"title": "...", "industry": "...", "level": "...", "salary_range": "...", "match_reason": "...", "search_keywords": ["..."], "cities": ["..."]}] (3-5项),
  "gap_skills": ["..."]
}

JSON 格式硬性要求（违反会导致解析失败）：
- 字符串值内部不要使用英文双引号 "，如需引用词语请用中文引号「」；
- 不要出现尾随逗号（如 ] 或 } 前的逗号）；
- 所有字符串必须正确闭合。"""


async def recommend_jobs_llm(resume: str) -> dict:
    """LLM 岗位方向推荐（与评估同源的解析与重试机制）。"""
    result = None
    last_err: ValueError | None = None
    for attempt in range(2):
        raw = await chat_text(
            _JOB_RECOMMEND_PROMPT,
            f"【简历】\n{resume}",
            temperature=0.4 if attempt == 0 else 0.6,
        )
        try:
            result = _extract_json(raw)
            break
        except ValueError as exc:
            last_err = exc
    if result is None:
        raise last_err  # type: ignore[misc]
    result["engine"] = "llm"
    result["positions"] = (result.get("positions") or [])[:5]
    result["gap_skills"] = (result.get("gap_skills") or [])[:4]
    return result


# 本地规则引擎：关键词特征 → 岗位方向（英文 cue 按词边界匹配，避免 go/django 类误命中）
_JOB_ROLES: list[dict] = [
    {"role": "Python 后端开发工程师", "industry": "互联网/软件", "cues": ["python", "flask", "django", "fastapi", "tornado"]},
    {"role": "Java 后端开发工程师", "industry": "互联网/软件", "cues": ["java", "spring", "mybatis", "jvm"]},
    {"role": "Go 后端开发工程师", "industry": "互联网/软件", "cues": ["golang", "go 语言", "gin", "etcd"]},
    {"role": "前端开发工程师", "industry": "互联网/软件", "cues": ["javascript", "typescript", "vue", "react", "html", "css", "webpack", "前端"]},
    {"role": "算法工程师", "industry": "互联网/AI", "cues": ["机器学习", "深度学习", "pytorch", "tensorflow", "nlp", "大模型", "算法"]},
    {"role": "数据分析师", "industry": "通用", "cues": ["数据分析", "tableau", "powerbi", "sql", "bi", "数据挖掘"]},
    {"role": "大数据开发工程师", "industry": "互联网/数据", "cues": ["hadoop", "spark", "flink", "hive", "数据仓库", "大数据"]},
    {"role": "测试开发工程师", "industry": "互联网/软件", "cues": ["测试", "selenium", "pytest", "jmeter", "自动化测试"]},
    {"role": "运维/SRE 工程师", "industry": "互联网/软件", "cues": ["linux", "kubernetes", "k8s", "docker", "运维", "terraform", "prometheus"]},
    {"role": "移动端开发工程师", "industry": "互联网/软件", "cues": ["android", "ios", "flutter", "react native", "安卓", "移动端"]},
    {"role": "产品经理", "industry": "互联网", "cues": ["产品经理", "需求分析", "prd", "axure", "竞品分析"]},
    {"role": "UI/UX 设计师", "industry": "互联网", "cues": ["ui设计", "ux", "交互设计", "figma", "视觉设计"]},
    {"role": "运营专员", "industry": "互联网", "cues": ["运营", "用户增长", "新媒体", "内容运营", "活动策划"]},
]


def _cue_hit(cue: str, text_lower: str) -> bool:
    """特征词命中：英文按词边界（防 django 含 go 这类误命中），中文按子串。"""
    if cue.isascii():
        return re.search(rf"(?<![a-z0-9]){re.escape(cue)}(?![a-z0-9])", text_lower) is not None
    return cue in text_lower


def recommend_jobs_heuristic(resume: str) -> dict:
    """本地岗位方向推荐：按简历关键词特征命中岗位角色表。"""
    resume_lower = resume.lower()
    resume_for_kw = re.sub(r"[\w.+-]+@[\w-]+\.[\w.]+|1[3-9]\d{9}", " ", resume)
    resume_kws = _extract_jd_keywords(resume_for_kw, top_k=12)

    hits: list[tuple[int, dict, list[str]]] = []
    for role in _JOB_ROLES:
        cue_hits = [c for c in role["cues"] if _cue_hit(c, resume_lower)]
        if cue_hits:
            hits.append((len(cue_hits), role, cue_hits))
    hits.sort(key=lambda x: -x[0])

    positions: list[dict] = []
    for _score, role, cue_hits in hits[:4]:
        en_cues = [c for c in cue_hits if c.isascii()][:3]
        keywords = [role["role"]]
        if en_cues:
            keywords.append(" ".join(en_cues))
        positions.append({
            "title": role["role"],
            "industry": role["industry"],
            "level": "",
            "salary_range": "",
            "match_reason": f"简历中出现 {'、'.join(cue_hits[:4])} 等相关技能/经历信号",
            "search_keywords": keywords,
            "cities": [],
        })

    if not positions and resume_kws:
        # 兜底：未命中角色表时用简历最强关键词拼搜索方向
        positions.append({
            "title": f"{resume_kws[0]} 相关岗位",
            "industry": "",
            "level": "",
            "salary_range": "",
            "match_reason": f"未匹配到明确的岗位角色，建议以简历核心关键词「{resume_kws[0]}」在招聘平台搜索",
            "search_keywords": [resume_kws[0]],
            "cities": [],
        })

    return {
        "engine": "heuristic",
        "positions": positions,
        "gap_skills": [],
        "notice": "当前为本地规则推荐（未配置 LLM_API_KEY），配置 AI 后可获得结合职业阶段的薪资参考与跨方向推荐。",
    }
