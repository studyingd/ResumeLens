"""FastAPI 服务：静态页面 + 评估接口。"""

from __future__ import annotations

import asyncio
from pathlib import Path

import httpx
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import config
from .evaluator import evaluate_heuristic, evaluate_with_llm
from .interview import generate_questions_llm, guess_candidate_name, questions_heuristic
from .parser import extract_text

app = FastAPI(title="ResumeLens", docs_url=None, redoc_url=None)

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


class LLMConfigBody(BaseModel):
    api_key: str = ""
    base_url: str = ""
    model: str = ""


class QuestionsBody(BaseModel):
    jd: str
    resume: str


MAX_BATCH_FILES = 20


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
    base_url = (body.base_url.strip() or current["base_url"]).rstrip("/")
    model = body.model.strip() or current["model"]
    if not api_key:
        return JSONResponse(status_code=422, content={"ok": False, "message": "请先填写 API Key"})
    try:
        async with httpx.AsyncClient(timeout=30) as client:
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
    try:
        replied = resp.json()["choices"][0]["message"]["content"]
    except Exception:  # noqa: BLE001
        replied = ""
    return {"ok": True, "message": f"连接成功，模型「{model}」响应正常"}


@app.post("/api/config/models")
async def list_models(body: LLMConfigBody) -> JSONResponse:
    """拉取 OpenAI 兼容接口的模型列表（Key 留空则用已保存的）。"""
    current = config.get()
    api_key = body.api_key.strip() or (current["api_key"] if current["api_key"] else "")
    base_url = (body.base_url.strip() or current["base_url"]).rstrip("/")
    if not api_key:
        return JSONResponse(status_code=422, content={"ok": False, "message": "请先填写 API Key"})
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(f"{base_url}/models", headers={"Authorization": f"Bearer {api_key}"})
    except httpx.TimeoutException:
        return JSONResponse(status_code=502, content={"ok": False, "message": "连接超时，请检查 Base URL 与网络"})
    except httpx.HTTPError as exc:
        return JSONResponse(status_code=502, content={"ok": False, "message": f"连接失败：{exc}"})
    if resp.status_code == 401:
        return JSONResponse(status_code=502, content={"ok": False, "message": "鉴权失败（401），请检查 API Key 是否正确"})
    if resp.status_code == 404:
        return JSONResponse(status_code=502, content={"ok": False, "message": "该服务不支持模型列表接口（404），请手动填写模型名"})
    if resp.status_code != 200:
        return JSONResponse(status_code=502, content={"ok": False, "message": f"获取失败（HTTP {resp.status_code}）"})
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
        return JSONResponse(status_code=502, content={"ok": False, "message": "接口未返回模型列表，请手动填写模型名"})
    return {"ok": True, "models": models[:100]}


@app.post("/api/config")
async def save_config(body: LLMConfigBody) -> dict:
    """保存页面设置。api_key 为 "__KEEP__" 表示保留已存 Key；为空 = 清除本机配置回到环境变量。"""
    current = config.get()
    api_key = body.api_key.strip()
    if api_key == "__KEEP__":
        api_key = current["api_key"]
    base_url = body.base_url.strip() or current["base_url"]
    model = body.model.strip() or current["model"]
    config.save(api_key, base_url, model)
    return {
        "ok": True,
        "engine": "llm" if config.llm_enabled() else "heuristic",
        "source": config.source(),
        "api_key_masked": config.masked_key(),
    }


@app.post("/api/evaluate")
async def evaluate(
    jd: str = Form(...),
    file: UploadFile | None = File(None),
    resume_text: str = Form(""),
) -> JSONResponse:
    jd = jd.strip()
    if len(jd) < 30:
        raise HTTPException(422, "岗位 JD 内容过短，请至少粘贴 30 字以上的完整描述")

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
        try:
            result = await evaluate_with_llm(jd, resume)
        except Exception as exc:  # noqa: BLE001
            # LLM 失败时自动降级到本地引擎，保证可用性
            result = evaluate_heuristic(jd, resume)
            result["notice"] = f"LLM 调用失败，已降级为本地启发式分析（{exc}）"
    else:
        result = evaluate_heuristic(jd, resume)

    # OCR 提示：扫描件识别可能有偏差，提前告知用户
    if file is not None and file.filename and file_meta.get("ocr_used"):
        prefix = "简历为图片型/扫描 PDF，已使用本地 OCR 识别文本，可能存在识别偏差，建议核对结果。"
        result["notice"] = f"{prefix} {result['notice']}".strip() if result.get("notice") else prefix

    # 统一兜底字段，避免前端取值出错
    result.setdefault("verdict", "")
    result.setdefault("dimensions", [])
    result.setdefault("strengths", [])
    result.setdefault("improvements", [])
    result.setdefault("matched_keywords", [])
    result.setdefault("missing_keywords", [])
    result.setdefault("rewritten_summary", "")
    return JSONResponse(result)


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

    llm_on = config.llm_enabled()
    # LLM 并发过高易触发限流，限 2；本地引擎为纯 CPU 计算，放宽到 8
    sem = asyncio.Semaphore(2 if llm_on else 8)

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
                try:
                    result = await evaluate_with_llm(jd, resume)
                except Exception as exc:  # noqa: BLE001
                    result = evaluate_heuristic(jd, resume)
                    result["notice"] = f"LLM 调用失败，已降级为本地启发式分析（{exc}）"
            else:
                result = evaluate_heuristic(jd, resume)

        result["candidate"] = guess_candidate_name(resume, filename)
        return {
            "filename": filename,
            "ok": True,
            "resume": resume[:12000],  # 供前端生成面试问题时复用，避免重复上传
            "result": result,
        }

    results = await asyncio.gather(*(evaluate_one(f) for f in files))
    return JSONResponse({"engine": "llm" if llm_on else "heuristic", "results": list(results)})


@app.post("/api/interview-questions")
async def interview_questions(body: QuestionsBody) -> JSONResponse:
    """基于 JD 与候选人简历生成结构化面试问题。"""
    jd, resume = body.jd.strip(), body.resume.strip()
    if len(jd) < 30:
        raise HTTPException(422, "岗位 JD 内容过短")
    if len(resume) < 50:
        raise HTTPException(422, "简历内容过短，无法生成针对性问题")

    if config.llm_enabled():
        try:
            data = await generate_questions_llm(jd, resume)
            data.setdefault("notice", "")
            return JSONResponse(data)
        except Exception as exc:  # noqa: BLE001
            data = questions_heuristic(jd, resume)
            data["notice"] = f"LLM 生成失败，已使用本地模板问题（{exc}）"
            return JSONResponse(data)
    return JSONResponse(questions_heuristic(jd, resume))


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
