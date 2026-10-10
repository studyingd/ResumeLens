/* 设置弹窗：AI 接口配置、连接测试、模型列表获取与下拉选择 */

import { els } from "./dom.js";
import { postJSON, toast, esc } from "./utils.js";
import { refreshEngine } from "./engine.js";
import { closeImprovement } from "./candidate.js";
import { closeDetail } from "./detail.js";

/* ---------- 弹窗开关 ---------- */

function showCfgStatus(text, ok) {
  els.cfgStatus.textContent = text;
  els.cfgStatus.classList.toggle("is-ok", ok);
  els.cfgStatus.classList.toggle("is-err", !ok);
  els.cfgStatus.hidden = false;
}

function hideCfgStatus() {
  els.cfgStatus.hidden = true;
}

export async function openSettings() {
  hideCfgStatus();
  els.settingsOverlay.hidden = false;
  document.body.style.overflow = "hidden";
  try {
    const res = await fetch("/api/config");
    const data = await res.json();
    els.cfgBaseurl.value = data.base_url ?? "";
    els.cfgModel.value = data.model ?? "";
    els.cfgConcurrency.value = data.llm_concurrency ?? 4;
    els.cfgKey.value = "";
    els.cfgKey.placeholder = data.api_key_masked
      ? `已保存：${data.api_key_masked}（留空则保持不变）`
      : "sk-…（必填）";
    // 已有保存配置时，打开即自动拉取一次模型列表（服务端回退用已存 Key）
    if (data.source === "local" || data.api_key_masked) {
      showCfgStatus(`当前已启用页面保存的配置（${data.api_key_masked}）· 模型 ${data.model}`, true);
      fetchModels(false);
    }
  } catch {
    /* 预填失败不阻塞弹窗 */
  }
  els.cfgBaseurl.focus();
}

function closeSettings() {
  els.settingsOverlay.hidden = true;
  document.body.style.overflow = "";
}

els.settingsOpen.addEventListener("click", openSettings);
els.settingsClose.addEventListener("click", closeSettings);
// 仅允许 X 按钮与 Esc 关闭，点击遮罩空白处不关闭（避免误触丢失已填内容）
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    // 优先关闭优化点详情，其次候选人详情，最后设置弹窗
    if (!els.impOverlay.hidden) closeImprovement();
    else if (!els.detailOverlay.hidden) closeDetail();
    else if (!els.settingsOverlay.hidden) closeSettings();
  }
});

els.cfgKeyToggle.addEventListener("click", () => {
  const show = els.cfgKey.type === "password";
  els.cfgKey.type = show ? "text" : "password";
  els.cfgKeyToggle.setAttribute("aria-label", show ? "隐藏 API Key" : "显示 API Key");
});

/* ---------- 模型列表获取 ---------- */

let modelsLoadedKey = "";

// 返回 true 表示尝试了请求
function canFetchModels() {
  const base = els.cfgBaseurl.value.trim();
  const hasKey = els.cfgKey.value.trim().length > 0 || els.cfgKey.placeholder.includes("已保存");
  return Boolean(base) && hasKey;
}

async function fetchModels(manual) {
  if (!canFetchModels()) {
    if (manual) showCfgStatus("请先填写 API Base URL 和 API Key", false);
    return;
  }
  const combo = `${els.cfgBaseurl.value.trim()}|${els.cfgKey.value.trim()}`;
  if (!manual && combo === modelsLoadedKey) return; // 自动模式下不重复拉取
  modelsLoadedKey = combo;

  els.modelsRefresh.disabled = true;
  els.modelsRefresh.classList.add("is-spinning");
  try {
    const { res, data } = await postJSON("/api/config/models", {
      api_key: els.cfgKey.value.trim(),
      base_url: els.cfgBaseurl.value.trim(),
      model: "",
    });
    if (!res.ok || !data?.ok) throw new Error(data?.message ?? "获取模型列表失败");
    modelItems = data.models ?? [];
    renderModelDropdown();
    showCfgStatus(data.message ?? `已获取 ${modelItems.length} 个模型，点击「模型名称」输入框选择`, true);
  } catch (err) {
    modelsLoadedKey = "";
    if (manual) showCfgStatus(err.message, false); // 自动模式失败不打扰，仍可手动填写
  } finally {
    els.modelsRefresh.disabled = false;
    els.modelsRefresh.classList.remove("is-spinning");
  }
}

