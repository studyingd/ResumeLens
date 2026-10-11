/* 候选人详情弹窗：只读摘要、简历附件内嵌预览、面试题生成与单题重生成 */

import { els } from "./dom.js";
import { state } from "./state.js";
import { ACTION_LABELS, PRIORITY_LABELS } from "./constants.js";
import { esc, toast, toneOf } from "./utils.js";
import { saveRank } from "./rank-store.js";
import { closeImprovement } from "./candidate.js";

// 只读摘要卡（仅标题 + 动作/优先级 + 问题描述，无建议、不可点击）
function improvementBriefHtml(it, i) {
  const action = ACTION_LABELS[it.action] ?? "";
  return `
    <article class="point-card point-card-warn">
      <div class="point-head">
        <span class="point-index">${i + 1}</span>
        <h4 class="point-title">${esc(it.title)}</h4>
        ${action ? `<span class="action-pill" data-action="${action}">${action}</span>` : ""}
        ${it.priority ? `<span class="priority-pill" data-priority="${esc(it.priority)}">${PRIORITY_LABELS[it.priority] ?? esc(it.priority)}</span>` : ""}
      </div>
      <p class="point-detail">${esc(it.detail)}</p>
    </article>`;
}

export function openDetail(i) {
  const item = state.rankData[i];
  if (!item) return;
  // 仅显式 ok === false 才是解析失败；早期版本保存的记录无 ok 字段（undefined），视为正常
  if (item.ok === false) {
    toast(item.error ?? "该简历解析失败，无法查看详情");
    return;
  }
  state.detailIndex = i;
  const r = item.result;

  els.detailRank.textContent = i + 1;
  els.detailRank.className = "rank-badge" + (i < 3 ? ` rank-${i + 1}` : "");
  els.detailName.textContent = r.candidate || item.filename;
  els.detailFile.textContent = item.filename + (item.batch ? ` · 第 ${item.batch} 轮入库 · ${item.time}` : "");
  els.detailScorebar.dataset.tone = toneOf(r.overall_score);
  els.detailScore.textContent = `${r.overall_score} 分`;
  els.detailVerdict.textContent = r.verdict || "";
  els.detailEngine.textContent = "AI 评估";
  els.detailNotice.hidden = !r.notice;
  els.detailNotice.textContent = r.notice || "";

  els.detailDims.innerHTML = (r.dimensions ?? [])
    .map(
      (d) => `
      <div class="detail-dim" data-tone="${toneOf(d.score)}">
        <span class="detail-dim-name">${esc(d.name)}</span>
        <div class="dim-bar"><div class="dim-bar-fill" style="width:${Math.round(d.score)}%"></div></div>
        <span class="detail-dim-score">${Math.round(d.score)}</span>
      </div>`
    )
    .join("");

  els.detailStrengths.innerHTML = (r.strengths ?? []).length
    ? (r.strengths ?? [])
        .slice(0, 3)
        .map(
          (s, idx) => `
        <article class="point-card point-card-good">
          <div class="point-head"><span class="point-index">${idx + 1}</span><h4 class="point-title">${esc(s.title)}</h4></div>
          <p class="point-detail">${esc(s.detail)}</p>
        </article>`
        )
        .join("")
    : '<p class="empty-note">无</p>';

  els.detailImprovements.innerHTML = (r.improvements ?? []).length
    ? (r.improvements ?? []).slice(0, 4).map((it, idx) => improvementBriefHtml(it, idx)).join("")
    : '<p class="empty-note">无</p>';

  const matched = r.matched_keywords ?? [];
  const missing = r.missing_keywords ?? [];
  els.detailKeywords.innerHTML = `
    <div class="chip-set chip-good">${matched.map((k) => `<span class="kw-chip">${esc(k)}</span>`).join("") || '<span class="empty-note">无</span>'}</div>
    <div class="chip-set chip-warn detail-kw-missing">${missing.map((k) => `<span class="kw-chip">${esc(k)}</span>`).join("") || '<span class="empty-note">无</span>'}</div>`;

  // 简历附件：左栏内点击「查看简历」展开（原件/文本视图可切换，展开时懒加载）
  const hasFile = Boolean(item.file_id);
  const hasResumeText = Boolean((item.resume ?? "").trim());
  els.resumeFrame.removeAttribute("srcdoc");
  els.resumeFrame.src = "";
  els.resumeFrame.hidden = !hasFile && !hasResumeText;
  els.resumeMissing.hidden = hasFile || hasResumeText;
  els.resumeToggle.hidden = !hasFile && !hasResumeText;
  setResumeOpen(false);

  // 题单随候选人持久保留，直到使用者主动重新生成；后台生成中则展示进度而非旧题单
  if (item.qgen === "pending") {
    els.qgResult.innerHTML = '<div class="q-loading">正在生成结构化面试题，AI 模式约需半分钟…</div>';
    els.qgGenerate.disabled = true;
    els.qgGenerateLabel.textContent = "生成中…";
  } else if (item.questions) {
    renderQuestions(item.questions);
    els.qgGenerate.disabled = false;
    els.qgGenerateLabel.textContent = "重新生成全套题";
  } else {
    els.qgResult.innerHTML =
      '<p class="empty-note">点击右上角按钮，基于岗位 JD 与该候选人简历生成结构化面试题（含考察意图与参考答案要点）</p>';
    els.qgGenerate.disabled = false;
    els.qgGenerateLabel.textContent = "基于 JD 与该简历生成面试题";
  }

  els.detailOverlay.hidden = false;
  document.body.style.overflow = "hidden";
  els.detailClose.focus();
}

