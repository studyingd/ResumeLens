"""server API：未配置拦截、评估主流程（mock LLM）、配置端点、批量语义。"""

from __future__ import annotations

import pytest

from tests.conftest import fake_eval_result

JD = (
    "岗位职责：负责电商平台后端服务的设计与开发，保障高并发下的稳定性；"
    "参与需求评审与技术方案设计；优化数据库与缓存性能。"
    "任职要求：本科以上，3年以上 Java 开发经验；精通 Spring Boot、MyBatis，"
    "熟悉 MySQL、Redis、消息队列；了解微服务架构；有电商经验优先。"
)

RESUME = (
    "张三\nJava 后端工程师 · 6 年经验\n\n工作经历：\n某电商公司 高级后端工程师（2021-2024）\n"
    "负责订单与库存服务，QPS 峰值 8000。\n\n专业技能：\nJava / Spring Boot / MySQL / Redis / Kafka。\n"
) * 2


@pytest.fixture
def mock_eval(monkeypatch: pytest.MonkeyPatch):
    """把评估函数替换为离线假实现；返回一个可断言的调用记录器。"""
    import app.server as server_mod

    calls: list[dict] = []

    async def fake(jd: str, resume: str, lean: bool = False) -> dict:
        calls.append({"jd": jd, "resume": resume, "lean": lean})
        out = fake_eval_result(score=88)
        out["lean"] = lean
        return out

    monkeypatch.setattr(server_mod, "evaluate_with_llm", fake)
    return calls


class TestRequireLLM:
    def test_unconfigured_returns_422_with_guide(self, client, isolated_config):
        r = client.post("/api/evaluate", data={"jd": JD, "resume_text": RESUME})
        assert r.status_code == 422
        assert "齿轮" in r.json()["detail"]

    def test_unconfigured_batch_422(self, client, isolated_config):
        r = client.post(
            "/api/batch-evaluate",
            data={"jd": JD},
            files=[("files", ("a.txt", RESUME.encode(), "text/plain"))],
        )
        assert r.status_code == 422


class TestEvaluateValidation:
    def test_jd_too_short(self, client, configured_llm, mock_eval):
        r = client.post("/api/evaluate", data={"jd": "招Java", "resume_text": RESUME})
        assert r.status_code == 422 and "过短" in r.json()["detail"]

    def test_resume_too_short(self, client, configured_llm, mock_eval):
        r = client.post("/api/evaluate", data={"jd": JD, "resume_text": "太短"})
        assert r.status_code == 422 and "简历文本过短" in r.json()["detail"]

    def test_missing_resume(self, client, configured_llm):
        r = client.post("/api/evaluate", data={"jd": JD})
        assert r.status_code == 422


class TestEvaluateHappyPath:
    def test_full_flow(self, client, configured_llm, mock_eval):
        r = client.post("/api/evaluate", data={"jd": JD, "resume_text": RESUME})
        assert r.status_code == 200
        body = r.json()
        assert body["engine"] == "llm" and body["mode"] == "match"
        assert body["overall_score"] == 88
        assert body["resume"].startswith("张三")
        # improvements 的处理动作/原文/改写字段被统一兜底
        for it in body["improvements"]:
            assert set(("action", "original_text", "revised_text")) <= set(it)
        # mock 被以完整模式调用（非 lean）
        assert mock_eval and mock_eval[0]["lean"] is False

    def test_file_upload_txt(self, client, configured_llm, mock_eval):
        r = client.post(
            "/api/evaluate",
            data={"jd": JD},
            files={"file": ("resume.txt", RESUME.encode(), "text/plain")},
        )
        assert r.status_code == 200
        assert "张三" in r.json()["resume"]

    def test_garbled_file_sets_notice(self, client, configured_llm, mock_eval):
        garbled = ("锟斤拷烫烫烫锟斤拷烫烫烫\n" + RESUME).encode("utf-8")
        r = client.post(
            "/api/evaluate",
            data={"jd": JD},
            files={"file": ("g.txt", garbled, "text/plain")},
        )
        assert r.status_code == 200
        assert "乱码" in r.json()["notice"]


