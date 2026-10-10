"""FastAPI 服务：静态页面 + 评估接口。"""

from __future__ import annotations

import asyncio
import html
import re
import time
import uuid
from pathlib import Path

import httpx
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import config
from .evaluator import (
    evaluate_heuristic,
    evaluate_with_llm,
    recommend_jobs_heuristic,
    recommend_jobs_llm,
)
from .interview import (
    generate_questions_llm,
    guess_candidate_name,
    questions_heuristic,
    regen_question_heuristic,
    regen_question_llm,
)
from .parser import extract_text

app = FastAPI(title="ResumeLens", docs_url=None, redoc_url=None)

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
RESUME_STORE_DIR = Path(__file__).resolve().parent.parent / "resume_store"
RESUME_STORE_DIR.mkdir(exist_ok=True)


class NoCacheStaticFiles(StaticFiles):
    """静态资源强制浏览器每次再验证：不带 Cache-Control 时浏览器会启发式缓存 JS/CSS，
    导致改版后页面仍执行旧脚本（配合 ETag，内容未变时仅返回 304，开销很小）。"""

    def file_response(self, *args, **kwargs):  # type: ignore[override]
        resp = super().file_response(*args, **kwargs)
        resp.headers["Cache-Control"] = "no-cache"
        return resp


class LLMConfigBody(BaseModel):
    api_key: str = ""
    base_url: str = ""
    model: str = ""


def _normalize_result(result: dict) -> dict:
    """统一兑底字段：待优化点的处理动作与原文/改写示范缺失时补空串，前端据此决定展示。"""
    for it in result.get("improvements") or []:
        if isinstance(it, dict):
            it.setdefault("action", "")
            it.setdefault("original_text", "")
            it.setdefault("revised_text", "")
    return result


# 部分 OpenAI 兼容服务（如智谱 GLM）只提供 chat/completions、不提供 /models 列表接口，
# 此时按域名回退到内置的常用模型建议（仍可手动输入任意模型名）。
_PROVIDER_MODEL_SUGGESTIONS: list[tuple[str, str, list[str]]] = [
    (
        "bigmodel.cn",
        "智谱 GLM",
        [
            "glm-4.6", "glm-4.5", "glm-4.5-air", "glm-4.5-flash",
            "glm-4-plus", "glm-4-air", "glm-4-flash", "glm-4-long",
            "glm-4v-plus", "glm-4v-flash",
        ],
    ),
]


class QuestionsBody(BaseModel):
    jd: str
    resume: str


class JobRecommendBody(BaseModel):
    resume: str


class ResumeFilesDeleteBody(BaseModel):
    file_ids: list[str]


class QuestionRegenBody(BaseModel):
    jd: str
    resume: str
    question: str
    category: str = ""
    others: list[str] = []


MAX_BATCH_FILES = 20
RESUME_PREVIEW_CAP = 12000  # 返回给前端的简历文本上限（面试题生成复用，避免重复上传）
RESUME_FILE_TTL = 7 * 86400  # 附件保留 7 天：超期孤儿文件在批量评估时惰性清理（前端主动删除为第一优先）

_FILE_ID_RE = re.compile(r"^[0-9a-f]{32}\.(pdf|docx|txt|md)$")


def _cleanup_expired_resume_files() -> None:
    """清理超过保留期的附件（前端未通知删除时的兜底，随批量评估触发一次）。"""
    now = time.time()
    try:
        for p in RESUME_STORE_DIR.iterdir():
            try:
                if now - p.stat().st_mtime > RESUME_FILE_TTL:
                    p.unlink()
            except OSError:
                pass
    except OSError:
        pass


def _store_resume_file(filename: str, data: bytes) -> str:
    """将上传的简历原件存入本地仓库，返回 file_id（供详情弹窗内嵌预览）。"""
    ext = Path(filename).suffix.lower()
    if ext not in config.ALLOWED_EXTENSIONS:
        return ""
    file_id = f"{uuid.uuid4().hex}{ext}"
    try:
        (RESUME_STORE_DIR / file_id).write_bytes(data)
        return file_id
    except OSError:
        return ""  # 存储失败不影响评估主流程


