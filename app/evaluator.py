"""评估引擎：LLM 深度评估（OpenAI / Anthropic 兼容协议）。

结果结构：
{
  "engine": "llm",
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

import asyncio
import json
import re

import httpx

from . import config

# ---------------------------------------------------------------------------
# 公共工具
# ---------------------------------------------------------------------------

# 发送给 LLM 的文本上限（字符）：防止超大文件（上传限制 10MB 的 TXT）把 prompt 撑爆
MAX_RESUME_CHARS = 24000
MAX_JD_CHARS = 8000


def cap_text(text: str, limit: int) -> tuple[str, bool]:
    """超长文本截断到 limit 字符，返回 (截断文本, 是否截断)。"""
    return (text, False) if len(text) <= limit else (text[:limit], True)


def _clamp(value: int, low: int = 0, high: int = 100) -> int:
    return max(low, min(high, value))


# ---------------------------------------------------------------------------
# 引擎一：LLM 评估
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT = """\
你是一位资深的招聘专家和简历顾问，拥有 15 年科技行业与人力资源经验。
你将收到一份【岗位JD】和一份【简历】，请站在用人方视角，严格但建设性地评估这份简历与该岗位的匹配程度。

评分导向（重要）：本次评估的核心是「专业技能与经历同岗位的适配度」——
技能是否对口、经验深度与广度是否满足、成果是否可验证。
文字呈现层面的格式问题（乱码与重复字符、错别字、日期格式错误、排版不规整、
技能罗列重复、模块命名不常规、基本信息重复冗余等）一律不得列入待优化点，也不得影响评分——评估看的是内容而非排版
（乱码与重复字符多来自文本提取或编码转换，不代表候选人能力）。
注意区分：内容可信度问题（经历时间线自相矛盾、年限与职级/项目规模明显不符、前后描述冲突等）
属于内容问题而非格式问题，可能暗示经历注水，应正常列入待优化点（priority 可为 high）并参与评分；
纯结构性混乱（模块顺序错乱导致主线无法阅读、整段大面积重复无法辨认）最多提 1 条，
优先级不高于 medium，且不得拖累总分：
若「技能匹配」「经验相关性」均 ≥80，总分不应低于 70。能力差距与可信度问题才是主要扣分项。

评估要求：
1. 优点：指出简历中与岗位强相关、有说服力的亮点（技能对口、经历相关、成果可验证等），必须引用简历中的具体依据。
2. 待优化点：以能力与岗位的适配差距为主（缺失的关键能力、经验相关性弱、方向不符、成果无量化依据等）；
   文字格式类问题（乱码/重复字符/错别字/排版等）一条都不要提，仅当结构逻辑严重混乱影响理解时才可提 1 条（优先级不高于 medium）；
   每条给出可直接执行的改进建议，并用 action 标注处理动作：
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
  "improvements": [{"title": "问题标题", "detail": "问题描述", "suggestion": "具体可执行的改进建议", "priority": "high|medium|low", "action": "改写|精简|删除|补充", "original_text": "简历原文摘录(无则空字符串)", "revised_text": "改写示范(无则空字符串)"}] (3-6条，全部为能力与岗位适配的差距或经历可信度问题，不列任何格式类问题，仅纯结构性混乱时允许 1 条),
  "matched_keywords": ["..."],
  "missing_keywords": ["..."],
  "rewritten_summary": "改写示范文本"
}

JSON 格式硬性要求（违反会导致解析失败）：
- 字符串值内部不要使用英文双引号 "，如需引用词语请用中文引号「」；
- 不要出现尾随逗号（如 "high",] 这种 ] 或 } 前的逗号）；
- 所有字符串必须正确闭合。"""


# 批量评估专用精简提示词：面试官榜单与只读摘要只需核心字段，
# 输出 token 约减半→单份时延近似减半（实测 33s → 5-10s 均摊，配合并发 4）
_BATCH_SYSTEM_PROMPT = """\
你是一位资深的招聘专家。你将收到一份【岗位JD】和一份【简历】，请站在用人方视角评估这份简历与该岗位的匹配程度。
评分导向：专业技能与经历同岗位的适配度为主（技能对口、经验深度、成果可验证，约八成权重）。
候选人评估只看内容：格式类问题（乱码与重复字符、错别字、日期错误、罗列重复、排版、基本信息重复冗余等）
完全不列入待优化点、不影响评分——乱码与重复字符多来自文本提取或编码转换，不代表候选人能力。
经历时间线自相矛盾、年限与职级/规模明显不符等可信度问题属于内容问题，应列入待优化点（priority 可为 high）并影响评分；
纯结构性混乱（模块顺序错乱导致主线无法阅读）最多提 1 条，优先级不高于 medium，不影响评分。

只输出一个合法 JSON 对象，不要包含 markdown 代码块标记或任何其他文字，结构如下：
{
  "overall_score": 0-100 整数,
  "verdict": "一句话总评（40字以内）",
  "dimensions": [{"name": "技能匹配", "score": 0-100, "comment": "一句话"}, {"name": "经验相关性", ...}, {"name": "成果量化", ...}, {"name": "表达与结构", ...}] 共4项,
  "strengths": [{"title": "亮点标题", "detail": "具体依据"}] 共3条,
  "improvements": [{"title": "问题标题", "detail": "问题描述", "priority": "high|medium|low", "action": "改写|精简|删除|补充"}] 共4条（全部为能力/经验/成果与岗位的差距或经历可信度问题，禁止出现任何格式类问题：乱码/重复字符/排版/基本信息重复等）,
  "matched_keywords": ["简历已覆盖的 JD 核心关键词"],
  "missing_keywords": ["简历缺失的 JD 核心关键词"]
}

