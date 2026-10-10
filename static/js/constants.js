/* 静态常量：格式白名单、标签文案、本地存储键、平台直达链接 */

export const ALLOWED = [".pdf", ".docx", ".txt", ".md"];
export const RING_C = 527.79; // 2πr, r=84
export const RANK_LS_KEY = "resumelens.rank.v1"; // 候选人排名历史（本地存储）
export const CANDIDATE_LS_KEY = "resumelens.candidate.v1"; // 求职者视角最近一次分析结果（本地存储）
export const PRIORITY_LABELS = { high: "高优先", medium: "中优先", low: "低优先" };
export const ACTION_LABELS = { 改写: "改写", 精简: "精简", 删除: "删除", 补充: "补充" };

// 招聘平台搜索直达链接（关键词预填，新标签页打开；平台均无公开 API，推荐为方向+搜索词而非实时职位）
export const JOB_PLATFORMS = [
  { name: "BOSS直聘", build: (kw) => `https://www.zhipin.com/web/geek/job?query=${encodeURIComponent(kw)}` },
  { name: "智联招聘", build: (kw) => `https://sou.zhaopin.com/?kw=${encodeURIComponent(kw)}` },
  { name: "前程无忧", build: (kw) => `https://we.51job.com/pc/search?keyword=${encodeURIComponent(kw)}` },
  { name: "猎聘", build: (kw) => `https://www.liepin.com/zhaopin/?key=${encodeURIComponent(kw)}` },
];

export const extLinkSvg =
  '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/></svg>';