@app.get("/api/health")
async def health() -> dict:
    cfg = config.get()
    return {
        "ok": True,
        "engine": "llm" if config.llm_enabled() else "heuristic",
        "model": cfg["model"] if config.llm_enabled() else None,
        "source": config.source(),
        "base_url": cfg["base_url"],
        "api_key_masked": config.masked_key(),
    }


@app.get("/api/config")
async def get_config() -> dict:
    """设置弹窗预填：脱敏后的当前配置。"""
    cfg = config.get()
    return {
        "engine": "llm" if config.llm_enabled() else "heuristic",
        "source": config.source(),
        "base_url": cfg["base_url"],
        "model": cfg["model"],
        "api_key_masked": config.masked_key(),
    }


@app.post("/api/config/test")
async def test_config(body: LLMConfigBody) -> JSONResponse:
    """用提交的凭据发起一次最小调用，验证连通性（不保存；Key 留空则用已保存的）。"""
    current = config.get()
    api_key = body.api_key.strip() or (current["api_key"] if current["api_key"] else "")
    base_url = config.normalize_base_url(body.base_url.strip() or current["base_url"])
    model = body.model.strip() or current["model"]
    if not api_key:
        return JSONResponse(status_code=422, content={"ok": False, "message": "请先填写 API Key"})
    if not base_url:
        return JSONResponse(status_code=422, content={"ok": False, "message": "请填写 API Base URL 后再测试"})
    if not model:
        return JSONResponse(status_code=422, content={"ok": False, "message": "请填写模型名称后再测试（可点击输入框从列表选择）"})
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            if "/anthropic" in base_url:
                # Anthropic 兼容端点（如智谱 GLM Coding Plan）：/v1/messages + x-api-key
                resp = await client.post(
                    f"{base_url}/v1/messages",
                    headers={"x-api-key": api_key, "anthropic-version": "2023-06-01"},
                    json={"model": model, "max_tokens": 4, "messages": [{"role": "user", "content": "ping"}]},
                )
            else:
                resp = await client.post(
                    f"{base_url}/chat/completions",
                    headers={"Authorization": f"Bearer {api_key}"},
                    json={
                        "model": model,
                        "messages": [{"role": "user", "content": "ping"}],
                        "max_tokens": 4,
                        "stream": False,
                    },
                )
    except httpx.TimeoutException:
        return JSONResponse(status_code=502, content={"ok": False, "message": "连接超时，请检查 Base URL 与网络"})
    except httpx.HTTPError as exc:
        return JSONResponse(status_code=502, content={"ok": False, "message": f"连接失败：{exc}"})
    if resp.status_code == 401:
        return JSONResponse(status_code=502, content={"ok": False, "message": "鉴权失败（401），请检查 API Key 是否正确"})
    if resp.status_code == 404:
        return JSONResponse(status_code=502, content={"ok": False, "message": "接口不存在（404），请检查 Base URL 是否为 OpenAI 兼容地址"})
    if resp.status_code != 200:
        detail = ""
        try:
            detail = str(resp.json().get("error", {}).get("message", ""))[:200]
        except Exception:  # noqa: BLE001
            pass
        return JSONResponse(
            status_code=502,
            content={"ok": False, "message": f"接口返回 {resp.status_code}{('：' + detail) if detail else ''}"},
        )
    if "html" in resp.headers.get("content-type", "").lower():
        return JSONResponse(
            status_code=502,
            content={
                "ok": False,
                "message": "接口返回的是网页而非 JSON：Base URL 可能不完整"
                "（OpenAI 兼容地址通常以 /v1 结尾，如 http://主机:端口/v1），或该地址是网关首页",
            },
        )
    try:
        replied = resp.json()["choices"][0]["message"]["content"]
    except Exception:  # noqa: BLE001
        replied = ""
    if "/anthropic" in base_url:
        try:
            replied = "".join(
                b.get("text", "")
                for b in resp.json().get("content", [])
                if isinstance(b, dict) and b.get("type") == "text"
            )
        except Exception:  # noqa: BLE001
            replied = ""
    return {"ok": True, "message": f"连接成功，模型「{model}」响应正常"}


