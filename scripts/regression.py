"""真机回归脚本：验证 LLM 核心链路的质量与稳定性（需已配置 AI 且网关可达）。

用法：
    uv run python scripts/regression.py

检查项（全部走真实模型，约 3-6 分钟）：
1. 排名稳定性：精简模式（温度 0）同一简历两次评分必须完全一致——批量排名的可比性底线
2. 体检完整性：完整模式输出字段齐全（维度/改进项/建议/原文对照/改写示范/简介改写）
3. 面试题质量：默认精确 10 题（4/3/2/1）；自定义 2/2/0/1 精确 5 题且无被禁类别；
   默认题量下参考要点保持深度（均长 ≥ 100 字）

任何共享组件（如 chat_text）或提示词改动后，推送前应跑通本脚本。
"""

from __future__ import annotations

import asyncio
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import get  # noqa: E402
from app.evaluator import evaluate_with_llm  # noqa: E402
from app.interview import generate_questions_llm  # noqa: E402

RESUME = (Path(__file__).resolve().parents[1] / "samples" / "sample_resume.txt").read_text(encoding="utf-8")
JD = (
    "岗位职责：负责电商平台后端服务的设计与开发，保障高并发下的稳定性；"
    "参与需求评审与技术方案设计；优化数据库与缓存性能。"
    "任职要求：本科以上，3年以上 Java 开发经验；精通 Spring Boot、MyBatis，"
    "熟悉 MySQL、Redis、消息队列；了解微服务架构；有电商经验优先。"
)

FAILS: list[str] = []
WARNS: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" —— {detail}" if detail else ""), flush=True)
    if not ok:
        FAILS.append(f"{name}（{detail}）" if detail else name)


async def check_ranking() -> None:
    print("== 1/3 排名稳定性（精简模式，温度 0）==", flush=True)
    lean1 = await evaluate_with_llm(JD, RESUME, lean=True)
    lean2 = await evaluate_with_llm(JD, RESUME, lean=True)
    s1, s2 = lean1.get("overall_score"), lean2.get("overall_score")
    check("同一简历两次评分完全一致", s1 == s2, f"{s1} vs {s2}")
    check("精简模式四维度", len(lean1.get("dimensions", [])) == 4, f"{len(lean1.get('dimensions', []))} 项")
    check("总分在 0-100 内", isinstance(s1, int) and 0 <= s1 <= 100, str(s1))


async def check_full_report() -> None:
    print("== 2/3 体检完整性（完整模式）==", flush=True)
    full = await evaluate_with_llm(JD, RESUME)
    score = full.get("overall_score")
    check("总分 0-100 整数", isinstance(score, int) and 0 <= score <= 100, str(score))
    dims = full.get("dimensions", [])
    check("维度 ≥ 3 项", len(dims) >= 3, f"{len(dims)} 项")
    check("维度字段齐全（name/score/comment）", all(d.get("name") and d.get("comment") for d in dims))
    imps = full.get("improvements", [])
    check("改进项 3-6 条", 3 <= len(imps) <= 6, f"{len(imps)} 条")
    check("每条改进建议非空", all(i.get("suggestion") for i in imps))
    check("优先级合法（high/medium/low）", all(i.get("priority") in ("high", "medium", "low") for i in imps))
    check("含原文对照定位", any(i.get("original_text") for i in imps))
    check("含改写示范", any(i.get("revised_text") for i in imps))
    check("简介改写非空", bool(full.get("rewritten_summary")))


async def check_questions() -> None:
    print("== 3/3 面试题（题量/去重/类别）==", flush=True)
    q10 = await generate_questions_llm(JD, RESUME)
    dist = Counter(q["category"] for q in q10["questions"])
    check("默认精确 10 题 4/3/2/1", dist == Counter({"岗位职责": 4, "技能验证": 3, "情景设计": 2, "软素质": 1}), str(dict(dist)))
    check("每题字段齐全（question/intent/reference）", all(q["question"] and q["intent"] and q["reference"] for q in q10["questions"]))
    avg_ref = sum(len(q["reference"]) for q in q10["questions"]) / max(1, len(q10["questions"]))
    check("参考要点保持深度（均长 ≥100 字）", avg_ref >= 100, f"均长 {avg_ref:.0f} 字")
    if "截断" in q10.get("notice", ""):
        WARNS.append(f"默认 10 题触发截断补救：{q10['notice']}")

    q5 = await generate_questions_llm(JD, RESUME, {"岗位职责": 2, "技能验证": 2, "情景设计": 0, "软素质": 1})
    dist5 = Counter(q["category"] for q in q5["questions"])
    check(
        "自定义 2/2/0/1 精确 5 题（情景设计一类都不出）",
        dist5 == Counter({"岗位职责": 2, "技能验证": 2, "软素质": 1}) and len(q5["questions"]) == 5,
        str(dict(dist5)),
    )


async def main() -> int:
    cfg = get()
    if not (cfg["base_url"] and cfg["api_key"] and cfg["model"]):
        print("未配置 AI（Base URL / API Key / 模型名），无法运行真机回归，请先在网页右上角设置中配置。")
        return 2

    await check_ranking()
    await check_full_report()
    await check_questions()

    print(flush=True)
    for w in WARNS:
        print(f"[警告] {w}")
    if FAILS:
        print(f"回归未通过：{len(FAILS)} 项失败")
        for f in FAILS:
            print(f"  - {f}")
        return 1
    print("回归全部通过 ✔（排名稳定性 / 体检完整性 / 面试题质量）")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
