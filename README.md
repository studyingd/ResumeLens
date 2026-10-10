# ResumeLens · 简历岗位匹配分析器

上传简历 + 粘贴岗位 JD，获得匹配度评分、简历优点与逐条可执行的优化建议。

![技术栈](https://img.shields.io/badge/Python-3.13-3776AB) ![框架](https://img.shields.io/badge/FastAPI-0d5c63) ![引擎](https://img.shields.io/badge/引擎-AI%20深度评估-teal)

## 功能

- **双视角**：
  - **求职者视角**：上传简历对照 JD，获得匹配度评分、优点与逐条优化建议；**岗位 JD 支持留空**——不填则对简历做「内容为王」的通用体检：经历含金量 / 成果量化 / 聚焦与一致性 / 表达与结构四维评分（内容权重远高于格式），并重点检查内容重复与冗余
    - **待优化点可交互**：每条问题标注处理动作（删除 / 精简 / 补充 / 改写），点击卡片弹出详情页，可完整查看问题描述、简历原文与优化后文本对照（支持一键复制）
    - **岗位推荐**：体检完成后自动基于简历推荐 3-5 个岗位方向（平台常见职位名、职级、薪资参考、匹配理由、城市），每个方向附 BOSS直聘 / 智联招聘 / 前程无忧 / 猎聘的搜索直达按钮（关键词预填，新标签页打开）；并列出扩大岗位选择面建议补齐的技能
    - **结果保留**：体检/匹配结果与岗位推荐保存在本机，刷新不丢失；重新体检时若附件简历与上次完全相同（未检测到差异），会提醒并需二次确认才强制重检
    - 注：各招聘平台均无公开职位搜索 API，推荐为「岗位方向 + 精准搜索词 + 平台搜索直达」，而非实时职位列表
  - **面试官视角**：批量上传多份候选人简历（≤ 20 份，榜单可多轮累计不限人数），按匹配度排名，点击查看逐人详情，并基于 JD 与该候选人简历生成结构化面试题（岗位职责 / 技能验证 / 情景设计 / 软素质，含考察意图与参考答案要点；四类题量可自定义，默认 4/3/2/1，可为 0 跳过某类）；已有排名后再上传新简历时自动**增量评估**——只评新增/变更的简历，未变更的跳过重评
    - **评分以专业技能与岗位适配度为主**：格式类问题（乱码/重复字符/日期错误/罗列重复等）完全不提也不影响评分——候选人评估只看内容；经历时间线自相矛盾、年限与职级明显不符等可信度问题属于内容问题，可列入待优化点并影响评分；仅模块顺序错乱等纯结构性混乱才轻量提示一条且不拖累总分；详情页的待优化点为只读摘要（仅问题与优先级，无建议与详情弹窗），便于快速浏览多人对比
    - **分段榜单**：候选人按 ≥85 强烈推荐 / 70-84 推荐 / 55-69 备选 / <55 不推荐分段展示（LLM 评分存在采样波动，小分差意义有限，同分段内的先后顺序仅供参考）；批量评估温度固定为 0，同批内分数口径稳定可比
    - **批量评估提速**：并发默认 4（`LLM_CONCURRENCY` 可调，撞限流可调回 2）+ 精简提示词（榜单与只读摘要只需核心字段，输出减半），20 份简历约 1-2 分钟；单份评估仍走完整提示词保证深度；限流/超时/服务端抖动会自动退避重试（最多 2 次）
    - **附件生命周期与排名同步**：移除候选人/清空排名/同名覆盖/换 JD 重开新榜时，对应简历附件自动从服务端删除；附件另有 7 天保留期兑底（超期孤儿文件在下次批量评估时清理）
- **扫描件 PDF 自动 OCR**：图片型/扫描 PDF 无文本层时自动回退到本地 OCR（RapidOCR，离线运行、支持中英文），识别后继续评估，并在结果中提示 OCR 来源
- **页面内配置 AI**：右上角齿轮打开设置弹窗，填入 OpenAI 兼容接口的 Base URL 与 API Key 后自动拉取模型列表（也可手动输入），支持连接测试；配置保存在本机 `config.local.json`（优先级高于 `.env`）
- **岗位 JD 手动粘贴**：从招聘网站复制职位描述粘贴即可（求职者视角可留空，仅做简历体检）
- **AI 深度评估**：四维评分、优缺点归因、STAR 法则简介改写示范（需配置 OpenAI 兼容接口，支持 DeepSeek / OpenAI / Kimi / 本地 Ollama 等）
- **可视化报告**：综合匹配度评分环、维度评分卡、优点/待优化双栏清单（含优先级与处理动作、原文对照）、JD 关键词覆盖对照
- **隐私友好**：简历在本地解析（含 OCR），评估内容仅发送至你自行配置的模型接口

## 快速开始

```bash
# 1. 安装依赖（需要 uv 或 pip）
uv sync

# 2. 启动（二选一）
uv run uvicorn app.server:app --host 127.0.0.1 --port 8000 --reload
uv run python main.py

# 3. 打开 http://127.0.0.1:8000
```

首次使用需先配置模型接口（见下节，约 1 分钟）。`samples/` 目录内置了示例简历与前端「填入示例」按钮自带的示例 JD，配置后可快速体验完整流程。

## 配置 AI 评估（必需）

**方式一：页面设置（推荐）** — 打开 http://127.0.0.1:8000 ，点击右上角齿轮：

1. 点快捷预设（DeepSeek / OpenAI / Kimi / 本地 Ollama）自动填入 Base URL 与模型名
2. 填入 API Key（Ollama 本地服务填任意非空值），可先「测试连接」
3. 「保存并启用」，右上角徽标变为「AI 评估 · 模型名」
4. 可选：设置批量评估并发数（1-8，撞限流 429 可调小；也可用环境变量 `LLM_CONCURRENCY` 预置）

配置保存在本机 `config.local.json`（已加入 .gitignore，明文存储，请勿在共享设备使用）。

> ⚠️ **本工具面向本地单机使用，请勿直接暴露到公网**：配置接口允许服务端向你填写的任意 Base URL 发起请求，且 API Key 明文保存在服务端。

**方式二：环境变量** — 复制 `.env.example` 为 `.env`：

```ini
# DeepSeek
LLM_API_KEY=sk-xxxxxxxx
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_MODEL=deepseek-chat

# OpenAI
# LLM_BASE_URL=https://api.openai.com/v1
# LLM_MODEL=gpt-4o

# 本地 Ollama（Key 填任意非空值）
# LLM_API_KEY=ollama
# LLM_BASE_URL=http://localhost:11434/v1
# LLM_MODEL=qwen2.5:14b
```

保存后重启服务。页面设置（config.local.json）优先于环境变量。

## 项目结构

```
├── main.py               # 开发服务器入口
├── app/
│   ├── server.py         # FastAPI 路由（health / evaluate / config / 静态托管）
│   ├── parser.py         # 简历文本提取（PDF / DOCX / TXT / MD，兼容 GBK；扫描件 OCR；乱码质量检测）
│   ├── evaluator.py      # LLM 评估与岗位推荐（OpenAI / Anthropic 兼容调用）
│   └── config.py         # 配置管理（页面设置 > .env > 默认值，支持热更新）
├── static/               # 单页前端（原生 HTML/CSS + ES Modules，无构建步骤，入口 js/app.js）
├── tests/                # pytest 测试（离线，不请求真实 LLM）
├── samples/              # 示例简历
└── .env.example          # LLM 配置模板
```

## 开发

```bash
uv run ruff check .   # lint
uv run pytest -q      # 测试（离线，mock LLM）
```

推送 / PR 到 main 会自动跑 GitHub Actions（lint + 测试，见 `.github/workflows/ci.yml`）。

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/health` | 服务状态、当前引擎与配置来源 |
| `GET` | `/api/config` | 当前配置（脱敏） |
| `POST` | `/api/config` | 保存/清除页面设置（`api_key="__KEEP__"` 保留已存 Key） |
| `POST` | `/api/config/test` | 用提交凭据发起最小调用验证连通性（Key 留空回退已保存的） |
| `POST` | `/api/config/models` | 拉取 OpenAI 兼容接口的模型列表 |
| `POST` | `/api/evaluate` | `multipart/form-data`：`file` 或 `resume_text`；`jd` 可选（留空 = 简历体检，≥30 字 = 岗位匹配）；响应含截断的 `resume` 文本供推荐复用 |
| `POST` | `/api/job-recommend` | `{resume}` → 岗位方向推荐（含各平台搜索关键词） |
| `POST` | `/api/batch-evaluate` | 多份简历对照同一 JD 批量评估（含候选人姓名识别） |
| `POST` | `/api/interview-questions` | `{jd, resume}` → 结构化面试题单 |
| `POST` | `/api/interview-question-regenerate` | `{jd, resume, question, category, others}` → 单题重新生成 |
| `DELETE` | `/api/resume-files` | `{file_ids}` → 删除已上传的简历附件 |
| `GET` | `/api/resume-file/{file_id}` | 内嵌预览简历原件（PDF 走浏览器阅读器，DOCX/TXT/MD 转 HTML） |

## 已知限制

- 扫描件 PDF 依赖 OCR 识别，极度模糊、低分辨率的图片可能识别不准（结果页会提示已使用 OCR，建议核对）；OCR 最多处理前 12 页
- 发送给模型前简历最多截取前 24000 字符、JD 最多 8000 字符（超长内容会在结果 notice 中提示已截断，简历后半段可能未被评估）
- 文本提取检测到较多乱码/不可识别字符时会在结果中提示核对原件（多来自编码转换或 OCR，不代表候选人能力，也不作为扣分项）
