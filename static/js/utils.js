/* 通用工具：转义、提示、揭示动画、评分色调、文件指纹、JSON 请求、附件删除 */

import { els } from "./dom.js";

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);

export const formatSize = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
};

export function toast(message, type = "error", duration = 4600) {
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

export const observeReveals = (root = document) => {
  root.querySelectorAll(".reveal:not(.is-visible)").forEach((el) => observer.observe(el));
};

/* ---------- 通用判定与请求 ---------- */

// 评分 → 色调（总分卡、维度卡、榜单卡片共用）
export const toneOf = (s) => (s >= 75 ? "good" : s >= 55 ? "ok" : "warn");

// 文件指纹：文件名 + 大小 + 修改时间，三者一致视为「同一份未变更的简历」
export const fileSig = (f) => `${f.name}|${f.size}|${f.lastModified}`;

export async function postJSON(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

// 通知服务端同步删除附件（排名移除/清空/覆盖时调用）；静默失败——残留文件由 7 天 TTL 兜底清理
export async function deleteResumeFiles(ids) {
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
