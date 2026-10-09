/* ResumeLens 前端交互 */
(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);

  const els = {
    engineBadge: $("#engine-badge"),
    engineText: $("#engine-text"),
    jdInput: $("#jd-input"),
    jdCount: $("#jd-count"),
    jdSampleBtn: $("#jd-sample-btn"),
    jdCardDesc: $("#jd-card-desc"),
    jdOptionalTag: $("#jd-optional-tag"),
    scoreEyebrowText: $("#score-eyebrow-text"),
    kwGroupTitle: $("#kw-group-title"),
    kwMatchedLabel: $("#kw-matched-label"),
    kwMissingLabel: $("#kw-missing-label"),
    dropzone: $("#dropzone"),
    fileInput: $("#file-input"),
    fileChip: $("#file-chip"),
    fileName: $("#file-name"),
    fileSize: $("#file-size"),
    fileRemove: $("#file-remove"),
    evaluateBtn: $("#evaluate-btn"),
    evaluateLabel: $("#evaluate-label"),
    resetBtn: $("#reset-btn"),
    results: $("#results"),
    noticeBanner: $("#notice-banner"),
    scoreCard: $("#score-card"),
    ringBar: $("#ring-bar"),
    scoreNumber: $("#score-number"),
    verdictText: $("#verdict-text"),
    scoreEngineTag: $("#score-engine-tag"),
    scoreStats: $("#score-stats"),
    dimensionsGrid: $("#dimensions-grid"),
    strengthsList: $("#strengths-list"),
    strengthCount: $("#strength-count"),
    improvementsList: $("#improvements-list"),
    improveCount: $("#improve-count"),
    kwMatched: $("#kw-matched"),
    kwMatchedCount: $("#kw-matched-count"),
    kwMissing: $("#kw-missing"),
    kwMissingCount: $("#kw-missing-count"),
    summaryBlock: $("#summary-block"),
    summaryText: $("#summary-text"),
    copySummary: $("#copy-summary"),
    toastRoot: $("#toast-root"),
    // 设置弹窗
    settingsOpen: $("#settings-open"),
    settingsOverlay: $("#settings-overlay"),
    settingsClose: $("#settings-close"),
    cfgBaseurl: $("#cfg-baseurl"),
    cfgModel: $("#cfg-model"),
    cfgKey: $("#cfg-key"),
    cfgKeyToggle: $("#cfg-key-toggle"),
    cfgModel: $("#cfg-model"),
    modelDropdown: $("#model-dropdown"),
    modelsRefresh: $("#cfg-models-refresh"),
    cfgStatus: $("#cfg-status"),
    cfgTest: $("#cfg-test"),
    cfgSave: $("#cfg-save"),
    cfgReset: $("#cfg-reset"),
    // 视角切换与面试官模式
    viewCandidate: $("#view-candidate"),
    viewInterviewer: $("#view-interviewer"),
    resumeCardTitle: $("#resume-card-title"),
    resumeCardDesc: $("#resume-card-desc"),
    dzHint: $("#dz-hint"),
    batchFileList: $("#batch-file-list"),
    resultsRank: $("#results-rank"),
    rankNotice: $("#rank-notice"),
    rankMeta: $("#rank-meta"),
    rankList: $("#rank-list"),
    rankClear: $("#rank-clear"),
    detailOverlay: $("#detail-overlay"),
    detailClose: $("#detail-close"),
    detailRank: $("#detail-rank"),
    detailName: $("#detail-name"),
    detailFile: $("#detail-file"),
    detailScorebar: $("#detail-scorebar"),
    detailScore: $("#detail-score"),
    detailVerdict: $("#detail-verdict"),
    detailEngine: $("#detail-engine"),
    detailNotice: $("#detail-notice"),
    detailDims: $("#detail-dims"),
    detailStrengths: $("#detail-strengths"),
    detailImprovements: $("#detail-improvements"),
    detailKeywords: $("#detail-keywords"),
    resumeToggle: $("#resume-toggle"),
    resumeToggleLabel: $("#resume-toggle-label"),
    resumeBody: $("#resume-body"),
    resumeFrame: $("#resume-frame"),
    resumeMissing: $("#resume-missing"),
    qgGenerate: $("#qg-generate"),
    qgGenerateLabel: $("#qg-generate-label"),
    qgResult: $("#qg-result"),
    // 优化点详情弹窗
    impOverlay: $("#imp-overlay"),
    impClose: $("#imp-close"),
    impIndex: $("#imp-index"),
    impTitle: $("#imp-title"),
    impAction: $("#imp-action"),
    impPriority: $("#imp-priority"),
    impDetail: $("#imp-detail"),
    impSuggestionWrap: $("#imp-suggestion-wrap"),
    impSuggestionText: $("#imp-suggestion-text"),
    impOriginalBlock: $("#imp-original-block"),
    impOriginal: $("#imp-original"),
    impRevisedBlock: $("#imp-revised-block"),
    impRevised: $("#imp-revised"),
    impCopy: $("#imp-copy"),
    impNoDiff: $("#imp-no-diff"),
    // 岗位推荐
    jobBlock: $("#job-block"),
    jobList: $("#job-list"),
    jobMeta: $("#job-meta"),
    jobRetry: $("#job-retry"),
    jobNotice: $("#job-notice"),
    jobGap: $("#job-gap"),
  };

  const state = {
    file: null,
    busy: false,
    view: "candidate",
    engine: "", // 当前评估引擎（llm / heuristic），用于增量评估的口径判断
    batchFiles: [],
    rankData: [],
    rankJd: "",
    rankBatches: 0,
    detailIndex: -1,
    impItem: null, // 弹窗中展示的待优化点（供复制按钮取改写文本）
    lastCheck: null, // 求职者视角最近一次分析结果（含文件指纹，持久化到本地）
  };
  const ALLOWED = [".pdf", ".docx", ".txt", ".md"];
  const RING_C = 527.79; // 2πr, r=84
  const RANK_LS_KEY = "resumelens.rank.v1"; // 候选人排名历史（本地存储）
  const CANDIDATE_LS_KEY = "resumelens.candidate.v1"; // 求职者视角最近一次分析结果（本地存储）
  const PRIORITY_LABELS = { high: "高优先", medium: "中优先", low: "低优先" };
  const ACTION_LABELS = { 改写: "改写", 精简: "精简", 删除: "删除", 补充: "补充" };
  // 招聘平台搜索直达链接（关键词预填，新标签页打开；平台均无公开 API，推荐为方向+搜索词而非实时职位）
  const JOB_PLATFORMS = [
    { name: "BOSS直聘", build: (kw) => `https://www.zhipin.com/web/geek/job?query=${encodeURIComponent(kw)}` },
    { name: "智联招聘", build: (kw) => `https://sou.zhaopin.com/?kw=${encodeURIComponent(kw)}` },
    { name: "前程无忧", build: (kw) => `https://we.51job.com/pc/search?keyword=${encodeURIComponent(kw)}` },
    { name: "猎聘", build: (kw) => `https://www.liepin.com/zhaopin/?key=${encodeURIComponent(kw)}` },
  ];
  const extLinkSvg =
    '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/></svg>';
  let recheckArmed = null; // 重复体检二次确认的定时器

  /* ---------- 工具 ---------- */

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[c]);

  const formatSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  };

  function toast(message, type = "error", duration = 4600) {
    const icons = {
      error: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>',
      info: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>',
      success: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    };
    const el = document.createElement("div");
    el.className = `toast toast-${type}`;
    el.setAttribute("role", "status");
    el.innerHTML = `${icons[type] ?? icons.info}<div>${esc(message)}</div>`;
    els.toastRoot.appendChild(el);
    setTimeout(() => {
      el.classList.add("is-leaving");
      el.addEventListener("animationend", () => el.remove(), { once: true });
    }, duration);
  }

  /* ---------- 揭示动画 ---------- */

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      }
    },
    { threshold: 0, rootMargin: "0px 0px -48px 0px" }
  );

  const observeReveals = (root = document) => {
    root.querySelectorAll(".reveal:not(.is-visible)").forEach((el) => observer.observe(el));
  };

  /* ---------- 引擎状态 ---------- */

  async function refreshEngine() {
    try {
      const res = await fetch("/api/health");
      const data = await res.json();
      state.engine = data.engine === "llm" ? "llm" : "heuristic";
      els.engineBadge.classList.remove("is-llm", "is-heuristic");
      if (data.engine === "llm") {
        els.engineBadge.classList.add("is-llm");
        els.engineBadge.title = `AI 评估 · ${data.model}（${data.source === "local" ? "页面设置" : "环境变量"}）`;
        els.engineText.textContent = `AI 评估 · ${data.model}`;
      } else {
        els.engineBadge.classList.add("is-heuristic");
        els.engineBadge.title = "本地启发式分析 · 点击右上角齿轮配置 AI 评估";
        els.engineText.textContent = "本地分析 · 点击配置 AI";
      }
    } catch {
      state.engine = "";
      els.engineText.textContent = "服务未连接";
    }
  }

  /* ---------- JD 输入 ---------- */

  const SAMPLE_JD = `岗位职责
1. 负责公司核心电商交易系统的后端服务设计与开发，保障高并发场景下的稳定性与性能；
2. 参与微服务架构演进，主导关键模块的重构、拆分与性能优化（接口耗时、容量规划）；
3. 与产品、前端、测试协作，推动需求落地，编写技术方案文档并参与代码评审；
4. 参与线上问题排查与应急响应，建设可观测性体系（监控、告警、链路追踪）。

任职要求
1. 本科及以上学历，计算机相关专业，3 年以上后端开发经验；
2. 精通 Java / Go 至少一门语言，熟悉 Spring Boot、MySQL、Redis、Kafka；
3. 熟悉分布式系统设计，对高并发、高可用有实践经验，了解常见中间件原理；
4. 具备良好的问题定位能力，有完整的项目落地与性能调优经验；
5. 有电商、支付或大促保障经验者优先，有开源贡献者优先。`;

  function updateJdCount() {
    const n = els.jdInput.value.trim().length;
    els.jdCount.textContent = `${n.toLocaleString()} 字`;
    // 求职者视角下 0 字与 ≥30 字均为合法状态，均视为就绪
    const ready = n >= 30 || (state.view === "candidate" && n === 0);
    els.jdCount.classList.toggle("is-ok", ready);
  }

  els.jdInput.addEventListener("input", () => {
    updateJdCount();
    refreshEvaluateLabel();
    // JD 变化会影响增量判定（换 JD 需全量重评），同步刷新队列底部的待评估提示
    if (state.view === "interviewer" && state.batchFiles.length) renderBatchList();
  });

  els.jdSampleBtn.addEventListener("click", () => {
    els.jdInput.value = SAMPLE_JD;
    updateJdCount();
    refreshEvaluateLabel();
    toast("已填入示例岗位 JD，可替换为你的目标岗位", "info", 2600);
  });

  /* ---------- 视角切换（求职者 / 面试官） ---------- */

  function setView(view) {
    state.view = view;
    const isCandidate = view === "candidate";
    els.viewCandidate.classList.toggle("is-active", isCandidate);
    els.viewCandidate.setAttribute("aria-selected", String(isCandidate));
    els.viewInterviewer.classList.toggle("is-active", !isCandidate);
    els.viewInterviewer.setAttribute("aria-selected", String(!isCandidate));
    els.fileInput.multiple = !isCandidate;
    els.resumeCardTitle.textContent = isCandidate ? "你的简历" : "候选人简历";
    els.resumeCardDesc.textContent = isCandidate
      ? "拖拽或点击上传简历文件"
      : "批量上传多份简历，按匹配度排名";
    els.dzHint.textContent = isCandidate
      ? "PDF · DOCX · TXT · MD，不超过 10 MB · 扫描件自动 OCR"
      : "可一次选择多份（最多 20 份）· PDF / DOCX / TXT / MD · 扫描件自动 OCR";
    els.dropzone.setAttribute(
      "aria-label",
      isCandidate
        ? "点击或拖拽上传简历文件，支持 PDF、DOCX、TXT、MD，不超过 10 MB"
        : "点击或拖拽批量上传候选人简历，可多选，每份不超过 10 MB"
    );
    els.fileChip.hidden = !(isCandidate && state.file);
    els.batchFileList.hidden = isCandidate || state.batchFiles.length === 0;
    els.dropzone.classList.toggle("has-file", isCandidate && !!state.file);
    // JD 卡片说明：求职者视角可选（留空 = 简历体检），面试官视角仍必填
    els.jdOptionalTag.hidden = !isCandidate;
    els.jdCardDesc.textContent = isCandidate
      ? "粘贴完整职位描述可做岗位匹配；留空则仅对简历做通用体检"
      : "粘贴完整的职位描述，越完整分析越准（批量评估必需）";
    els.results.hidden = !(view === "candidate" && state.lastCheck); // 切回求职者视角时恢复保留的分析结果
    els.resultsRank.hidden = !(view === "interviewer" && state.rankData.length > 0);
    updateJdCount();
    refreshEvaluateLabel();
  }

  els.viewCandidate.addEventListener("click", () => setView("candidate"));
  els.viewInterviewer.addEventListener("click", () => setView("interviewer"));

  // 提交按钮文案：面试官视角为批量评估；求职者视角看 JD 与上次结果切换「开始/重新·匹配分析/简历体检」
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

  function refreshEvaluateLabel() {
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

  /* ---------- 面试官模式：多份文件管理 ---------- */

  function addBatchFiles(fileList) {
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

  // 文件指纹：文件名 + 大小 + 修改时间，三者一致视为「同一份未变更的简历」
  const fileSig = (f) => `${f.name}|${f.size}|${f.lastModified}`;

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

  function renderBatchList() {
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

  /* ---------- 文件选择 ---------- */

  function setFile(file) {
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

  function clearFile() {
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
  els.fileInput.addEventListener("change", () => {
    if (state.view === "candidate") {
      setFile(els.fileInput.files[0]);
    } else {
      addBatchFiles(els.fileInput.files);
      els.fileInput.value = ""; // 允许再次选择同名文件
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
  els.dropzone.addEventListener("drop", (e) => {
    const files = e.dataTransfer?.files;
    if (state.view === "candidate") setFile(files?.[0]);
    else addBatchFiles(files);
  });

  /* ---------- 评估 ---------- */

  function setLoading(loading, label) {
    state.busy = loading;
    els.evaluateBtn.classList.toggle("is-loading", loading);
    if (label) {
      els.evaluateLabel.textContent = label;
    } else {
      refreshEvaluateLabel();
    }
  }

  async function evaluate() {
    if (state.busy) return;

    const jd = els.jdInput.value.trim();
    // JD 必填仅限面试官视角；求职者视角留空 = 简历体检，但介于 1-29 字时提示补全或清空
    if (state.view === "interviewer" && jd.length < 30) {
      toast("岗位 JD 至少需要 30 字，请粘贴完整的职位描述");
      els.jdInput.focus();
      return;
    }
    if (state.view === "candidate" && jd.length > 0 && jd.length < 30) {
      toast("岗位 JD 不足 30 字：请粘贴完整职位描述做匹配分析，或清空 JD 仅对简历做通用体检");
      els.jdInput.focus();
      return;
    }

    if (state.view === "interviewer") return evaluateBatch(jd);

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

  els.evaluateBtn.addEventListener("click", evaluate);

  /* ---------- 面试官模式：批量评估与排名 ---------- */

  async function evaluateBatch(jd) {
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

  const chevronSvg =
    '<svg class="chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';

  function renderRank(data, jd, sigMap = new Map(), skipped = 0) {
    const okItems = data.results.filter((r) => r.ok);
    const errItems = data.results.filter((r) => !r.ok);

    // 换了 JD：分数口径不同，开启全新排名历史；同一 JD：追加合并
    if (state.rankJd !== jd) {
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

    // 提示横幅：失败文件不入排名；混合引擎时提醒评分口径不一致
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
      notices.push(
        "注意：当前排名混合了「AI 评估」与「本地分析」两种引擎的结果，两者评分口径不同，先后顺序仅供参考；建议对标记为本地分析的候选人重新评估后再比较。"
      );
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

  function renderRankList() {
    els.rankMeta.textContent = `共 ${state.rankData.length} 位 · 累计 ${state.rankBatches} 轮`;
    els.rankList.innerHTML = state.rankData
      .map((item, i) => {
        const r = item.result;
        const matched = r.matched_keywords ?? [];
        const missing = r.missing_keywords ?? [];
        return `
        <article class="rank-card" data-index="${i}" data-tone="${toneOf(r.overall_score)}" tabindex="0" role="button"
                 aria-label="查看 ${esc(r.candidate || item.filename)} 的评估详情、简历附件与面试题">
          <span class="rank-badge${i < 3 ? ` rank-${i + 1}` : ""}">${i + 1}</span>
          <div class="rank-main">
            <div class="rank-title-row">
              <h4 class="rank-name">${esc(r.candidate || item.filename)}</h4>
              <span class="engine-tag">${r.engine === "llm" ? "AI 评估" : "本地分析"}</span>
              <span class="rank-batch" title="第 ${item.batch} 轮入库 ${item.time}">第 ${item.batch} 轮 · ${item.time}</span>
            </div>
            <p class="rank-verdict">${esc(r.verdict || "")}</p>
            <p class="rank-meta">关键词 ${matched.length}/${matched.length + missing.length} · 优点 ${
              (r.strengths ?? []).length
            } · 待优化 ${(r.improvements ?? []).length} · ${esc(item.filename)}</p>
          </div>
          <div class="rank-score">
            <span class="rank-score-num">${r.overall_score}</span><span class="rank-score-unit">分</span>
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

  /* ---------- 排名历史：本地持久化 / 恢复 / 移除 / 清空 ---------- */

  function saveRank() {
    if (!state.rankData.length) {
      clearRankStorage();
      return;
    }
    try {
      localStorage.setItem(
        RANK_LS_KEY,
        JSON.stringify({
          jd: state.rankJd,
          batches: state.rankBatches,
          items: state.rankData.map((d) => ({
            filename: d.filename,
            sig: d.sig ?? "", // 文件指纹：页面刷新后重新选择同一文件仍可增量跳过
            file_id: d.file_id ?? "",
            resume: d.resume,
            resume_truncated: d.resume_truncated,
            batch: d.batch,
            time: d.time,
            result: d.result,
            questions: d.questions ?? null, // 题单随候选人保留，直到使用者主动重新生成
          })),
        })
      );
    } catch (err) {
      console.warn("排名历史保存失败（可能超出本地存储限额）：", err);
    }
  }

  function clearRankStorage() {
    try {
      localStorage.removeItem(RANK_LS_KEY);
    } catch {
      /* 忽略 */
    }
  }

  // 通知服务端同步删除附件（排名移除/清空/覆盖时调用）；静默失败——残留文件由 7 天 TTL 兑底清理
  async function deleteResumeFiles(ids) {
    const list = (ids ?? []).filter(Boolean);
    if (!list.length) return;
    try {
      await fetch("/api/resume-files", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_ids: list }),
      });
    } catch {
      /* 网络失败不阻塞排名操作 */
    }
  }

  function restoreRank() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(RANK_LS_KEY) ?? "null");
    } catch {
      saved = null;
    }
    if (!saved || !Array.isArray(saved.items)) return;
    state.rankJd = typeof saved.jd === "string" ? saved.jd : "";
    state.rankBatches = Number(saved.batches) || 1;
    state.rankData = saved.items.filter((d) => d && d.filename && d.result && typeof d.result.overall_score === "number");
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

  function removeRankItem(i) {
    const item = state.rankData[i];
    if (!item) return;
    const name = item.result.candidate || item.filename;
    state.rankData.splice(i, 1);
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
    state.rankData = [];
    state.rankJd = "";
    state.rankBatches = 0;
    state.detailIndex = -1;
    clearRankStorage();
    els.resultsRank.hidden = true;
    renderBatchList(); // 排名清空后，队列中的简历全部回到「待评估」
    toast("已清空候选人排名历史", "info", 2400);
  });

  els.rankList.addEventListener("click", (e) => {
    const removeBtn = e.target.closest(".rank-remove");
    if (removeBtn) {
      removeRankItem(Number(removeBtn.dataset.remove));
      return;
    }
    const card = e.target.closest(".rank-card[data-index]");
    if (card) openDetail(Number(card.dataset.index));
  });
  els.rankList.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    if (e.target.closest("button")) return; // 按钮自带键盘激活，不当作卡片打开
    const card = e.target.closest?.(".rank-card[data-index]");
    if (card) {
      e.preventDefault();
      openDetail(Number(card.dataset.index));
    }
  });

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

  const toneOf = (s) => (s >= 75 ? "good" : s >= 55 ? "ok" : "warn");

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
    els.scoreEngineTag.textContent = data.engine === "llm" ? "AI 评估" : "本地分析";

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

  // 面试官详情弹窗专用：只读摘要卡（仅标题 + 动作/优先级 + 问题描述，无建议、不可点击）
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

  // 打开优化点详情弹窗（it 为完整待优化项；i 仅用于序号展示）
  function openImprovement(it, i) {
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

  function closeImprovement() {
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

  /* ---------- 求职者视角：结果保留 / 恢复 / 重复体检守卫 ---------- */

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

  function clearCandidateStorage() {
    try {
      localStorage.removeItem(CANDIDATE_LS_KEY);
    } catch {
      /* 忽略 */
    }
  }

  function restoreCandidate() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(CANDIDATE_LS_KEY) ?? "null");
    } catch {
      saved = null;
    }
    if (!saved || !saved.result || typeof saved.result.overall_score !== "number") return;
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
      ? `${positions.length} 个方向 · ${jobs.engine === "llm" ? "AI 推荐" : "本地推荐"}`
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

  /* ---------- 复制 / 重置 ---------- */

  els.copySummary.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(els.summaryText.textContent);
      toast("已复制到剪贴板", "success", 2200);
    } catch {
      toast("复制失败，请手动选择文本复制");
    }
  });

  els.resetBtn.addEventListener("click", () => {
    els.jdInput.value = "";
    clearFile();
    state.batchFiles = [];
    state.rankData = [];
    state.rankJd = "";
    state.rankBatches = 0;
    state.detailIndex = -1;
    clearRankStorage();
    state.lastCheck = null;
    clearCandidateStorage();
    els.jobBlock.hidden = true;
    renderBatchList();
    updateJdCount();
    refreshEvaluateLabel();
    els.results.hidden = true;
    els.resultsRank.hidden = true;
    els.results.querySelectorAll(".reveal").forEach((el) => el.classList.remove("is-visible"));
    els.resultsRank.querySelectorAll(".reveal").forEach((el) => el.classList.remove("is-visible"));
    window.scrollTo({ top: 0, behavior: "smooth" });
    toast("已清空，可开始新的分析", "info", 2200);
  });

  /* ---------- 候选人详情弹窗与面试题生成 ---------- */

  function openDetail(i) {
    const item = state.rankData[i];
    if (!item) return;
    if (!item.ok) {
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
    els.detailEngine.textContent = r.engine === "llm" ? "AI 评估" : "本地分析";
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

  function closeDetail() {
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

  /* ---------- 设置弹窗 ---------- */

  function showCfgStatus(text, ok) {
    els.cfgStatus.textContent = text;
    els.cfgStatus.classList.toggle("is-ok", ok);
    els.cfgStatus.classList.toggle("is-err", !ok);
    els.cfgStatus.hidden = false;
  }

  function hideCfgStatus() {
    els.cfgStatus.hidden = true;
  }

  async function openSettings() {
    hideCfgStatus();
    els.settingsOverlay.hidden = false;
    document.body.style.overflow = "hidden";
    try {
      const res = await fetch("/api/config");
      const data = await res.json();
      els.cfgBaseurl.value = data.base_url ?? "";
      els.cfgModel.value = data.model ?? "";
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

  async function postJSON(url, body) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  }

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
      });
      if (!res.ok) throw new Error(data?.detail ?? "保存失败");
      await refreshEngine();
      if (data.engine === "llm") {
        showCfgStatus(`已启用 AI 深度评估 · ${data.api_key_masked} · 模型「${model || "默认"}」`, true);
        toast("AI 深度评估已启用", "success", 2600);
      } else {
        showCfgStatus("已清除本机配置，回到本地启发式分析", true);
        toast("已恢复本地分析引擎", "info", 2600);
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
      showCfgStatus("已清除本机配置" + (data.engine === "llm" ? "（环境变量中仍配置有 Key，已回退启用）" : "，回到本地启发式分析"), true);
      els.cfgKey.value = "";
      els.cfgKey.placeholder = "sk-…（必填）";
    } catch {
      showCfgStatus("清除失败，请重试", false);
    }
  });

  /* ---------- 初始化 ---------- */

  updateJdCount();
  refreshEngine();
  setView("candidate");
  restoreCandidate(); // 恢复上次保留的分析结果（含重点标记）
  restoreRank(); // 恢复上次保存的候选人排名历史
  observeReveals();
})();