@app.post("/api/config/models")
async def list_models(body: LLMConfigBody) -> JSONResponse:
    """拉取 OpenAI 兼容接口的模型列表（Key 留空则用已保存的）。"""
    current = config.get()
    api_key = body.api_key.strip() or (current["api_key"] if current["api_key"] else "")
    base_url = config.normalize_base_url(body.base_url.strip() or current["base_url"])
    if not api_key:
        return JSONResponse(status_code=422, content={"ok": False, "message": "请先填写 API Key"})
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            if "/anthropic" in base_url:
                resp = await client.get(
                    f"{base_url}/v1/models",
                    headers={"x-api-key": api_key, "anthropic-version": "2023-06-01"},
                )
            else:
                resp = await client.get(f"{base_url}/models", headers={"Authorization": f"Bearer {api_key}"})
    except httpx.TimeoutException:
        return JSONResponse(status_code=502, content={"ok": False, "message": "连接超时，请检查 Base URL 与网络"})
    except httpx.HTTPError as exc:
        return JSONResponse(status_code=502, content={"ok": False, "message": f"连接失败：{exc}"})
    if resp.status_code == 401:
        return JSONResponse(status_code=502, content={"ok": False, "message": "鉴权失败（401），请检查 API Key 是否正确"})

    models: list[str] = []
    if resp.status_code == 200:
        try:
            data = resp.json()
            models = sorted(
                str(m["id"])
                for m in data.get("data", [])
                if isinstance(m, dict) and m.get("id")
            )
        except Exception:  # noqa: BLE001
            models = []

    if not models:
        # 服务不提供 /models（如智谱 GLM）→ 静默回退到常用模型建议
        for host_key, _provider, suggestions in _PROVIDER_MODEL_SUGGESTIONS:
            if host_key in base_url:
                return {"ok": True, "models": suggestions}
        if resp.status_code == 404:
            return JSONResponse(status_code=502, content={"ok": False, "message": "该服务不支持模型列表接口（404），请手动填写模型名"})
        if resp.status_code != 200:
            return JSONResponse(status_code=502, content={"ok": False, "message": f"获取失败（HTTP {resp.status_code}）"})
        return JSONResponse(status_code=502, content={"ok": False, "message": "接口未返回模型列表，请手动填写模型名"})
    return {"ok": True, "models": models[:100]}


@app.post("/api/config")
async def save_config(body: LLMConfigBody) -> dict:
    """保存页面设置。api_key 为 "__KEEP__" 表示保留已存 Key；为空 = 清除本机配置回到环境变量。"""
    current = config.get()
    api_key = body.api_key.strip()
    if api_key == "__KEEP__":
        api_key = current["api_key"]
    base_url = config.normalize_base_url(body.base_url.strip() or current["base_url"])
    model = body.model.strip() or current["model"]
    if api_key and (not base_url or not model):
        missing = "API Base URL" if not base_url else "模型名称"
        raise HTTPException(422, f"启用 AI 评估需要完整配置：请填写{missing}")
    config.save(api_key, base_url, model)
    return {
        "ok": True,
        "engine": "llm" if config.llm_enabled() else "heuristic",
        "source": config.source(),
        "api_key_masked": config.masked_key(),
    }