JSON 格式硬性要求（违反会导致解析失败）：
- 字符串值内部不要使用英文双引号 "，如需引用词语请用中文引号「」；
- 不要出现尾随逗号（如 ] 或 } 前的逗号）；
- 所有字符串必须正确闭合；
- 总分切勿给中间值扎堆，该低就低。"""


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


# 瞬时错误：限流 / 服务端抖动，退避重试有意义；其余错误（鉴权/参数/路径）立即失败
_TRANSIENT_STATUS = {429, 500, 502, 503, 504}


async def _post_llm(client: httpx.AsyncClient, url: str, payload: dict, headers: dict) -> httpx.Response:
    """LLM 请求 + 瞬时错误自动重试（超时/网络错误/429/5xx 退避重试 2 次，其余立即抛出）。"""
    delay = 2.0
    for attempt in range(3):
        try:
            resp = await client.post(url, json=payload, headers=headers)
        except httpx.TimeoutException as exc:
            err = f"请求超时（{exc.__class__.__name__}）"
        except httpx.TransportError as exc:
            err = f"网络错误（{exc.__class__.__name__}）"
        else:
            if resp.status_code not in _TRANSIENT_STATUS:
                return resp
            err = format_llm_http_error(resp.status_code, resp.text)
        if attempt == 2:
            raise RuntimeError(f"{err}；已自动重试 {attempt} 次仍失败，可稍后再试")
        await asyncio.sleep(delay)
        delay *= 2.5
    raise AssertionError("unreachable")


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
            "max_tokens": 8192,  # 显式给足：服务端默认（常 4096）可能截断 JSON 导致解析失败
            "temperature": temperature,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }
        headers = {"Authorization": f"Bearer {cfg['api_key']}"}
        url = f"{cfg['base_url']}/chat/completions"

    async with httpx.AsyncClient(timeout=cfg["timeout"]) as client:
        resp = await _post_llm(client, url, payload, headers)
    if resp.status_code != 200:
        raise RuntimeError(format_llm_http_error(resp.status_code, resp.text))
    if "html" in resp.headers.get("content-type", "").lower():
        raise RuntimeError(
            f"接口返回的是网页而非 JSON（POST {url}）：Base URL 可能不完整"
            "（OpenAI 兼容地址通常以 /v1 结尾），或该地址是网关首页而非 API 地址"
        )
    try:
        data = resp.json()
    except ValueError:
        raise RuntimeError(f"接口返回内容无法解析为 JSON（POST {url}）：{resp.text[:120]}") from None
    if _is_anthropic(cfg["base_url"]):
        return "".join(
            b.get("text", "") for b in data.get("content", []) if isinstance(b, dict) and b.get("type") == "text"
        )
    return data["choices"][0]["message"]["content"]


async def evaluate_with_llm(jd: str, resume: str, lean: bool = False) -> dict:
    """评估简历：提供 JD 时做岗位匹配分析，留空时做无岗位的简历体检。

    lean=True 为批量评估专用精简模式：输出 token 减半→时延近似减半，
    仅包含榜单与只读摘要所需字段（无建议/原文对照/简介改写），
    评分口径与完整模式一致（技能适配度为主、格式不拖累总分）；
    且温度固定 0：批量场景要的是同一口径下稳定可比的评分，而非单份分析的多样性。
    """
    jd_text, jd_cut = cap_text(jd.strip(), MAX_JD_CHARS)
    resume_text, resume_cut = cap_text(resume, MAX_RESUME_CHARS)
    if jd_text:
        system = _BATCH_SYSTEM_PROMPT if lean else _SYSTEM_PROMPT
        user, mode = f"【岗位JD】\n{jd_text}\n\n【简历】\n{resume_text}", "match"
    else:
        system, user, mode = _REVIEW_SYSTEM_PROMPT, f"【简历】\n{resume_text}", "review"
    # 结构化输出偶发畸形（引号/逗号失误导致 JSON 解析失败），自动重试一次并微调温度换一个采样
    result = None
    last_err: ValueError | None = None
    base_temp = 0.0 if lean else 0.3
    for attempt in range(2):
        raw = await chat_text(system, user, temperature=base_temp if attempt == 0 else 0.5)
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
    if jd_cut or resume_cut:
        cuts = []
        if resume_cut:
            cuts.append(f"简历超过 {MAX_RESUME_CHARS} 字符，已截取前 {MAX_RESUME_CHARS} 字符评估")
        if jd_cut:
            cuts.append(f"岗位 JD 超过 {MAX_JD_CHARS} 字符，已截取前 {MAX_JD_CHARS} 字符")
        result["notice"] = f"{'；'.join(cuts)}。{result.get('notice', '')}".strip()
    return result


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
    resume_text, _ = cap_text(resume, MAX_RESUME_CHARS)
    result = None
    last_err: ValueError | None = None
    for attempt in range(2):
        raw = await chat_text(
            _JOB_RECOMMEND_PROMPT,
            f"【简历】\n{resume_text}",
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
