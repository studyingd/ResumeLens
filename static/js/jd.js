/* JD 输入：示例填充与字数统计 */

import { els } from "./dom.js";
import { state } from "./state.js";
import { toast } from "./utils.js";

export const SAMPLE_JD = `岗位职责
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

export function updateJdCount() {
  const n = els.jdInput.value.trim().length;
  els.jdCount.textContent = `${n.toLocaleString()} 字`;
  // 求职者视角下 0 字与 ≥30 字均为合法状态，均视为就绪
  const ready = n >= 30 || (state.view === "candidate" && n === 0);
  els.jdCount.classList.toggle("is-ok", ready);
}

els.jdSampleBtn.addEventListener("click", () => {
  els.jdInput.value = SAMPLE_JD;
  updateJdCount();
  toast("已填入示例岗位 JD，可替换为你的目标岗位", "info", 2600);
});
