# ResumeLens · 简历岗位匹配分析器

上传简历 + 粘贴岗位 JD，获得匹配度评分、简历优点与逐条可执行的优化建议。

![技术栈](https://img.shields.io/badge/Python-3.13-3776AB) ![框架](https://img.shields.io/badge/FastAPI-0d5c63) ![引擎](https://img.shields.io/badge/双引擎-LLM%20%2B%20本地启发式-teal)

## 功能

- **双视角**：
  - **求职者视角**：单份简历对照 JD，获得匹配度评分、优点与逐条优化建议
  - **面试官视角**：批量上传多份候选人简历（≤ 20 份），按匹配度排名，点击查看逐人详情，并基于 JD 与该候选人简历生成结构化面试题（技术验证 / 项目深挖 / 短板探测 / 情景设计 / 软素质，含考察意图与参考答案要点）
- **扫描件 PDF 自动 OCR**：图片型/扫描 PDF 无文本层时自动回退到本地 OCR（RapidOCR，离线运行、支持中英文），识别后继续评估，并在结果中提示 OCR 来源
- **页面内配置 AI**：右上角齿轮打开设置弹窗，填入 OpenAI 兼容接口的 Base URL 与 API Key 后自动拉取模型列表（也可手动输入），支持连接测试；配置保存在本机 `config.local.json`（优先级高于 `.env`）
- **岗位 JD 手动粘贴**：从招聘网站复制职位描述粘贴即可
- **双引擎评估**：
  - **AI 深度评估**：四维评分、优缺点归因、STAR 法则简介改写示范
  - **本地启发式分析**：未配置 API Key 时自动启用，基于关键词覆盖、量化密度、结构完整度的规则分析，开箱即用；LLM 调用失败时也会自动降级
- **可视化报告**：综合匹配度评分环、维度评分卡、优点/待优化双栏清单（含优先级）、JD 关键词覆盖对照
- **隐私友好**：简历在本地解析（含 OCR），仅在启用 AI 评估时发送至你自行配置的模型接口

## 快速开始

```bash
# 1. 安装依赖（需要 uv 或 pip）
uv sync

# 2. 启动（二选一）
uv run uvicorn app.server:app --host 127.0.0.1 --port 8000 --reload
uv run python main.py

# 3. 打开 http://127.0.0.1:8000
```

开箱即用（本地启发式引擎）。`samples/` 目录内置了示例简历与前端「填入示例」按钮自带的示例 JD，可快速体验完整流程。

## 启用 AI 深度评估（推荐）

**方式一：页面设置（推荐）** — 打开 http://127.0.0.1:8000 ，点击右上角齿轮：

1. 点快捷预设（DeepSeek / OpenAI / Kimi / 本地 Ollama）自动填入 Base URL 与模型名
2. 填入 API Key（Ollama 本地服务填任意非空值），可先「测试连接」
3. 「保存并启用」，右上角徽标变为「AI 评估 · 模型名」

配置保存在本机 `config.local.json`（已加入 .gitignore，明文存储，请勿在共享设备使用）。

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
│   ├── parser.py         # 简历文本提取（PDF / DOCX / TXT / MD，兼容 GBK 编码）
│   ├── evaluator.py      # 双评估引擎：LLM 提示词与调用 + 本地启发式分析
│   └── config.py         # 配置管理（页面设置 > .env > 默认值，支持热更新）
├── static/               # 单页前端（原生 HTML/CSS/JS，无构建步骤）
├── samples/              # 示例简历
└── .env.example          # LLM 配置模板
```

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/health` | 服务状态、当前引擎与配置来源 |
| `GET` | `/api/config` | 当前配置（脱敏） |
| `POST` | `/api/config` | 保存/清除页面设置（`api_key="__KEEP__"` 保留已存 Key） |
| `POST` | `/api/config/test` | 用提交凭据发起最小调用验证连通性（Key 留空回退已保存的） |
| `POST` | `/api/config/models` | 拉取 OpenAI 兼容接口的模型列表 |
| `POST` | `/api/evaluate` | `multipart/form-data`：`jd`（必填）+ `file` 或 `resume_text` |
| `POST` | `/api/batch-evaluate` | 多份简历对照同一 JD 批量评估（含候选人姓名识别） |
| `POST` | `/api/interview-questions` | `{jd, resume}` → 结构化面试题单 |

## 已知限制

- 扫描件 PDF 依赖 OCR 识别，极度模糊、低分辨率的图片可能识别不准（结果页会提示已使用 OCR，建议核对）；OCR 最多处理前 12 页
- 本地启发式引擎为规则估算，深度与准确性不如 LLM，建议配置 AI 评估
