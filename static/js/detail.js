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

  // 简历附件：默认收起，展开后内嵌展示原件（PDF 原生阅读器 / DOCX、TXT 转 HTML 预览）
  const hasFile = Boolean(item.file_id);
  const hasResumeText = Boolean((item.resume ?? "").trim());
  els.resumeFrame.src = "";
  els.resumeFrame.hidden = !hasFile;
  els.resumeMissing.hidden = hasFile || !hasResumeText;
  els.resumeToggle.hidden = !hasFile && !hasResumeText;
  setResumeOpen(false);

  // 题单随候选人持久保留，直到使用者主动重新生成
  if (item.questions) {
    renderQuestions(item.questions);
  } else {
    els.qgResult.innerHTML =
      '<p class="empty-note">点击右上角按钮，基于岗位 JD 与该候选人简历生成结构化面试题（含考察意图与参考答案要点）</p>';
  }
  els.qgGenerateLabel.textContent = item.questions ? "重新生成全套题" : "基于 JD 与该简历生成面试题";

  els.detailOverlay.hidden = false;
  document.body.style.overflow = "hidden";
  els.detailClose.focus();
}

export function closeDetail() {
  if (!els.impOverlay.hidden) closeImprovement(); // 详情关闭时叠加的优化点弹窗一并关闭
  els.detailOverlay.hidden = true;
  document.body.style.overflow = "";
  state.detailIndex = -1;
}

els.detailClose.addEventListener("click", closeDetail);
els.detailOverlay.addEventListener("click", (e) => {
  if (e.target === els.detailOverlay) closeDetail();
});

function setResumeOpen(open) {
  els.resumeBody.hidden = !open;
  els.resumeToggle.setAttribute("aria-expanded", String(open));
  els.resumeToggleLabel.textContent = open ? "收起简历" : "查看简历";
  els.resumeToggle.classList.toggle("is-open", open);
  if (open) {
    // 懒加载：展开时才加载附件，避免每次打开弹窗都发起请求
    const item = state.rankData[state.detailIndex];
    const fileId = item?.file_id;
    if (fileId && !els.resumeFrame.src.includes(fileId)) {
      els.resumeFrame.src = `/api/resume-file/${encodeURIComponent(fileId)}`;
    }
  }
}

els.resumeToggle.addEventListener("click", () => {
  setResumeOpen(els.resumeBody.hidden);
});

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
          <button type="button" class="q-regen" data-qregen="${i}" aria-label="重新生成第 ${i + 1} 题" title="对这题不满意？换一题">
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

  els.qgGenerate.disabled = true;
  els.qgGenerateLabel.textContent = "生成中…";
  els.qgResult.innerHTML = '<div class="q-loading">正在生成结构化面试题，AI 模式约需半分钟…</div>';
  try {
    const res = await fetch("/api/interview-questions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jd, resume: item.resume }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.detail ?? `生成失败（${res.status}）`);
    item.questions = data; // 题单随候选人保存，直到使用者主动重新生成
    saveRank();
    renderQuestions(data);
  } catch (err) {
    els.qgResult.innerHTML = "";
    toast(err.message || "生成失败，请稍后重试");
  } finally {
    els.qgGenerate.disabled = false;
    els.qgGenerateLabel.textContent = item?.questions ? "重新生成全套题" : "基于 JD 与该简历生成面试题";
  }
});

// 单题重新生成：面试官对某一题不满意时仅替换该题，其余题目保持不变
els.qgResult.addEventListener("click", async (e) => {
  const btn = e.target.closest(".q-regen");
  if (!btn || btn.classList.contains("is-busy")) return;
  const item = state.rankData[state.detailIndex];
  const qd = item?.questions;
  const idx = Number(btn.dataset.qregen);
  const cur = qd?.questions?.[idx];
  if (!item || !qd || !cur) return;

  const jd = els.jdInput.value.trim();
  if (jd.length < 30) {
    toast("岗位 JD 内容不足，无法重新生成");
    return;
  }
  if (!item.resume) {
    toast("该候选人简历内容不可用");
    return;
  }

  btn.classList.add("is-busy");
  btn.querySelector("span").textContent = "生成中…";
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
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) throw new Error(data?.detail ?? `生成失败（${res.status}）`);
    qd.questions[idx] = data.question;
    saveRank();
    renderQuestions(qd);
    if (data.notice) toast(data.notice, "info", 3800);
    else toast(`已替换第 ${idx + 1} 题`, "success", 2200);
  } catch (err) {
    renderQuestions(qd); // 恢复按钮状态
    toast(err.message || "生成失败，请稍后重试");
  }
});
