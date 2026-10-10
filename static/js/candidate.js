/* 求职者视角：简历选择、体检/匹配评估、结果渲染、优化点详情弹窗、结果保留与岗位推荐 */

import { els } from "./dom.js";
import { state } from "./state.js";
import {
  ALLOWED,
  RING_C,
  CANDIDATE_LS_KEY,
  PRIORITY_LABELS,
  ACTION_LABELS,
  JOB_PLATFORMS,
  extLinkSvg,
} from "./constants.js";
import { esc, formatSize, toast, observeReveals, fileSig, toneOf } from "./utils.js";
import { updateJdCount } from "./jd.js";

/* ---------- 提交按钮文案与重复体检判定 ---------- */

// 求职者视角的当前模式：JD ≥30 字 = 岗位匹配，否则 = 简历体检
const currentCandidateMode = () => (els.jdInput.value.trim().length >= 30 ? "match" : "review");

// 当前输入（模式 + JD + 简历文件指纹）是否与最近一次已保留的结果完全一致
function sameInputAsLastCheck(mode = currentCandidateMode()) {
  const lc = state.lastCheck;
  return Boolean(
    lc &&
      lc.mode === mode &&
      lc.jd === els.jdInput.value.trim() &&
      state.file &&
      lc.fileSig &&
      fileSig(state.file) === lc.fileSig
  );
}

// 提交按钮文案：面试官视角为批量评估；求职者视角看 JD 与上次结果切换「开始/重新·匹配分析/简历体检」
export function refreshEvaluateLabel() {
  if (state.busy) return;
  if (state.view === "interviewer") {
    els.evaluateLabel.textContent = "批量评估排名";
    return;
  }
  const mode = currentCandidateMode();
  if (sameInputAsLastCheck(mode)) {
    els.evaluateLabel.textContent = mode === "review" ? "重新体检" : "重新分析";
  } else {
    els.evaluateLabel.textContent = mode === "review" ? "开始简历体检" : "开始匹配分析";
  }
}

/* ---------- 简历文件选择（单份） ---------- */

export function setFile(file) {
  if (!file) return;
  const ext = "." + (file.name.split(".").pop() ?? "").toLowerCase();
  if (!ALLOWED.includes(ext)) {
    toast(`不支持的格式「${ext}」，请上传 PDF / DOCX / TXT / MD`);
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    toast("文件超过 10 MB 限制，请压缩后重试");
    return;
  }
  if (file.size === 0) {
    toast("文件为空，请检查后重新选择");
    return;
  }
  state.file = file;
  els.fileName.textContent = file.name;
  els.fileSize.textContent = formatSize(file.size);
  els.fileChip.hidden = false;
  els.dropzone.classList.add("has-file");
  els.dropzone.setAttribute("aria-label", `已选择文件：${file.name}，点击可重新选择`);
  refreshEvaluateLabel(); // 换文件后与上次结果的对比关系变化，刷新按钮文案
}

export function clearFile() {
  state.file = null;
  els.fileInput.value = "";
  els.fileChip.hidden = true;
  els.dropzone.classList.remove("has-file");
  els.dropzone.setAttribute("aria-label", "点击或拖拽上传简历文件，支持 PDF、DOCX、TXT、MD，不超过 10 MB");
  refreshEvaluateLabel();
}

els.dropzone.addEventListener("click", () => els.fileInput.click());
els.dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    els.fileInput.click();
  }
});
els.fileRemove.addEventListener("click", (e) => {
  e.stopPropagation();
  clearFile();
});

["dragenter", "dragover"].forEach((evt) =>
  els.dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    els.dropzone.classList.add("is-dragover");
  })
);
["dragleave", "drop"].forEach((evt) =>
  els.dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    els.dropzone.classList.remove("is-dragover");
  })
);

/* ---------- 评估（单份） ---------- */

export function setLoading(loading, label) {
  state.busy = loading;
  els.evaluateBtn.classList.toggle("is-loading", loading);
  if (label) {
    els.evaluateLabel.textContent = label;
  } else {
    refreshEvaluateLabel();
  }
}

let recheckArmed = null; // 重复体检二次确认的定时器

