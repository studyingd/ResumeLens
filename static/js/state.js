/* 页面全局状态（单一实例，跨模块共享可变数据） */

export const state = {
  file: null,
  busy: false,
  view: "candidate",
  engine: "", // 当前评估引擎（已配置为 "llm"，未配置为空串），用于增量评估的口径判断
  batchFiles: [],
  rankData: [],
  rankJd: "",
  rankBatches: 0,
  detailIndex: -1,
  impItem: null, // 弹窗中展示的待优化点（供复制按钮取改写文本）
  lastCheck: null, // 求职者视角最近一次分析结果（含文件指纹，持久化到本地）
};