export function closeDetail() {
  if (!els.impOverlay.hidden) closeImprovement(); // 详情关闭时叠加的优化点弹窗一并关闭
  hideSelectBtn();
  els.detailOverlay.hidden = true;
  document.body.style.overflow = "";
  state.detailIndex = -1;
}

els.detailClose.addEventListener("click", closeDetail);
els.detailOverlay.addEventListener("click", (e) => {
  if (e.target === els.detailOverlay) closeDetail();
});

// 简历视图：原件（PDF 原生阅读器 / DOCX、TXT 转HTML）或 文本（解析文本，划词捕获必备）
let resumeViewMode = "file"; // 页面级记忆：切换候选人时保持

function buildResumeTextDoc(text) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
body{font-family:"Noto Sans SC","Microsoft YaHei",sans-serif;margin:0;padding:22px 26px;color:#1a2332;background:#fff;line-height:1.9;font-size:13.5px;white-space:pre-wrap;word-break:break-word}
.note{color:#94a3b8;font-size:12px;border-bottom:1px solid #e2e8f0;padding-bottom:10px;margin:0 0 14px}
</style></head><body><p class="note">解析文本视图：可划词捕获片段用于定向换题</p>${esc(text)}</body></html>`;
}

function showResume() {
  const item = state.rankData[state.detailIndex];
  const hasFile = Boolean(item?.file_id);
  const text = (item?.resume ?? "").trim();
  const mode = resumeViewMode === "text" || !hasFile ? "text" : "file";
  els.rvFile.classList.toggle("is-active", mode === "file");
  els.rvText.classList.toggle("is-active", mode === "text");
  els.rvFile.disabled = !hasFile;
  els.resumeMissing.hidden = hasFile || Boolean(text);
  if (mode === "file") {
    els.resumeFrame.removeAttribute("srcdoc");
    if (!els.resumeFrame.src.includes(item.file_id)) {
      els.resumeFrame.src = `/api/resume-file/${encodeURIComponent(item.file_id)}`;
    }
  } else {
    els.resumeFrame.srcdoc = buildResumeTextDoc(text || "（无解析文本）");
  }
}

els.rvFile.addEventListener("click", () => {
  resumeViewMode = "file";
  if (els.resumeBody.hidden) setResumeOpen(true);
  else showResume();
});
els.rvText.addEventListener("click", () => {
  resumeViewMode = "text";
  if (els.resumeBody.hidden) setResumeOpen(true);
  else showResume();
});

function setResumeOpen(open) {
  els.resumeBody.hidden = !open;
  els.resumeToggle.setAttribute("aria-expanded", String(open));
  els.resumeToggleLabel.textContent = open ? "收起简历" : "查看简历";
  els.resumeToggle.classList.toggle("is-open", open);
  if (open) showResume(); // 展开时按当前视图模式懒加载（原件请求附件 / 文本用已有解析文本）
}

els.resumeToggle.addEventListener("click", () => {
  setResumeOpen(els.resumeBody.hidden);
});

// ---------------------------------------------------------------------------
// 划词捕获：在简历预览中选中内容，浮出「捕获选中内容」按钮暂存，
// 供「换一题」的锚定栏自动填入（PDF 原生阅读器无法捕获，需在其中复制后手动粘贴）
// ---------------------------------------------------------------------------
let pendingSnippet = null; // 页面级暂存：最近一次捕获的简历片段，首次使用后消费

const selectBtn = document.createElement("button");
selectBtn.type = "button";
selectBtn.className = "sel-quote-btn";
selectBtn.textContent = "✂ 捕获选中内容";
selectBtn.hidden = true;
document.body.appendChild(selectBtn);

function hideSelectBtn() {
  selectBtn.hidden = true;
}

// 简历预览是同源 iframe：load 后在内部文档监听 mouseup，划词后浮出捕获按钮
els.resumeFrame.addEventListener("load", () => {
  const doc = els.resumeFrame.contentDocument;
  if (!doc) return;
  doc.addEventListener(
    "mouseup",
    () => {
      const sel = doc.getSelection();
      const text = sel ? sel.toString().trim() : "";
      if (!text || text.length < 8 || sel.rangeCount === 0) return hideSelectBtn();
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      selectBtn.dataset.snippet = text.slice(0, 2000);
      selectBtn.hidden = false;
      selectBtn.style.left = `${Math.max(8, Math.min(window.innerWidth - 160, rect.left + rect.width / 2 - 70))}px`;
      selectBtn.style.top = `${Math.max(8, rect.top - 38)}px`;
    }
  );
  doc.addEventListener("scroll", hideSelectBtn, true);
});
// 点其它地方 / 窗口滚动或缩放时收起按钮
document.addEventListener(
  "mousedown",
  (e) => {
    if (e.target !== selectBtn) hideSelectBtn();
  },
  true
);
window.addEventListener("scroll", hideSelectBtn, true);
window.addEventListener("resize", hideSelectBtn);

selectBtn.addEventListener("click", () => {
  const text = selectBtn.dataset.snippet || "";
  hideSelectBtn();
  if (!text) return;
  pendingSnippet = text;
  els.resumeFrame.contentDocument?.getSelection()?.removeAllRanges();
  toast("已捕获选中片段：点击任意一题的「换一题」，锚定栏将自动填入", "success", 3200);
});

// 打开换题表单时优先取最近捕获；若无则尝试实时读取 iframe 选区（HTML 简历）
function currentIframeSelection() {
  try {
    const sel = els.resumeFrame.contentDocument?.getSelection?.();
    const text = sel ? String(sel).trim() : "";
    return text.length >= 8 ? text.slice(0, 2000) : "";
  } catch {
    return "";
  }
}

// 异步回调写 DOM 前的守卫：弹窗当前展示的必须仍是这位候选人，避免后台完成的题单串进别人的弹窗
function isDetailShowing(item) {
  return state.detailIndex >= 0 && state.rankData[state.detailIndex] === item;
}

function renderQuestions(data) {
  const focus = (data.focus_areas ?? []).map(esc).join(" · ");
  els.qgResult.innerHTML = `
    ${data.notice ? `<div class="notice-banner">${esc(data.notice)}</div>` : ""}
    ${focus ? `<div class="q-focus"><b>面试重点</b>${focus}</div>` : ""}
    ${(data.questions ?? [])
      .map(
        (q, i) => `
      <article class="q-card">
        <div class="q-head">
          <span class="q-index">${i + 1}</span>
          <span class="q-cat">${esc(q.category)}</span>
          <button type="button" class="q-regen" data-qregen="${i}" aria-label="重新生成第 ${i + 1} 题" title="对这题不满意？可锚定简历片段定向换一题">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/></svg>
            <span>换一题</span>
          </button>
        </div>
        <p class="q-text">${esc(q.question)}</p>
        ${q.intent ? `<p class="q-intent"><b>考察点</b>${esc(q.intent)}</p>` : ""}
        ${q.reference ? `<p class="q-ref"><b>参考要点</b>${esc(q.reference)}</p>` : ""}
      </article>`
      )
      .join("")}`;
}

/* ---------- 题量配置（四类数量可调，偏好持久化，随生成请求提交） ---------- */

const QCOUNTS_LS_KEY = "resumelens.qcounts.v1";
const QC_DEFAULTS = { 岗位职责: 4, 技能验证: 3, 情景设计: 2, 软素质: 1 };
const QC_FIELDS = [
  ["qcJob", "岗位职责"],
  ["qcSkill", "技能验证"],
  ["qcScenario", "情景设计"],
  ["qcSoft", "软素质"],
];

function readQCounts() {
  const counts = {};
  for (const [el, cat] of QC_FIELDS) {
    counts[cat] = Math.min(10, Math.max(0, Math.round(Number(els[el].value) || 0)));
  }
  return counts;
}

function qcTotal(counts = readQCounts()) {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}

function updateQcTotal() {
  let total = 0;
  for (const [el] of QC_FIELDS) {
    const v = Math.min(10, Math.max(0, Math.round(Number(els[el].value) || 0)));
    els[el].value = v;
    const field = els[el].closest(".qc-field");
    field.querySelector(".qc-step.is-minus").disabled = v <= 0;
    field.querySelector(".qc-step.is-plus").disabled = v >= 10;
    field.classList.toggle("is-off", v === 0);
    total += v;
  }
  els.qcTotal.textContent = `共 ${total} 题`;
  els.qcTotal.classList.toggle("is-zero", total === 0);
}

// 步进器：− / ＋ 按钮微调（仍可直接输入数值）
QC_FIELDS.forEach(([el]) => {
  const input = els[el];
  const field = input.closest(".qc-field");
  const bump = (delta) => {
    const v = Math.min(10, Math.max(0, Math.round(Number(input.value) || 0) + delta));
    input.value = v;
    updateQcTotal();
  };
  field.querySelector(".qc-step.is-minus").addEventListener("click", () => bump(-1));
  field.querySelector(".qc-step.is-plus").addEventListener("click", () => bump(1));
  input.addEventListener("input", updateQcTotal);
});

function saveQCounts() {
  try {
    localStorage.setItem(QCOUNTS_LS_KEY, JSON.stringify(readQCounts()));
  } catch {
    /* 忽略 */
  }
}

function loadQCounts() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(QCOUNTS_LS_KEY) ?? "null");
  } catch {
    saved = null;
  }
  const counts = { ...QC_DEFAULTS, ...(saved && typeof saved === "object" ? saved : {}) };
  for (const [el, cat] of QC_FIELDS) {
    els[el].value = Math.min(10, Math.max(0, Math.round(Number(counts[cat]) || 0)));
  }
  updateQcTotal();
}

QC_FIELDS.forEach(([el]) => els[el].addEventListener("input", updateQcTotal));
els.qcReset.addEventListener("click", () => {
  for (const [el, cat] of QC_FIELDS) els[el].value = QC_DEFAULTS[cat];
  try {
    localStorage.removeItem(QCOUNTS_LS_KEY);
  } catch {
    /* 忽略 */
  }
  updateQcTotal();
  toast("已恢复默认题量（4 / 3 / 2 / 1）", "info", 2200);
});
loadQCounts();

els.qgGenerate.addEventListener("click", async () => {
  if (state.detailIndex < 0) return;
  const item = state.rankData[state.detailIndex];
  const jd = els.jdInput.value.trim();
  if (jd.length < 30) {
    toast("岗位 JD 内容不足，无法生成面试题");
    return;
  }
  if (!item?.resume) {
    toast("该候选人简历内容不可用");
    return;
  }
  const counts = readQCounts();
  if (!qcTotal(counts)) {
    toast("题量配置为 0 题，请至少设置一题");
    return;
  }
  saveQCounts(); // 生成时记住本次配置，后续候选人沿用

  els.qgGenerate.disabled = true;
  els.qgGenerateLabel.textContent = "生成中…";
  els.qgResult.innerHTML = '<div class="q-loading">正在生成结构化面试题，AI 模式约需半分钟…</div>';
  item.qgen = "pending"; // 标记生成中：重开弹窗时展示进度而不是旧题单（不持久化，刷新后作废）
  try {
    const res = await fetch("/api/interview-questions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jd,
        resume: item.resume,
        counts,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.detail ?? `生成失败（${res.status}）`);
    item.questions = data; // 题单随候选人保存，直到使用者主动重新生成
    saveRank();
    if (isDetailShowing(item)) {
      renderQuestions(data);
    } else {
      // 弹窗已关闭：告知生成已完成，重开即可看到新题单
      toast(`已为 ${item.result.candidate || item.filename} 生成新的面试题`, "success", 3200);
    }
  } catch (err) {
    if (isDetailShowing(item)) {
      // 弹窗仍开着：还原旧题单（若有）并提示失败，避免空白或误导性的加载状态
      if (item.questions) renderQuestions(item.questions);
      else els.qgResult.innerHTML = '<p class="empty-note">生成失败，可点击右上角按钮重试</p>';
    }
    toast(err.message || "生成失败，请稍后重试");
  } finally {
    item.qgen = null;
    if (isDetailShowing(item)) {
      els.qgGenerate.disabled = false;
      els.qgGenerateLabel.textContent = item.questions ? "重新生成全套题" : "基于 JD 与该简历生成面试题";
    }
  }
});

// 单题重新生成：对某一题不满意时，可锚定简历片段定向换题（其余题目保持不变）
const regenForm = document.createElement("div");
regenForm.className = "q-regen-form";
regenForm.innerHTML = `
  <p class="qregen-tip">锚定简历片段（可选）：切到简历「文本」视图划词捕获后自动填入；也可手动粘贴</p>
  <textarea rows="3" maxlength="2000" placeholder="想让新题围绕简历中的哪段内容深挖？留空则按 JD 主线换题"></textarea>
  <input type="text" class="qregen-hint" maxlength="100" placeholder="补充要求（可选）：如「更偏原理细节」「换个项目经历问」" />
  <div class="qregen-act">
    <button type="button" class="btn btn-ghost btn-sm qregen-cancel">取消</button>
    <button type="button" class="btn btn-primary btn-sm qregen-go">生成替换</button>
  </div>`;
const regenAnchor = regenForm.querySelector("textarea");
const regenHint = regenForm.querySelector(".qregen-hint");
const regenGo = regenForm.querySelector(".qregen-go");
let regenOpenIdx = -1;
let regenBusy = false;

function closeRegenForm() {
  regenOpenIdx = -1;
  regenForm.remove();
}

// 点「换一题」展开/收起锚定表单；锚定栏自动带入最近捕获或当前选区（首次使用后消费）
els.qgResult.addEventListener("click", (e) => {
  const btn = e.target.closest(".q-regen");
  if (!btn || btn.classList.contains("is-busy")) return;
  const idx = Number(btn.dataset.qregen);
  if (Number.isNaN(idx)) return;
  if (regenOpenIdx === idx && regenForm.isConnected) return closeRegenForm();
  regenOpenIdx = idx;
  regenAnchor.value = pendingSnippet ?? currentIframeSelection();
  pendingSnippet = null;
  regenHint.value = "";
  regenGo.disabled = false;
  regenGo.textContent = "生成替换";
  btn.closest(".q-card").appendChild(regenForm);
  regenAnchor.focus();
});

regenForm.querySelector(".qregen-cancel").addEventListener("click", closeRegenForm);

regenGo.addEventListener("click", async () => {
  if (regenBusy || regenOpenIdx < 0) return;
  const item = state.rankData[state.detailIndex];
  const qd = item?.questions;
  const cur = qd?.questions?.[regenOpenIdx];
  if (!item || !qd || !cur) return closeRegenForm();
  const jd = els.jdInput.value.trim();
  if (jd.length < 30) {
    toast("岗位 JD 内容不足，无法重新生成");
    return;
  }
  if (!item.resume) {
    toast("该候选人简历内容不可用");
    return;
  }

  const idx = regenOpenIdx;
  const anchor = regenAnchor.value.trim();
  const hint = regenHint.value.trim();
  regenBusy = true;
  regenGo.disabled = true;
  regenGo.textContent = "生成中…";
  try {
    const res = await fetch("/api/interview-question-regenerate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jd,
        resume: item.resume,
        question: cur.question,
        category: cur.category ?? "",
        others: qd.questions.filter((_, i) => i !== idx).map((q) => q.question),
        ...(anchor ? { focus_snippet: anchor } : {}),
        ...(hint ? { hint } : {}),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) throw new Error(data?.detail ?? `生成失败（${res.status}）`);
    qd.questions[idx] = data.question;
    saveRank();
    closeRegenForm();
    if (isDetailShowing(item)) {
      renderQuestions(qd);
      const card = els.qgResult.querySelector(`[data-qregen="${idx}"]`)?.closest(".q-card");
      if (card) {
        card.classList.add("is-new");
        card.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    }
    toast(anchor ? `已围绕锚定片段替换第 ${idx + 1} 题` : `已替换第 ${idx + 1} 题`, "success", 2400);
  } catch (err) {
    if (isDetailShowing(item)) {
      regenGo.disabled = false;
      regenGo.textContent = "重试";
    } else {
      closeRegenForm();
    }
    toast(err.message || "生成失败，请稍后重试");
  } finally {
    regenBusy = false;
  }
});