class TestBatch:
    def test_two_files_ok(self, client, configured_llm, mock_eval):
        resume2 = RESUME.replace("张三", "李四")
        r = client.post(
            "/api/batch-evaluate",
            data={"jd": JD},
            files=[
                ("files", ("张三.txt", RESUME.encode(), "text/plain")),
                ("files", ("李四.txt", resume2.encode(), "text/plain")),
            ],
        )
        assert r.status_code == 200
        body = r.json()
        assert body["engine"] == "llm" and len(body["results"]) == 2
        assert all(x["ok"] for x in body["results"])
        # lean 模式 + 姓名识别生效
        assert all(c["lean"] is True for c in mock_eval)
        assert {x["result"]["candidate"] for x in body["results"]} == {"张三", "李四"}

    def test_parse_failure_marked_not_fatal(self, client, configured_llm, mock_eval):
        """单份文件解析失败只标记该份失败，不终止整批（评估失败才终止）。"""
        r = client.post(
            "/api/batch-evaluate",
            data={"jd": JD},
            files=[
                ("files", ("bad.xyz", b"xx", "application/octet-stream")),
                ("files", ("ok.txt", RESUME.encode(), "text/plain")),
            ],
        )
        assert r.status_code == 200
        results = r.json()["results"]
        assert results[0]["ok"] is False and "不支持的文件格式" in results[0]["error"]
        assert results[1]["ok"] is True

    def test_llm_failure_aborts_whole_batch(self, client, configured_llm, monkeypatch):
        import app.server as server_mod

        async def boom(jd, resume, lean=False):
            raise RuntimeError("上游 429")

        monkeypatch.setattr(server_mod, "evaluate_with_llm", boom)
        r = client.post(
            "/api/batch-evaluate",
            data={"jd": JD},
            files=[("files", ("a.txt", RESUME.encode(), "text/plain"))],
        )
        assert r.status_code == 502
        assert "已终止本次批量评估" in r.json()["detail"]

    def test_over_limit_rejected(self, client, configured_llm):
        files = [("files", (f"f{i}.txt", RESUME.encode(), "text/plain")) for i in range(21)]
        r = client.post("/api/batch-evaluate", data={"jd": JD}, files=files)
        assert r.status_code == 422


class TestConfigEndpoints:
    def test_get_masks_key_and_returns_concurrency(self, client, configured_llm):
        body = client.get("/api/config").json()
        assert body["engine"] == "llm" and body["llm_concurrency"] == 4
        assert "sk-test" not in body["api_key_masked"] or body["api_key_masked"] == "sk-******test"

    def test_keep_key_and_save_concurrency(self, client, configured_llm):
        r = client.post(
            "/api/config",
            json={"api_key": "__KEEP__", "base_url": "", "model": "", "llm_concurrency": 6},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["engine"] == "llm" and body["llm_concurrency"] == 6

    def test_concurrency_validated(self, client, configured_llm):
        r = client.post(
            "/api/config",
            json={"api_key": "__KEEP__", "base_url": "", "model": "", "llm_concurrency": 12},
        )
        assert r.status_code == 422 and "1-8" in r.json()["detail"]


class TestInterviewQuestions:
    def test_counts_pass_through(self, client, configured_llm, monkeypatch):
        """题量配置随请求传入生成函数（默认补全为四类完整映射）。"""
        import app.server as server_mod

        captured = {}

        async def fake(jd, resume, counts=None):
            captured["counts"] = counts
            return {
                "questions": [{"category": "软素质", "question": "q", "intent": "", "reference": ""}],
                "focus_areas": [],
                "notice": "",
            }

        monkeypatch.setattr(server_mod, "generate_questions_llm", fake)
        r = client.post(
            "/api/interview-questions",
            json={"jd": JD, "resume": RESUME, "counts": {"软素质": 2}},
        )
        assert r.status_code == 200
        assert captured["counts"]["软素质"] == 2 and captured["counts"]["岗位职责"] == 4
        assert r.json()["notice"] == ""

    @pytest.mark.parametrize(
        ("counts", "hint"),
        [({"岗位职责": 99}, "0-10"), ({"综合素质": 2}, "未知"), ({"岗位职责": 0, "技能验证": 0, "情景设计": 0, "软素质": 0}, "1-20")],
    )
    def test_invalid_counts_422(self, client, configured_llm, counts, hint):
        r = client.post("/api/interview-questions", json={"jd": JD, "resume": RESUME, "counts": counts})
        assert r.status_code == 422 and hint in r.json()["detail"]


class TestResumeFiles:
    def test_delete_invalid_ids_noop(self, client):
        r = client.request(
            "DELETE",
            "/api/resume-files",
            json={"file_ids": ["../../etc/passwd", "zzz.exe", ""]},
        )
        assert r.status_code == 200 and r.json()["deleted"] == 0

    def test_preview_invalid_id_404(self, client):
        assert client.get("/api/resume-file/nope.txt").status_code == 404