// 填完 Base URL / Key 后自动拉取（blur 与 change 双保险）
["blur", "change"].forEach((evt) => {
  els.cfgKey.addEventListener(evt, () => fetchModels(false));
  els.cfgBaseurl.addEventListener(evt, () => fetchModels(false));
});
els.modelsRefresh.addEventListener("click", () => fetchModels(true));

/* ---------- 模型下拉选择（自绘列表，行为可控、全浏览器一致） ---------- */

let modelItems = [];
let activeIndex = -1;

function renderModelDropdown() {
  const filter = els.cfgModel.value.trim().toLowerCase();
  const items = modelItems.filter((m) => !filter || m.toLowerCase().includes(filter));
  activeIndex = -1;
  els.modelDropdown.innerHTML = items.length
    ? items
        .map((m) => `<button type="button" class="model-option" data-value="${esc(m)}">${esc(m)}</button>`)
        .join("")
    : '<p class="model-empty">无匹配的模型，可直接手动输入</p>';
}

function openModelDropdown() {
  if (!modelItems.length) {
    fetchModels(true); // 尚未拉取过，先拉取
    return;
  }
  renderModelDropdown();
  els.modelDropdown.hidden = false;
  els.cfgModel.setAttribute("aria-expanded", "true");
}

function closeModelDropdown() {
  els.modelDropdown.hidden = true;
  activeIndex = -1;
  els.cfgModel.setAttribute("aria-expanded", "false");
}

function setActiveOption(idx) {
  const options = els.modelDropdown.querySelectorAll(".model-option");
  options.forEach((el) => el.classList.remove("is-active"));
  if (idx >= 0 && idx < options.length) {
    options[idx].classList.add("is-active");
    options[idx].scrollIntoView({ block: "nearest" });
  }
  activeIndex = idx;
}

function selectModel(value) {
  els.cfgModel.value = value;
  closeModelDropdown();
  hideCfgStatus();
}

els.cfgModel.addEventListener("focus", openModelDropdown);
els.cfgModel.addEventListener("click", () => {
  if (els.modelDropdown.hidden) openModelDropdown(); // 部分浏览器 focus 不可靠
});
els.cfgModel.addEventListener("input", () => {
  if (!els.modelDropdown.hidden) renderModelDropdown(); // 输入即过滤
});
els.cfgModel.addEventListener("keydown", (e) => {
  const options = els.modelDropdown.querySelectorAll(".model-option");
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    if (els.modelDropdown.hidden) {
      openModelDropdown();
      return;
    }
    const dir = e.key === "ArrowDown" ? 1 : -1;
    setActiveOption(Math.min(Math.max(activeIndex + dir, 0), options.length - 1));
  } else if (e.key === "Enter" && !els.modelDropdown.hidden) {
    e.preventDefault();
    const target = options[activeIndex] ?? options[0];
    if (target) selectModel(target.dataset.value);
  } else if (e.key === "Escape" && !els.modelDropdown.hidden) {
    e.stopPropagation(); // 只关下拉，不连带关闭设置弹窗
    closeModelDropdown();
  }
});
els.modelDropdown.addEventListener("click", (e) => {
  const btn = e.target.closest(".model-option");
  if (btn) selectModel(btn.dataset.value);
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".model-row")) closeModelDropdown();
});

/* ---------- 测试 / 保存 / 清除 ---------- */