@app.post("/api/evaluate")
async def evaluate(
    jd: str = Form(""),
    file: UploadFile | None = File(None),
    resume_text: str = Form(""),
) -> JSONResponse:
    jd = jd.strip()
    # JD 可选：留空则对简历做无岗位的通用体检；填了但过短则提示补全或清空
    if 0 < len(jd) < 30:
        raise HTTPException(
            422,
            "岗位 JD 内容过短：请粘贴 30 字以上的完整职位描述，或清空 JD 仅对简历做通用体检",
        )

    # 简历来源：上传文件优先，其次直接粘贴的文本
    if file is not None and file.filename:
        data = await file.read()
        if len(data) > config.MAX_FILE_SIZE:
            raise HTTPException(413, "文件超过 10 MB 限制")
        if not data:
            raise HTTPException(422, "上传的文件为空")
        resume, file_meta = await asyncio.to_thread(extract_text, file.filename, data)
    elif resume_text.strip():
        resume = resume_text.strip()
        if len(resume) < 50:
            raise HTTPException(422, "简历文本过短，请粘贴完整简历内容")
    else:
        raise HTTPException(422, "请上传简历文件或直接粘贴简历文本")

    if config.llm_enabled():
        # 事务式：启用 AI 就全部用 AI，失败立即报错、绝不静默降级（避免两种引擎结果混排）
        try:
            result = await evaluate_with_llm(jd, resume)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(502, f"AI 评估失败：{exc}。可重试，或在设置中清除配置改用本地分析")
    else:
        result = evaluate_heuristic(jd, resume)
    _normalize_result(result)

    # OCR 提示：扫描件识别可能有偏差，提前告知用户
    if file is not None and file.filename and file_meta.get("ocr_used"):
        prefix = "简历为图片型/扫描 PDF，已使用本地 OCR 识别文本，可能存在识别偏差，建议核对结果。"
        result["notice"] = f"{prefix} {result['notice']}".strip() if result.get("notice") else prefix

    # 统一兜底字段，避免前端取值出错
    # 简历文本随结果返回（截断），供前端复用于岗位推荐，避免重复上传
    result["resume"] = resume[:RESUME_PREVIEW_CAP]
    result["resume_truncated"] = len(resume) > RESUME_PREVIEW_CAP
    result.setdefault("mode", "match" if jd else "review")
    result.setdefault("verdict", "")
    result.setdefault("dimensions", [])
    result.setdefault("strengths", [])
    result.setdefault("improvements", [])
    result.setdefault("matched_keywords", [])
    result.setdefault("missing_keywords", [])
    result.setdefault("rewritten_summary", "")
    return JSONResponse(result)


@app.delete("/api/resume-files")
async def delete_resume_files(body: ResumeFilesDeleteBody) -> dict:
    """排名移除/清空/覆盖时同步删除对应附件（前端调用；不存在的静默跳过）。"""
    deleted = 0
    for fid in body.file_ids[:100]:
        if not _FILE_ID_RE.fullmatch(fid):
            continue
        p = RESUME_STORE_DIR / fid
        try:
            if p.is_file():
                p.unlink()
                deleted += 1
        except OSError:
            pass
    return {"ok": True, "deleted": deleted}


@app.post("/api/job-recommend")
async def job_recommend(body: JobRecommendBody) -> JSONResponse:
    """基于简历推荐岗位方向与各平台搜索关键词（体检模式的增值功能，失败可重试、不影响体检结果）。"""
    resume = body.resume.strip()
    if len(resume) < 50:
        raise HTTPException(422, "简历内容过短，无法生成岗位推荐")

    if config.llm_enabled():
        try:
            data = await recommend_jobs_llm(resume)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(502, f"AI 生成岗位推荐失败：{exc}。可重试")
        data.setdefault("notice", "")
        return JSONResponse(data)
    return JSONResponse(recommend_jobs_heuristic(resume))


# ---------------------------------------------------------------------------
# 面试官视角：批量评估与面试问题
# （注意：静态资源挂载必须位于所有 API 路由之后，否则会拦截 /api/* 请求）
# ---------------------------------------------------------------------------


