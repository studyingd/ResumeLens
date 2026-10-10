/* 入口（组合根）：视角切换、跨模块事件分发、重置与初始化。
   各功能模块自带各自范围内的事件绑定；涉及多模块的分发逻辑集中在这里。 */

import { els } from "./dom.js";
import { state } from "./state.js";
import { toast, observeReveals, deleteResumeFiles } from "./utils.js";
import { refreshEngine } from "./engine.js";
import { updateJdCount } from "./jd.js";
import {
  refreshEvaluateLabel,
  setFile,
  clearFile,
  evaluateCandidate,
  clearCandidateStorage,
  restoreCandidate,
} from "./candidate.js";
import { addBatchFiles, evaluateBatch, renderBatchList, restoreRank, removeRankItem } from "./interviewer.js";
import { clearRankStorage } from "./rank-store.js";
import { openDetail } from "./detail.js";
import "./settings.js"; // 设置弹窗（含引擎徽标联动与模型下拉），仅需其副作用

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

/* ---------- 跨模块事件分发 ---------- */

// JD 输入：字数统计（jd）、按钮文案（candidate）、面试官队列增量提示（interviewer）三方联动
els.jdInput.addEventListener("input", () => {
  updateJdCount();
  refreshEvaluateLabel();
  // JD 变化会影响增量判定（换 JD 需全量重评），同步刷新队列底部的待评估提示
  if (state.view === "interviewer" && state.batchFiles.length) renderBatchList();
});

// 文件选择：按当前视角分发——求职者换单份简历，面试官追加批量队列
els.fileInput.addEventListener("change", () => {
  if (state.view === "candidate") {
    setFile(els.fileInput.files[0]);
  } else {
    addBatchFiles(els.fileInput.files);
    els.fileInput.value = ""; // 允许再次选择同名文件
  }
});
els.dropzone.addEventListener("drop", (e) => {
  const files = e.dataTransfer?.files;
  if (state.view === "candidate") setFile(files?.[0]);
  else addBatchFiles(files);
});

// 评估入口：共享校验后按视角分发到批量评估（interviewer）或单份分析（candidate）
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
  return evaluateCandidate(jd);
}

els.evaluateBtn.addEventListener("click", evaluate);

// 榜单卡片：移除按钮 / 点击与回车打开详情（detail）
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

/* ---------- 重置 ---------- */

els.resetBtn.addEventListener("click", () => {
  // 先取附件 id 再清空数据（清空后 map 会拿到空数组，附件将漏删）
  const staleFileIds = state.rankData.map((d) => d.file_id);
  els.jdInput.value = "";
  clearFile();
  state.batchFiles = [];
  state.rankData = [];
  state.rankJd = "";
  state.rankBatches = 0;
  state.detailIndex = -1;
  clearRankStorage();
  deleteResumeFiles(staleFileIds); // 重置：附件同步删除
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

/* ---------- 初始化 ---------- */

updateJdCount();
refreshEngine();
setView("candidate");
restoreCandidate(); // 恢复上次保留的分析结果（含重点标记）
restoreRank(); // 恢复上次保存的候选人排名历史
observeReveals();