// 求职者视角提交（视角分发与 JD 校验在 app.js 的 evaluate 入口）
export async function evaluateCandidate(jd) {
  if (!state.file) {
    toast("请先上传简历文件（PDF / DOCX / TXT / MD）");
    return;
  }

  // 重复体检守卫：模式、JD、简历文件均与已保留结果完全相同时，需二次确认才重新分析
  const mode = jd.length >= 30 ? "match" : "review";
  if (!recheckArmed && sameInputAsLastCheck(mode)) {
    recheckArmed = setTimeout(() => {
      recheckArmed = null;
      els.evaluateBtn.classList.remove("btn-danger-armed");
      refreshEvaluateLabel();
    }, 3000);
    els.evaluateBtn.classList.add("btn-danger-armed");
    els.evaluateLabel.textContent = mode === "review" ? "简历未变更，仍要重新体检？" : "输入未变更，仍要重新分析？";
    toast(
      "附件简历与上次体检时完全相同（未检测到差异），无需重新体检；如简历已修改请重新选择文件，或再次点击按钮强制重检",
      "info",
      5600
    );
    return;
  }
  if (recheckArmed) {
    clearTimeout(recheckArmed);
    recheckArmed = null;
    els.evaluateBtn.classList.remove("btn-danger-armed");
  }

  const form = new FormData();
  form.append("jd", jd);
  form.append("file", state.file);

  setLoading(true, jd.length >= 30 ? "正在分析…" : "正在体检简历…");
  try {
    const res = await fetch("/api/evaluate", { method: "POST", body: form });
    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error("服务返回了无法解析的内容");
    }
    if (!res.ok) {
      const detail = Array.isArray(data?.detail)
        ? data.detail.map((e) => e?.msg ?? String(e)).join("；")
        : data?.detail;
      throw new Error(detail ?? `请求失败（${res.status}）`);
    }
    // 保留本次结果（含文件指纹），刷新后可恢复
    state.lastCheck = {
      mode,
      jd,
      fileSig: fileSig(state.file),
      fileName: state.file.name,
      result: data,
      time: candTimeLabel(),
    };
    saveCandidate();
    render(data);
    els.results.scrollIntoView({ behavior: "smooth", block: "start" });
    if (mode === "review") loadJobRecommend(); // 体检模式：后台生成岗位推荐，不阻塞结果展示
  } catch (err) {
    toast(err.message || "网络错误，请稍后重试");
  } finally {
    setLoading(false);
  }
}

/* ---------- 结果渲染 ---------- */