els.cfgTest.addEventListener("click", async () => {
  const body = {
    api_key: els.cfgKey.value.trim(),
    base_url: els.cfgBaseurl.value.trim(),
    model: els.cfgModel.value.trim(),
  };
  if (!body.api_key && !els.cfgKey.placeholder.includes("已保存")) {
    showCfgStatus("请先填写 API Key", false);
    els.cfgKey.focus();
    return;
  }
  els.cfgTest.disabled = true;
  els.cfgTest.textContent = "测试中…";
  try {
    const { res, data } = await postJSON("/api/config/test", body);
    showCfgStatus(data?.message ?? (res.ok ? "连接成功" : "测试失败"), res.ok);
  } catch {
    showCfgStatus("网络错误，无法连接到服务", false);
  } finally {
    els.cfgTest.disabled = false;
    els.cfgTest.textContent = "测试连接";
  }
});

els.cfgSave.addEventListener("click", async () => {
  const key = els.cfgKey.value.trim();
  const baseUrl = els.cfgBaseurl.value.trim();
  const model = els.cfgModel.value.trim();
  if (!key && !els.cfgKey.placeholder.includes("已保存")) {
    showCfgStatus("请填写 API Key 后再保存（Ollama 本地服务可填任意非空值）", false);
    els.cfgKey.focus();
    return;
  }
  if (!baseUrl) {
    showCfgStatus("请填写 API Base URL（首次配置无默认值，需完整填写）", false);
    els.cfgBaseurl.focus();
    return;
  }
  if (!model) {
    showCfgStatus("请填写或选择模型名称", false);
    els.cfgModel.focus();
    return;
  }
  els.cfgSave.disabled = true;
  els.cfgSave.textContent = "保存中…";
  try {
    // 未重填 Key 且之前已保存过 → 传 __KEEP__ 告知后端保持原 Key
    const { res, data } = await postJSON("/api/config", {
      api_key: key || "__KEEP__",
      base_url: baseUrl,
      model: model,
      llm_concurrency: Math.min(8, Math.max(1, Number(els.cfgConcurrency.value) || 4)),
    });
    if (!res.ok) throw new Error(data?.detail ?? "保存失败");
    await refreshEngine();
    if (data.engine === "llm") {
      showCfgStatus(`已启用 AI 深度评估 · ${data.api_key_masked} · 模型「${model || "默认"}」`, true);
      toast("AI 深度评估已启用", "success", 2600);
    } else {
      showCfgStatus("已清除本机配置，重新配置 AI 后才能继续使用评估功能", true);
      toast("已清除 AI 配置", "info", 2600);
    }
    els.cfgKey.value = "";
    els.cfgKey.placeholder = data.api_key_masked
      ? `已保存：${data.api_key_masked}（留空则保持不变）`
      : "sk-…（必填）";
  } catch (err) {
    showCfgStatus(err.message || "保存失败", false);
  } finally {
    els.cfgSave.disabled = false;
    els.cfgSave.textContent = "保存并启用";
  }
});

let resetArmed = null;
els.cfgReset.addEventListener("click", async () => {
  // 两步确认：首次点击变为确认态，3 秒内再次点击才执行
  if (!resetArmed) {
    els.cfgReset.classList.add("btn-danger-armed");
    els.cfgReset.textContent = "再次点击确认清除";
    resetArmed = setTimeout(() => {
      resetArmed = null;
      els.cfgReset.classList.remove("btn-danger-armed");
      els.cfgReset.textContent = "清除本机配置";
    }, 3000);
    return;
  }
  clearTimeout(resetArmed);
  resetArmed = null;
  els.cfgReset.classList.remove("btn-danger-armed");
  els.cfgReset.textContent = "清除本机配置";
  try {
    const { data } = await postJSON("/api/config", { api_key: "", base_url: "", model: "" });
    await refreshEngine();
    showCfgStatus("已清除本机配置" + (data.engine === "llm" ? "（环境变量中仍配置有 Key，已回退启用）" : "，请重新配置 AI 后继续使用"), true);
    els.cfgKey.value = "";
    els.cfgKey.placeholder = "sk-…（必填）";
  } catch {
    showCfgStatus("清除失败，请重试", false);
  }
});