@app.post("/api/batch-evaluate")
async def batch_evaluate(
    jd: str = Form(...),
    files: list[UploadFile] = File(...),
) -> JSONResponse:
    """多份简历对照同一 JD 批量评估，返回逐份结果（含简历文本，供面试题生成复用）。"""
    jd = jd.strip()
    if len(jd) < 30:
        raise HTTPException(422, "岗位 JD 内容过短，请至少粘贴 30 字以上的完整描述")
    if not files:
        raise HTTPException(422, "请上传至少一份简历文件")
    if len(files) > MAX_BATCH_FILES:
        raise HTTPException(422, f"单次最多上传 {MAX_BATCH_FILES} 份简历")

    _cleanup_expired_resume_files()  # 顺带清理超期孤儿附件

    llm_on = config.llm_enabled()
    # LLM 并发由 LLM_CONCURRENCY 控制（默认 4，撞限流可调回 2）；本地引擎为纯 CPU 计算，放宽到 8
    sem = asyncio.Semaphore(config.llm_concurrency() if llm_on else 8)

    async def evaluate_one(up: UploadFile) -> dict:
        filename = up.filename or "未命名"
        data = await up.read()
        if not data:
            return {"filename": filename, "ok": False, "error": "文件为空"}
        if len(data) > config.MAX_FILE_SIZE:
            return {"filename": filename, "ok": False, "error": "超过 10 MB 限制"}
        try:
            resume, _meta = await asyncio.to_thread(extract_text, filename, data)
        except HTTPException as exc:
            return {"filename": filename, "ok": False, "error": str(exc.detail)}

        async with sem:
            if llm_on:
                # 事务式：任一份 AI 评估失败立即抛出 → TaskGroup 取消其余任务并终止整批；
                # lean=True 走精简提示词（榜单与只读摘要只需核心字段，单份提速约一半）
                result = await evaluate_with_llm(jd, resume, lean=True)
            else:
                result = evaluate_heuristic(jd, resume)
        _normalize_result(result)

        result["candidate"] = guess_candidate_name(resume, filename)
        return {
            "filename": filename,
            "ok": True,
            "file_id": _store_resume_file(filename, data),  # 简历原件存档，供详情弹窗内嵌预览
            "resume": resume[:RESUME_PREVIEW_CAP],
            "resume_truncated": len(resume) > RESUME_PREVIEW_CAP,
            "result": result,
        }

    async def evaluate_one_and_collect(up: UploadFile) -> None:
        results.append(await evaluate_one(up))

    # 事务语义：AI 模式下任何一份失败 → 取消其余请求（不浪费 token）→ 整批报错，
    # 保证榜单要么全为 AI 评估、要么全为本地分析，绝不混合。
    results: list[dict] = []
    try:
        async with asyncio.TaskGroup() as tg:
            for f in files:
                tg.create_task(evaluate_one_and_collect(f))
    except* Exception as eg:  # noqa: BLE001
        first = eg.exceptions[0]
        raise HTTPException(
            502,
            f"AI 评估失败（{first}），已终止本次批量评估，未产生任何混合结果；可重试，或清除配置改用本地分析",
        )
    return JSONResponse({"engine": "llm" if llm_on else "heuristic", "results": results})


@app.post("/api/interview-questions")
async def interview_questions(body: QuestionsBody) -> JSONResponse:
    """基于 JD 与候选人简历生成结构化面试问题。"""
    jd, resume = body.jd.strip(), body.resume.strip()
    if len(jd) < 30:
        raise HTTPException(422, "岗位 JD 内容过短")
    if len(resume) < 50:
        raise HTTPException(422, "简历内容过短，无法生成针对性问题")

    if config.llm_enabled():
        # 事务式：启用 AI 就用 AI，失败直接报错，不降级到本地模板（避免风格混杂误导）
        try:
            data = await generate_questions_llm(jd, resume)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(502, f"AI 生成面试题失败：{exc}。可重试，或清除配置改用本地分析")
        data.setdefault("notice", "")
        return JSONResponse(data)
    return JSONResponse(questions_heuristic(jd, resume))


