/* 面试官视角：简历队列、批量评估（增量）、榜单渲染与排名历史 */

import { els } from "./dom.js";
import { state } from "./state.js";
import { ALLOWED, RANK_LS_KEY } from "./constants.js";
import { esc, formatSize, toast, observeReveals, fileSig, toneOf, deleteResumeFiles } from "./utils.js";
import { updateJdCount } from "./jd.js";
import { saveRank, clearRankStorage } from "./rank-store.js";
import { setLoading } from "./candidate.js";

/* ---------- 多份文件管理 ---------- */

export function addBatchFiles(fileList) {
  const files = Array.from(fileList ?? []);
  if (!files.length) return;
  let added = 0;
  for (const file of files) {
    const ext = "." + (file.name.split(".").pop() ?? "").toLowerCase();
    if (!ALLOWED.includes(ext)) {
      toast(`已跳过「${file.name}」：不支持的格式`);
      continue;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast(`已跳过「${file.name}」：超过 10 MB 限制`);
      continue;
    }
    if (file.size === 0) {
      toast(`已跳过「${file.name}」：文件为空`);
      continue;
    }
    if (state.batchFiles.some((f) => f.name === file.name && f.size === file.size)) continue;
    state.batchFiles.push(file);
    added += 1;
  }
  if (state.batchFiles.length > 20) {
    state.batchFiles = state.batchFiles.slice(0, 20);
    toast("最多保留前 20 份简历");
  }
  if (added > 0) toast(`已添加 ${added} 份简历，共 ${state.batchFiles.length} 份`, "success", 2200);
  renderBatchList();
}

// 增量评估切分：同一 JD、同一引擎下，已在排名中且内容未变的简历无需重评，只提交新增/变更的文件
function splitPendingFiles(jd) {
  const incremental = state.rankJd === jd && state.rankData.length > 0;
  const pending = [];
  let skipped = 0;
  for (const f of state.batchFiles) {
    const ranked =
      incremental &&
      state.rankData.some((d) => d.sig === fileSig(f) && d.result.engine === state.engine);
    if (ranked) skipped += 1;
    else pending.push(f);
  }
  return { pending, skipped };
}

export function renderBatchList() {
  els.batchFileList.hidden = state.view === "candidate" || state.batchFiles.length === 0;
  const itemsHtml = state.batchFiles
    .map(
      (f, i) => `
      <div class="batch-file-item">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M13 2v7h7"/></svg>
        <div class="file-chip-body">
          <span class="file-name">${esc(f.name)}</span>
          <span class="file-size">${formatSize(f.size)}</span>
        </div>
        <button type="button" class="icon-btn batch-remove" data-index="${i}" aria-label="移除 ${esc(f.name)}">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>`
    )
    .join("");
  let footer = "";
  if (state.batchFiles.length) {
    const jdNow = els.jdInput.value.trim();
    const { pending, skipped } = splitPendingFiles(jdNow);
    if (state.rankData.length && state.rankJd && state.rankJd !== jdNow) {
      footer = `<p class="batch-count">JD 已变更，重新评估将重开新榜并全量评估 ${state.batchFiles.length} 份简历</p>`;
    } else if (skipped) {
      footer = `<p class="batch-count">共 ${state.batchFiles.length} 份简历：待评估 ${pending.length} 份 · 已计入排名 ${skipped} 份（增量评估自动跳过）</p>`;
    } else {
      footer = `<p class="batch-count">共 ${state.batchFiles.length} 份简历，点击「批量评估排名」开始分析</p>`;
    }
  }
  els.batchFileList.innerHTML = itemsHtml + footer;
}

els.batchFileList.addEventListener("click", (e) => {
  const btn = e.target.closest(".batch-remove");
  if (btn) {
    state.batchFiles.splice(Number(btn.dataset.index), 1);
    renderBatchList();
  }
});

/* ---------- 批量评估 ---------- */

