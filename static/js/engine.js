/* 引擎状态徽标：右上角显示当前评估引擎与配置来源 */

import { els } from "./dom.js";
import { state } from "./state.js";

export async function refreshEngine() {
  try {
    const res = await fetch("/api/health");
    const data = await res.json();
    state.engine = data.engine === "llm" ? "llm" : "";
    els.engineBadge.classList.remove("is-llm", "is-heuristic");
    if (data.engine === "llm") {
      els.engineBadge.classList.add("is-llm");
      els.engineBadge.title = `AI 评估 · ${data.model}（${data.source === "local" ? "页面设置" : "环境变量"}）`;
      els.engineText.textContent = `AI 评估 · ${data.model}`;
    } else {
      els.engineBadge.classList.add("is-heuristic");
      els.engineBadge.title = "尚未配置 AI：点击右上角齿轮完成配置后即可使用";
      els.engineText.textContent = "未配置 AI · 点击设置";
    }
  } catch {
    state.engine = "";
    els.engineText.textContent = "服务未连接";
  }
}