function animateCounter(el, target, duration = 1200) {
  const start = performance.now();
  const tick = (now) => {
    const t = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(target * eased);
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function render(data) {
  els.results.hidden = false;

  // 体检模式（未填 JD）：总分标题与关键词区文案切换
  const review = data.mode === "review";
  els.scoreEyebrowText.textContent = review ? "简历质量评分" : "综合匹配度";
  els.kwGroupTitle.textContent = review ? "核心关键词" : "关键词覆盖";
  els.kwMatchedLabel.textContent = review ? "简历已呈现" : "已覆盖";
  els.kwMissingLabel.textContent = review ? "建议补充" : "未覆盖";
  // 岗位推荐：仅体检模式显示；有缓存直接渲染，否则区分「可重试」与「旧数据无法生成」
  if (review) {
    els.jobBlock.hidden = false;
    els.jobGap.hidden = true;
    els.jobNotice.hidden = true;
    if (state.lastCheck?.jobs) {
      renderJobs();
    } else if (state.lastCheck?.result?.resume) {
      // 有简历文本但尚未生成推荐（上次生成失败/中断）：可重试
      els.jobList.innerHTML = '<p class="empty-note">岗位推荐尚未生成，点击右侧「重新生成」按钮重试</p>';
      els.jobMeta.textContent = "";
      els.jobRetry.hidden = false;
    } else {
      // 旧版本保留的结果没有简历文本，无法生成推荐：提示重新体检
      els.jobList.innerHTML =
        '<p class="empty-note">当前保留的分析结果由旧版本生成，缺少简历文本，无法生成岗位推荐；重新上传简历体检一次即可</p>';
      els.jobMeta.textContent = "";
      els.jobRetry.hidden = true;
    }
  } else {
    els.jobBlock.hidden = true;
  }

  // 提示横幅
  if (data.notice) {
    els.noticeBanner.textContent = data.notice;
    els.noticeBanner.hidden = false;
  } else {
    els.noticeBanner.hidden = true;
  }

  // 总分（配色随分数变化）
  const score = Number(data.overall_score) || 0;
  els.scoreCard.dataset.tone = toneOf(score);
  els.ringBar.style.strokeDashoffset = RING_C;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      els.ringBar.style.strokeDashoffset = RING_C * (1 - score / 100);
    })
  );
  animateCounter(els.scoreNumber, score);
  els.verdictText.textContent = data.verdict || "—";
  els.scoreEngineTag.textContent = "AI 评估";

  // 统计行与分组计数
  const strengths = data.strengths ?? [];
  const improvements = data.improvements ?? [];
  const matched = data.matched_keywords ?? [];
  const missing = data.missing_keywords ?? [];
  els.scoreStats.innerHTML = `
    <span class="stat-pill"><b>${matched.length}</b>/${matched.length + missing.length} 关键词</span>
    <span class="stat-pill stat-good"><b>${strengths.length}</b> 项优点</span>
    <span class="stat-pill stat-warn"><b>${improvements.length}</b> 项待优化</span>`;
  els.strengthCount.textContent = `${strengths.length} 项`;

  // 维度卡
  els.dimensionsGrid.innerHTML = (data.dimensions ?? [])
    .map(
      (d, i) => `
      <div class="dim-card reveal" style="--reveal-delay:${i * 60}ms" data-tone="${toneOf(d.score)}">
        <div class="dim-head">
          <span class="dim-name">${esc(d.name)}</span>
          <span class="dim-score">${Math.round(d.score)}</span>
        </div>
        <div class="dim-bar"><div class="dim-bar-fill" data-w="${Math.round(d.score)}"></div></div>
        <p class="dim-comment">${esc(d.comment)}</p>
      </div>`
    )
    .join("");

  // 优点
  els.strengthsList.innerHTML = strengths.length
    ? strengths
        .map(
          (s, i) => `
        <article class="point-card point-card-good reveal" style="--reveal-delay:${i * 60}ms">
          <div class="point-head">
            <span class="point-index">${i + 1}</span>
            <h4 class="point-title">${esc(s.title)}</h4>
          </div>
          <p class="point-detail">${esc(s.detail)}</p>
        </article>`
        )
        .join("")
    : '<p class="empty-note">未发现明显优势项，建议先补充与岗位相关的经历。</p>';

  // 待优化点（可交互：处理动作徽标 + 展开原文对照）
  els.improvementsList.innerHTML = improvements.length
    ? improvements.map((it, i) => improvementCardHtml(it, i, { reveal: true })).join("")
    : '<p class="empty-note">未发现明显短板，保持现状即可。</p>';
  updateImproveCount();

  // 关键词
  els.kwMatchedCount.textContent = `${matched.length} 项`;
  els.kwMissingCount.textContent = `${missing.length} 项`;
  els.kwMatched.innerHTML = matched.length
    ? matched.map((k, i) => `<span class="kw-chip" style="animation-delay:${i * 35}ms">${esc(k)}</span>`).join("")
    : `<span class="empty-note">${review ? "未从简历中识别出核心关键词" : "未检测到已覆盖的 JD 关键词"}</span>`;
  els.kwMissing.innerHTML = missing.length
    ? missing.map((k, i) => `<span class="kw-chip" style="animation-delay:${i * 35}ms">${esc(k)}</span>`).join("")
    : `<span class="empty-note">${review ? "暂无补充建议，可结合目标岗位补齐方向" : "JD 核心关键词全部覆盖"}</span>`;

  // 改写示范
  if (data.rewritten_summary) {
    els.summaryText.textContent = data.rewritten_summary;
    els.summaryBlock.hidden = false;
  } else {
    els.summaryBlock.hidden = true;
  }

  // 触发揭示动画，稍后填充进度条；并兜底确保所有元素可见
  observeReveals(els.results);
  setTimeout(() => {
    els.dimensionsGrid.querySelectorAll(".dim-bar-fill").forEach((bar) => {
      bar.style.width = `${bar.dataset.w}%`;
    });
  }, 150);
  setTimeout(() => {
    els.results.querySelectorAll(".reveal:not(.is-visible)").forEach((el) => el.classList.add("is-visible"));
  }, 1200);
}

/* ---------- 待优化点：点击卡片打开详情弹窗 ---------- */

// 构建待优化点卡片：点击打开详情弹窗；reveal 控制入场动画（面试官详情弹窗内不启用）
function improvementCardHtml(it, i, { reveal = false } = {}) {
  const action = ACTION_LABELS[it.action] ?? "";
  return `
    <article class="point-card point-card-warn${reveal ? " reveal" : ""}" style="--reveal-delay:${i * 60}ms" data-imp="${i}" tabindex="0" role="button"
             aria-label="查看待优化点详情：${esc(it.title)}">
      <div class="point-head">
        <span class="point-index">${i + 1}</span>
        <h4 class="point-title">${esc(it.title)}</h4>
        ${action ? `<span class="action-pill" data-action="${action}">${action}</span>` : ""}
        ${it.priority ? `<span class="priority-pill" data-priority="${esc(it.priority)}">${PRIORITY_LABELS[it.priority] ?? esc(it.priority)}</span>` : ""}
        <svg class="point-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
      </div>
      <p class="point-detail">${esc(it.detail)}</p>
      ${it.suggestion ? `<div class="point-suggestion"><span class="sug-label">建议</span><span class="sug-text">${esc(it.suggestion)}</span></div>` : ""}
    </article>`;
}