export async function evaluateBatch(jd) {
  if (!state.batchFiles.length) {
    toast("请先上传至少一份候选人简历（支持一次多选）");
    return;
  }
  // 增量评估：同一 JD 下已计入排名且内容未变的简历不再重评，仅提交新增/变更的文件
  const { pending, skipped } = splitPendingFiles(jd);
  if (!pending.length) {
    toast("队列中的简历均已评估并计入当前排名；如需重新评估某位候选人，可先在排名中移除其卡片，再点击「批量评估排名」", "info", 5200);
    els.resultsRank.hidden = false;
    els.resultsRank.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  const form = new FormData();
  form.append("jd", jd);
  pending.forEach((f) => form.append("files", f));

  setLoading(true, `正在评估 ${pending.length} 份简历${skipped ? `（已跳过 ${skipped} 份）` : ""}…`);
  try {
    const res = await fetch("/api/batch-evaluate", { method: "POST", body: form });
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
    renderRank(data, jd, new Map(pending.map((f) => [f.name, fileSig(f)])), skipped);
    els.resultsRank.hidden = false;
    observeReveals(els.resultsRank);
    els.resultsRank.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    toast(err.message || "网络错误，请稍后重试");
  } finally {
    setLoading(false);
  }
}

/* ---------- 榜单渲染 ---------- */

const chevronSvg =
  '<svg class="chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';

function renderRank(data, jd, sigMap = new Map(), skipped = 0) {
  const okItems = data.results.filter((r) => r.ok);
  const errItems = data.results.filter((r) => !r.ok);

  // 换了 JD：分数口径不同，开启全新排名历史；同一 JD：追加合并
  if (state.rankJd !== jd) {
    deleteResumeFiles(state.rankData.map((d) => d.file_id)); // 旧榜作废，附件同步清理
    state.rankJd = jd;
    state.rankData = [];
    state.rankBatches = 0;
  }

  const isAppend = state.rankBatches > 0 && state.rankData.length > 0;
  state.rankBatches += 1;
  const time = rankTimeLabel();

  let replaced = 0;
  for (const item of okItems) {
    item.batch = state.rankBatches;
    item.time = time;
    item.sig = sigMap.get(item.filename) ?? ""; // 文件指纹：供下次增量评估识别「未变更的简历」
    // 同名文件视为同一候选人重新提交：用最新评估覆盖，并作废其面试题缓存
    const idx = state.rankData.findIndex((d) => d.filename === item.filename);
    if (idx >= 0) {
      deleteResumeFiles([state.rankData[idx].file_id]); // 旧附件已被新版替代，同步删除避免孤儿
      state.rankData[idx] = item; // 新评估覆盖旧记录（含旧题单，简历已变）
      replaced += 1;
    } else {
      state.rankData.push(item);
    }
  }
  state.rankData.sort((a, b) => (b.result.overall_score ?? 0) - (a.result.overall_score ?? 0));
  saveRank();
  renderRankList();
  renderBatchList(); // 本批文件已计入排名，队列底部「待评估 / 已跳过」提示随之刷新

  // 提示横幅：失败文件不入排名；跨批次混榜时提醒评分存在采样波动
  const notices = [];
  if (errItems.length) {
    notices.push(
      `${errItems.length} 份文件解析失败，未纳入排名：${errItems
        .map((e) => `${e.filename}（${e.error ?? "未知错误"}）`)
        .join("；")}`
    );
  }
  const engines = new Set(state.rankData.map((d) => d.result.engine));
  if (engines.size > 1) {
    notices.push("注意：当前排名混合了不同批次的结果，评分存在采样波动，先后顺序仅供参考；如需严格比较建议清空后用同一批重新评估。");
  }
  if (notices.length) {
    els.rankNotice.textContent = notices.join(" ");
    els.rankNotice.hidden = false;
  } else {
    els.rankNotice.hidden = true;
  }

  if (isAppend || skipped) {
    const added = okItems.length - replaced;
    const base = isAppend
      ? `已追加 ${added} 位候选人${replaced ? `，更新 ${replaced} 位同名候选人` : ""}，共 ${state.rankData.length} 位，排名已重排`
      : `已评估 ${okItems.length} 位候选人，共 ${state.rankData.length} 位`;
    toast(skipped ? `${base}；增量模式跳过 ${skipped} 份未变更简历` : base, "success", 3600);
  }
}

function rankTimeLabel(d = new Date()) {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

// 分段展示：LLM 评分存在采样波动，绝对分差意义有限，分段才是决策依据
const bandOf = (s) =>
  s >= 85
    ? { label: "强烈推荐", cls: "band-strong" }
    : s >= 70
      ? { label: "推荐", cls: "band-good" }
      : s >= 55
        ? { label: "备选", cls: "band-ok" }
        : { label: "不推荐", cls: "band-warn" };

function renderRankList() {
  els.rankMeta.textContent = `共 ${state.rankData.length} 位 · 累计 ${state.rankBatches} 轮 · 排名 = 简历与 JD 的匹配度，非候选人真实能力`;
  // 相邻两人分差 ≤3：属采样波动范围，标注同级避免过度解读名次先后
  const ties = state.rankData.map(
    (d, i, a) => i > 0 && a[i - 1].result.overall_score - d.result.overall_score <= 3
  );
  els.rankList.innerHTML = state.rankData
    .map((item, i) => {
      const r = item.result;
      const band = bandOf(r.overall_score);
      const matched = r.matched_keywords ?? [];
      const missing = r.missing_keywords ?? [];
      return `
      <article class="rank-card" data-index="${i}" data-tone="${toneOf(r.overall_score)}" tabindex="0" role="button"
               aria-label="查看 ${esc(r.candidate || item.filename)} 的评估详情、简历附件与面试题">
        <span class="rank-badge${i < 3 ? ` rank-${i + 1}` : ""}">${i + 1}</span>
        <div class="rank-main">
          <div class="rank-title-row">
            <h4 class="rank-name">${esc(r.candidate || item.filename)}</h4>
            <span class="engine-tag">AI 评估</span>
            <span class="rank-band ${band.cls}" title="分段：≥85 强烈推荐 / 70-84 推荐 / 55-69 备选 / <55 不推荐">${band.label}</span>
            <span class="rank-batch" title="第 ${item.batch} 轮入库 ${item.time}">第 ${item.batch} 轮 · ${item.time}</span>
          </div>
          <p class="rank-verdict">${esc(r.verdict || "")}</p>
          <p class="rank-meta">关键词 ${matched.length}/${matched.length + missing.length} · 优点 ${
            (r.strengths ?? []).length
          } · 待优化 ${(r.improvements ?? []).length} · ${esc(item.filename)}</p>
        </div>
        <div class="rank-score">
          <span class="rank-score-num">${r.overall_score}</span><span class="rank-score-unit">分</span>
          ${ties[i] ? '<span class="rank-tie" title="分差 ≤3 分，属采样波动范围内的同级候选人，建议结合维度分与面试表现判断">≈ 同级</span>' : ""}
        </div>
        <button type="button" class="icon-btn rank-remove" data-remove="${i}" aria-label="从排名中移除 ${esc(
          r.candidate || item.filename
        )}" title="从排名中移除">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
        ${chevronSvg}
      </article>`;
    })
    .join("");
}

/* ---------- 排名历史：恢复 / 移除 / 清空 ---------- */

export function restoreRank() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(RANK_LS_KEY) ?? "null");
  } catch {
    saved = null;
  }
  if (!saved || !Array.isArray(saved.items)) return;
  state.rankJd = typeof saved.jd === "string" ? saved.jd : "";
  state.rankBatches = Number(saved.batches) || 1;
  const valid = saved.items.filter(
    (d) => d && d.filename && d.result && typeof d.result.overall_score === "number"
  );
  // 旧版本（本地启发式引擎）的榜单记录与现行 AI 口径不可比，恢复时直接剔除
  state.rankData = valid.filter((d) => d.result.engine === "llm");
  const legacy = valid.length - state.rankData.length;
  if (legacy > 0) {
    deleteResumeFiles(valid.filter((d) => d.result.engine !== "llm").map((d) => d.file_id));
    toast(`已忽略 ${legacy} 条旧版本（本地引擎）榜单记录，如需纳入请重新评估`, "info", 4200);
  }
  if (!state.rankData.length) {
    deleteResumeFiles((saved.items ?? []).map((d) => d?.file_id)); // 存储损坏无效，附件一并清理
    clearRankStorage();
    return;
  }
  // 还原当次排名所用 JD，保证追加评估口径一致（不覆盖用户已输入的内容）
  if (state.rankJd && els.jdInput.value.trim() === "") {
    els.jdInput.value = state.rankJd;
    updateJdCount();
  }
  renderRankList();
  els.rankNotice.hidden = true;
  els.resultsRank.hidden = state.view !== "interviewer";
  if (state.view === "interviewer") observeReveals(els.resultsRank);
  toast(
    `已恢复上次的候选人排名（${state.rankData.length} 位 · 累计 ${state.rankBatches} 轮），可继续追加新候选人`,
    "info",
    4200
  );
}