@app.post("/api/interview-question-regenerate")
async def interview_question_regenerate(body: QuestionRegenBody) -> JSONResponse:
    """面试官对题单中某一题不满意时，仅重新生成该题（其余题目保持不变）。"""
    jd, resume = body.jd.strip(), body.resume.strip()
    category = body.category.strip()
    current = body.question.strip()
    others = [o.strip() for o in body.others if o and o.strip()][:20]
    if len(jd) < 30:
        raise HTTPException(422, "岗位 JD 内容过短")
    if len(resume) < 50:
        raise HTTPException(422, "简历内容过短，无法生成针对性问题")
    if not current:
        raise HTTPException(422, "缺少要替换的题目")

    if config.llm_enabled():
        # 事务式：失败直接报错，不用本地模板替换（避免同一题单风格混杂）
        try:
            q = await regen_question_llm(jd, resume, category, current, others)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(502, f"AI 重新生成失败：{exc}。可重试")
        return JSONResponse({"ok": True, "question": q})
    q = regen_question_heuristic(jd, resume, category, current, others)
    return JSONResponse({"ok": True, "question": q, "notice": "当前为本地模板题，配置 AI 评估后可获得针对该岗位的深度定制问题。"})


# ---------------------------------------------------------------------------
# 简历附件预览（PDF 走浏览器原生阅读器；DOCX/TXT/MD 转 HTML 展示）
# ---------------------------------------------------------------------------

_PREVIEW_PAGE_TMPL = """<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title><style>
body {{ font-family: "Noto Sans SC", "Microsoft YaHei", sans-serif; margin: 0; padding: 28px 32px; color: #1a2332; background: #fff; }}
.doc-title {{ font-size: 15px; font-weight: 700; color: #64748b; margin: 0 0 18px; padding-bottom: 12px; border-bottom: 1px solid #e2e8f0; }}
p {{ margin: 0 0 12px; line-height: 1.8; font-size: 14px; white-space: pre-wrap; word-break: break-word; }}
h1, h2, h3 {{ margin: 22px 0 10px; line-height: 1.4; }}
h1 {{ font-size: 19px; }} h2 {{ font-size: 17px; }} h3 {{ font-size: 15px; }}
</style></head><body><p class="doc-title">{source}</p>{body}</body></html>"""


def _docx_to_html(path: Path) -> str:
    """DOCX → 简洁 HTML 预览（段落保留换行，标题加粗）。"""
    from docx import Document

    doc = Document(str(path))
    parts: list[str] = []
    for para in doc.paragraphs:
        text = para.text.rstrip()
        if not text:
            parts.append("")
            continue
        style = (para.style.name or "").lower()
        if style.startswith("heading") or style in {"title", "标题"}:
            level = para.style.name[-1] if para.style.name[-1].isdigit() else "2"
            parts.append(f"<h{level}>{html.escape(text)}</h{level}>")
        elif style.startswith("list") or para.text.lstrip().startswith(("-", "•", "·")):
            parts.append(f"<p>• {html.escape(text.lstrip('-•· ').lstrip())}</p>")
        else:
            parts.append(f"<p>{html.escape(text)}</p>")
    return "".join(parts) or "<p>（文档无文本内容）</p>"


def _text_to_html(path: Path) -> str:
    text = path.read_text(encoding="utf-8", errors="replace")
    return f"<p>{html.escape(text)}</p>"


@app.get("/api/resume-file/{file_id}")
async def resume_file(file_id: str):
    """内嵌返回简历原件：PDF 直接交由浏览器原生阅读器渲染，其余格式转 HTML 预览。"""
    if not _FILE_ID_RE.fullmatch(file_id):
        raise HTTPException(404, "简历附件不存在或已失效")
    path = RESUME_STORE_DIR / file_id
    if not path.is_file():
        raise HTTPException(404, "简历附件不存在或已失效，请重新上传评估")
    ext = path.suffix.lower()
    if ext == ".pdf":
        # 不设 filename → 无 attachment 头 → 浏览器内嵌渲染 PDF
        return FileResponse(path, media_type="application/pdf")
    try:
        body = _docx_to_html(path) if ext == ".docx" else _text_to_html(path)
    except Exception:  # noqa: BLE001
        body = "<p>附件预览生成失败，请下载后查看。</p>"
    return HTMLResponse(_PREVIEW_PAGE_TMPL.format(title=path.stem, source=f"简历附件 · {path.name}", body=body))


app.mount("/", NoCacheStaticFiles(directory=STATIC_DIR, html=True), name="static")