function updateImproveCount() {
  const n = state.lastCheck?.result?.improvements?.length ?? 0;
  els.improveCount.textContent = `${n} 项`;
}

// 打开优化点详情弹窗（it 为完整待优化项；i 仅用于序号展示）
export function openImprovement(it, i) {
  if (!it) return;
  state.impItem = it;
  els.impIndex.textContent = i + 1;
  els.impTitle.textContent = it.title ?? "待优化点";
  const action = ACTION_LABELS[it.action] ?? "";
  els.impAction.hidden = !action;
  if (action) {
    els.impAction.textContent = action;
    els.impAction.dataset.action = action;
  }
  const pr = it.priority ?? "";
  els.impPriority.hidden = !pr;
  if (pr) {
    els.impPriority.dataset.priority = pr;
    els.impPriority.textContent = PRIORITY_LABELS[pr] ?? pr;
  }
  els.impDetail.textContent = it.detail ?? "";
  els.impSuggestionWrap.hidden = !it.suggestion;
  els.impSuggestionText.textContent = it.suggestion ?? "";
  els.impOriginalBlock.hidden = !it.original_text;
  els.impOriginal.textContent = it.original_text ?? "";
  els.impRevisedBlock.hidden = !it.revised_text;
  els.impRevised.textContent = it.revised_text ?? "";
  els.impNoDiff.hidden = Boolean(it.original_text || it.revised_text);
  els.impOverlay.hidden = false;
  els.impClose.focus();
}

export function closeImprovement() {
  els.impOverlay.hidden = true;
  state.impItem = null;
}

els.impClose.addEventListener("click", closeImprovement);
els.impOverlay.addEventListener("click", (e) => {
  if (e.target === els.impOverlay) closeImprovement();
});
els.impCopy.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(state.impItem?.revised_text ?? "");
    toast("已复制优化后的文字", "success", 2200);
  } catch {
    toast("复制失败，请手动选择文本复制");
  }
});

// 求职者结果区：点击/回车待优化点卡片打开详情弹窗
els.improvementsList.addEventListener("click", (e) => {
  const card = e.target.closest(".point-card[data-imp]");
  if (card) {
    const idx = Number(card.dataset.imp);
    openImprovement(state.lastCheck?.result?.improvements?.[idx], idx);
  }
});
els.improvementsList.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const card = e.target.closest?.(".point-card[data-imp]");
  if (card) {
    e.preventDefault();
    const idx = Number(card.dataset.imp);
    openImprovement(state.lastCheck?.result?.improvements?.[idx], idx);
  }
});

/* ---------- 结果保留 / 恢复 ---------- */

function candTimeLabel(d = new Date()) {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}

function saveCandidate() {
  if (!state.lastCheck) {
    clearCandidateStorage();
    return;
  }
  try {
    localStorage.setItem(CANDIDATE_LS_KEY, JSON.stringify(state.lastCheck));
  } catch (err) {
    console.warn("分析结果保存失败（可能超出本地存储限额）：", err);
  }
}

export function clearCandidateStorage() {
  try {
    localStorage.removeItem(CANDIDATE_LS_KEY);
  } catch {
    /* 忽略 */
  }
}

export function restoreCandidate() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(CANDIDATE_LS_KEY) ?? "null");
  } catch {
    saved = null;
  }
  if (!saved || !saved.result || typeof saved.result.overall_score !== "number") return;
  if (saved.result.engine !== "llm") return; // 旧版本（本地引擎）结果与现行口径不可比，不恢复
  state.lastCheck = saved;
  if (saved.mode === "match" && saved.jd && els.jdInput.value.trim() === "") {
    els.jdInput.value = saved.jd;
    updateJdCount();
  }
  render(saved.result);
  const label = saved.mode === "review" ? "简历体检" : "岗位匹配分析";
  const prefix = `已保留上次${label}结果（${saved.fileName || "简历"}${saved.time ? " · " + saved.time : ""}）；简历有修改后点击下方「重新体检」更新，未变更时无需重检`;
  els.noticeBanner.textContent = saved.result.notice ? `${prefix}。${saved.result.notice}` : prefix;
  els.noticeBanner.hidden = false;
  observeReveals(els.results);
  refreshEvaluateLabel();
  toast(`已恢复上次${label}结果，可继续查看或修改后重新分析`, "info", 4200);
}

