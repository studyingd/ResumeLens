/* 排名历史持久化：localStorage 读写（数据本体在 state.rankData，视图刷新在 interviewer.js） */

import { RANK_LS_KEY } from "./constants.js";
import { state } from "./state.js";

export function saveRank() {
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
          ok: d.ok ?? true, // 解析成功的入榜记录恒为 true；显式保存避免刷新后 undefined 被误判为失败
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

export function clearRankStorage() {
  try {
    localStorage.removeItem(RANK_LS_KEY);
  } catch {
    /* 忽略 */
  }
}