export function removeRankItem(i) {
  const item = state.rankData[i];
  if (!item) return;
  const name = item.result.candidate || item.filename;
  state.rankData.splice(i, 1);
  deleteResumeFiles([item.file_id]); // 该候选人已移出排名，附件同步删除
  if (!state.rankData.length) {
    state.rankJd = "";
    state.rankBatches = 0;
    clearRankStorage();
    els.resultsRank.hidden = true;
    toast(`已移除 ${name}，排名已清空`, "info", 2600);
    return;
  }
  saveRank();
  renderRankList();
  renderBatchList(); // 移除后该简历重新变为「待评估」，提示随之刷新
  toast(`已移除 ${name}，剩余 ${state.rankData.length} 位`, "info", 2400);
}

let rankClearArmed = null;
els.rankClear.addEventListener("click", () => {
  // 两步确认：首次点击变为确认态，3 秒内再次点击才执行
  if (!rankClearArmed) {
    els.rankClear.classList.add("btn-danger-armed");
    els.rankClear.textContent = "再次点击确认清空";
    rankClearArmed = setTimeout(() => {
      rankClearArmed = null;
      els.rankClear.classList.remove("btn-danger-armed");
      els.rankClear.textContent = "清空排名";
    }, 3000);
    return;
  }
  clearTimeout(rankClearArmed);
  rankClearArmed = null;
  els.rankClear.classList.remove("btn-danger-armed");
  els.rankClear.textContent = "清空排名";
  deleteResumeFiles(state.rankData.map((d) => d.file_id)); // 清空排名：附件同步删除
  state.rankData = [];
  state.rankJd = "";
  state.rankBatches = 0;
  state.detailIndex = -1;
  clearRankStorage();
  els.resultsRank.hidden = true;
  renderBatchList(); // 排名清空后，队列中的简历全部回到「待评估」
  toast("已清空候选人排名历史", "info", 2400);
});