/* ---------- 岗位推荐（体检后自动生成，随结果保留） ---------- */

function renderJobs() {
  const jobs = state.lastCheck?.jobs;
  els.jobBlock.hidden = !(state.lastCheck?.mode === "review");
  els.jobNotice.hidden = !jobs?.notice;
  els.jobNotice.textContent = jobs?.notice ?? "";
  const positions = jobs?.positions ?? [];
  els.jobMeta.textContent = positions.length
    ? `${positions.length} 个方向 · AI 推荐`
    : "";
  els.jobRetry.hidden = true;
  els.jobList.innerHTML = positions.length
    ? positions
        .map((p, i) => {
          const kw = (p.search_keywords ?? [])[0] || p.title || "";
          const metaLine = [p.industry, p.level, (p.cities ?? []).join(" / ")]
            .filter(Boolean)
            .map(esc)
            .join(" · ");
          return `
      <article class="job-card reveal" style="--reveal-delay:${i * 60}ms">
        <div class="job-head">
          <h4 class="job-title">${esc(p.title)}</h4>
          ${p.salary_range ? `<span class="job-salary">${esc(p.salary_range)}</span>` : ""}
        </div>
        ${metaLine ? `<p class="job-meta-line">${metaLine}</p>` : ""}
        ${p.match_reason ? `<p class="job-reason">${esc(p.match_reason)}</p>` : ""}
        ${(p.search_keywords ?? []).length ? `<div class="chip-set job-kws">${(p.search_keywords ?? []).map((k) => `<span class="kw-chip">${esc(k)}</span>`).join("")}</div>` : ""}
        <div class="job-platforms">
          ${JOB_PLATFORMS.map((pf) => `<a class="job-plat-btn" href="${pf.build(kw)}" target="_blank" rel="noopener noreferrer">${pf.name}${extLinkSvg}</a>`).join("")}
        </div>
      </article>`;
        })
        .join("")
    : '<p class="empty-note">未生成岗位推荐，可点击「重新生成」重试</p>';
  const gaps = jobs?.gap_skills ?? [];
  els.jobGap.hidden = !gaps.length;
  if (gaps.length) {
    els.jobGap.innerHTML = `<b>扩大岗位选择面，建议补齐：</b>${gaps.map(esc).join("、")}`;
  }
  observeReveals(els.jobBlock);
}

async function loadJobRecommend() {
  const lc = state.lastCheck;
  if (!lc || lc.mode !== "review") return;
  if (!lc.result?.resume) {
    // 旧版本保留的结果没有简历文本：给出明确反馈而非静默返回
    els.jobList.innerHTML =
      '<p class="empty-note">当前保留的分析结果由旧版本生成，缺少简历文本，无法生成岗位推荐；重新上传简历体检一次即可</p>';
    els.jobRetry.hidden = true;
    toast("该结果由旧版本生成，缺少简历文本；重新体检一次即可生成岗位推荐", "info", 5200);
    return;
  }
  els.jobBlock.hidden = false;
  els.jobList.innerHTML = '<div class="q-loading">正在根据简历推荐岗位方向与搜索关键词，AI 模式约需半分钟…</div>';
  els.jobMeta.textContent = "";
  els.jobRetry.hidden = true;
  els.jobNotice.hidden = true;
  els.jobGap.hidden = true;
  try {
    const res = await fetch("/api/job-recommend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resume: lc.result.resume }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.detail ?? `生成失败（${res.status}）`);
    lc.jobs = data;
    saveCandidate();
    renderJobs();
    toast(`已生成 ${data.positions?.length ?? 0} 个岗位方向推荐`, "success", 2600);
  } catch (err) {
    els.jobList.innerHTML = '<p class="empty-note">岗位推荐生成失败，点击「重新生成」重试</p>';
    els.jobRetry.hidden = false;
    toast(err.message || "岗位推荐生成失败，请稍后重试");
  }
}

els.jobRetry.addEventListener("click", loadJobRecommend);

/* ---------- 复制改写示范 ---------- */

els.copySummary.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(els.summaryText.textContent);
    toast("已复制到剪贴板", "success", 2200);
  } catch {
    toast("复制失败，请手动选择文本复制");
  }
});
