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
    qgGenerate: $("#qg-generate"),
    qgGenerateLabel: $("#qg-generate-label"),
    qgResult: $("#qg-result"),
  };

  const state = {
    file: null,
    busy: false,
    view: "candidate",
    batchFiles: [],
    rankData: [],
    detailIndex: -1,
    questionsCache: {},
  };
  const ALLOWED = [".pdf", ".docx", ".txt", ".md"];
  const RING_C = 527.79; // 2πr, r=84

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
    els.jdCount.classList.toggle("is-ok", n >= 30);
  }

  els.jdInput.addEventListener("input", updateJdCount);

  els.jdSampleBtn.addEventListener("click", () => {
    els.jdInput.value = SAMPLE_JD;
    updateJdCount();
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
    els.evaluateLabel.textContent = isCandidate ? "开始匹配分析" : "批量评估排名";
    els.results.hidden = true;
    els.resultsRank.hidden = true;
  }

  els.viewCandidate.addEventListener("click", () => setView("candidate"));
  els.viewInterviewer.addEventListener("click", () => setView("interviewer"));

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

  function renderBatchList() {
    els.batchFileList.hidden = state.view === "candidate" || state.batchFiles.length === 0;
    els.batchFileList.innerHTML =
      state.batchFiles
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
        .join("") +
      (state.batchFiles.length
        ? `<p class="batch-count">共 ${state.batchFiles.length} 份简历，点击「批量评估排名」开始分析</p>`
        : "");
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
  }

  function clearFile() {
    state.file = null;
    els.fileInput.value = "";
    els.fileChip.hidden = true;
    els.dropzone.classList.remove("has-file");
    els.dropzone.setAttribute("aria-label", "点击或拖拽上传简历文件，支持 PDF、DOCX、TXT、MD，不超过 10 MB");
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
    els.evaluateLabel.textContent =
      label ?? (state.view === "candidate" ? "开始匹配分析" : "批量评估排名");
  }

  async function evaluate() {
    if (state.busy) return;

    const jd = els.jdInput.value.trim();
    if (jd.length < 30) {
      toast("岗位 JD 至少需要 30 字，请粘贴完整的职位描述");
      els.jdInput.focus();
      return;
    }

    if (state.view === "interviewer") return evaluateBatch(jd);

    if (!state.file) {
      toast("请先上传简历文件（PDF / DOCX / TXT / MD）");
      return;
    }

    const form = new FormData();
    form.append("jd", jd);
    form.append("file", state.file);

    setLoading(true, "正在分析…");
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
      render(data);
      els.results.scrollIntoView({ behavior: "smooth", block: "start" });
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
    const form = new FormData();
    form.append("jd", jd);
    state.batchFiles.forEach((f) => form.append("files", f));

    setLoading(true, `正在评估 ${state.batchFiles.length} 份简历…`);
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
      renderRank(data);
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

  function renderRank(data) {
    const okItems = data.results.filter((r) => r.ok);
    const errItems = data.results.filter((r) => !r.ok);
    okItems.sort((a, b) => (b.result.overall_score ?? 0) - (a.result.overall_score ?? 0));
    state.rankData = [...okItems, ...errItems];
    state.questionsCache = {};

    els.rankNotice.hidden = true;
    els.rankMeta.textContent = `共 ${data.results.length} 份 · 成功 ${okItems.length} 份 · ${
      data.engine === "llm" ? "AI 评估" : "本地分析"
    }`;

    els.rankList.innerHTML = state.rankData
      .map((item, i) => {
        if (!item.ok) {
          return `
          <article class="rank-card rank-card-error">
            <span class="rank-badge rank-err">!</span>
            <div class="rank-main">
              <h4 class="rank-name">${esc(item.filename)}</h4>
              <p class="rank-verdict">解析失败，未参与排名</p>
              <p class="rank-meta">${esc(item.error ?? "未知错误")}</p>
            </div>
          </article>`;
        }
        const r = item.result;
        const matched = r.matched_keywords ?? [];
        const missing = r.missing_keywords ?? [];
        return `
        <article class="rank-card" data-index="${i}" data-tone="${toneOf(r.overall_score)}" tabindex="0" role="button"
                 aria-label="查看 ${esc(r.candidate || item.filename)} 的评估详情与面试题">
          <span class="rank-badge${i < 3 ? ` rank-${i + 1}` : ""}">${i + 1}</span>
          <div class="rank-main">
            <div class="rank-title-row">
              <h4 class="rank-name">${esc(r.candidate || item.filename)}</h4>
              <span class="engine-tag">${r.engine === "llm" ? "AI 评估" : "本地分析"}</span>
            </div>
            <p class="rank-verdict">${esc(r.verdict || "")}</p>
            <p class="rank-meta">关键词 ${matched.length}/${matched.length + missing.length} · 优点 ${
              (r.strengths ?? []).length
            } · 待优化 ${(r.improvements ?? []).length} · ${esc(item.filename)}</p>
          </div>
          <div class="rank-score">
            <span class="rank-score-num">${r.overall_score}</span><span class="rank-score-unit">分</span>
          </div>
          ${chevronSvg}
        </article>`;
      })
      .join("");
  }

  els.rankList.addEventListener("click", (e) => {
    const card = e.target.closest(".rank-card[data-index]");
    if (card) openDetail(Number(card.dataset.index));
  });
  els.rankList.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
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
    els.improveCount.textContent = `${improvements.length} 项`;

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

    // 待优化点
    els.improvementsList.innerHTML = improvements.length
      ? improvements
          .map(
            (it, i) => `
          <article class="point-card point-card-warn reveal" style="--reveal-delay:${i * 60}ms">
            <div class="point-head">
              <span class="point-index">${i + 1}</span>
              <h4 class="point-title">${esc(it.title)}</h4>
              ${it.priority ? `<span class="priority-pill" data-priority="${esc(it.priority)}">${({ high: "高优先", medium: "中优先", low: "低优先" })[it.priority] ?? esc(it.priority)}</span>` : ""}
            </div>
            <p class="point-detail">${esc(it.detail)}</p>
            ${it.suggestion ? `<div class="point-suggestion"><span class="sug-label">建议</span><span class="sug-text">${esc(it.suggestion)}</span></div>` : ""}
          </article>`
          )
          .join("")
      : '<p class="empty-note">未发现明显短板，保持现状即可。</p>';

    // 关键词
    els.kwMatchedCount.textContent = `${matched.length} 项`;
    els.kwMissingCount.textContent = `${missing.length} 项`;
    els.kwMatched.innerHTML = matched.length
      ? matched.map((k, i) => `<span class="kw-chip" style="animation-delay:${i * 35}ms">${esc(k)}</span>`).join("")
      : '<span class="empty-note">未检测到已覆盖的 JD 关键词</span>';
    els.kwMissing.innerHTML = missing.length
      ? missing.map((k, i) => `<span class="kw-chip" style="animation-delay:${i * 35}ms">${esc(k)}</span>`).join("")
      : '<span class="empty-note">JD 核心关键词全部覆盖</span>';

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
    state.detailIndex = -1;
    state.questionsCache = {};
    renderBatchList();
    updateJdCount();
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
    els.detailFile.textContent = item.filename;
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
      ? (r.improvements ?? [])
          .slice(0, 4)
          .map(
            (it, idx) => `
          <article class="point-card point-card-warn">
            <div class="point-head">
              <span class="point-index">${idx + 1}</span><h4 class="point-title">${esc(it.title)}</h4>
              ${it.priority ? `<span class="priority-pill" data-priority="${esc(it.priority)}">${({ high: "高优先", medium: "中优先", low: "低优先" })[it.priority] ?? esc(it.priority)}</span>` : ""}
            </div>
            <p class="point-detail">${esc(it.detail)}</p>
            ${it.suggestion ? `<div class="point-suggestion"><span class="sug-label">建议</span><span class="sug-text">${esc(it.suggestion)}</span></div>` : ""}
          </article>`
          )
          .join("")
      : '<p class="empty-note">无</p>';

    const matched = r.matched_keywords ?? [];
    const missing = r.missing_keywords ?? [];
    els.detailKeywords.innerHTML = `
      <div class="chip-set chip-good">${matched.map((k) => `<span class="kw-chip">${esc(k)}</span>`).join("") || '<span class="empty-note">无</span>'}</div>
      <div class="chip-set chip-warn detail-kw-missing">${missing.map((k) => `<span class="kw-chip">${esc(k)}</span>`).join("") || '<span class="empty-note">无</span>'}</div>`;

    const cacheKey = `${i}:${item.filename}`;
    const cached = state.questionsCache[cacheKey];
    if (cached) {
      renderQuestions(cached);
    } else {
      els.qgResult.innerHTML =
        '<p class="empty-note">点击右上角按钮，基于岗位 JD 与该候选人简历生成结构化面试题（含考察意图与参考答案要点）</p>';
    }

    els.detailOverlay.hidden = false;
    document.body.style.overflow = "hidden";
    els.detailClose.focus();
  }

  function closeDetail() {
    els.detailOverlay.hidden = true;
    document.body.style.overflow = "";
    state.detailIndex = -1;
  }

  els.detailClose.addEventListener("click", closeDetail);
  els.detailOverlay.addEventListener("click", (e) => {
    if (e.target === els.detailOverlay) closeDetail();
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
    const cacheKey = `${state.detailIndex}:${item.filename}`;
    if (state.questionsCache[cacheKey]) {
      renderQuestions(state.questionsCache[cacheKey]);
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
      state.questionsCache[cacheKey] = data;
      renderQuestions(data);
    } catch (err) {
      els.qgResult.innerHTML = "";
      toast(err.message || "生成失败，请稍后重试");
    } finally {
      els.qgGenerate.disabled = false;
      els.qgGenerateLabel.textContent = "基于 JD 与该简历生成面试题";
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
      // 优先关闭候选人详情，其次关闭设置弹窗
      if (!els.detailOverlay.hidden) closeDetail();
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
      showCfgStatus(`已获取 ${modelItems.length} 个模型，点击「模型名称」输入框选择`, true);
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
  observeReveals();
})();
