# Cursor 用量分析与成本估算

把 **cursor.com 控制台** 里的用量导出为 **CSV**（`strategy=tokens`），便于本地 **可视化、分摊成本、按模型统计**。本仓库同时抓取 **公开计费文档** 快照，并提供按 **分项 token（含 cache read/write）** 估算「等价 API 美元」的脚本。  
官方 API 文档（企业 Admin）：[Cursor API 总览](https://cursor.com/docs/api) · 公开计费说明：[Models & Pricing](https://cursor.com/docs/models-and-pricing)

---

## ⚡ 快速上手 (Quick Start)

### 0. 环境安装
```bash
npm install
npm run setup  # 安装 Playwright 依赖用于提取鉴权
```

### 1. 登录
```bash
npm run login
```
*(弹出浏览器后，完成 Cursor 官网登录，成功后状态将保存至本地)*

### 2. 获取数据与计算
```bash
# 默认获取本月至今的数据
npm run export

# (可选) 计算等效金额报告
npm run estimate-cost
```

### 3. 启动本地看板
```bash
chmod +x ./dashboard/start-dev.sh
./dashboard/start-dev.sh
```
*(访问 [http://localhost:5173](http://localhost:5173) 即可打开炫酷的本地分析面板！)*

---

## 数据采集方式

| 方式 | 命令 | 鉴权 | 说明 |
|------|------|------|------|
| **A. 浏览器会话（主力）** | `npm run login` → `npm run export` | `data/auth.json`（Cookie / 会话） | 与网页点导出等价：`GET https://cursor.com/api/dashboard/export-usage-events-csv?startDate=&endDate=&strategy=tokens`。**时间戳为 UTC 毫秒。** 遇 Cloudflare 可用 `chrome-cdp-cmd` + `--from-cdp`。 |
| **B. 企业 Admin API** | `npm run export-api` | `CURSOR_API_KEY`（`key_…`，`admin:*`） | `POST https://api.cursor.com/teams/filtered-usage-events`，JSON/CSV。**需企业团队**；Dashboard → Integrations 的 **User API Key** 不能替代。 |

导出 CSV 常见列：`Date`, `Cloud Agent ID`, `Automation ID`, `Kind`, `Model`, `Max Mode`, `Input (w/ Cache Write)`, `Input (w/o Cache Write)`, `Cache Read`, `Output Tokens`, `Total Tokens`, `Cost`（`Cost` 可能为金额或 `Included` 等文案）。

---

## 安全与隐私（务必阅读）

以下路径 **已被 `.gitignore` 忽略，禁止提交到 Git**：

| 路径/模式 | 内容 |
|-----------|------|
| `data/` | `auth.json`、Playwright/Chrome 持久目录（含 `cf_clearance`、登录 Cookie 等），**等同于账号权限**。 |
| `*.csv` | 用量明细，可能暴露模型使用与工作量。 |
| `reports/` | 成本汇总报告（默认忽略；如需版本管理可删 `.gitignore` 里对应行）。 |
| `.env*` | 如存放 `CURSOR_API_KEY`。 |

若需要将「图表」进仓库，请只提交 **脱敏聚合数据** 或 **生成逻辑**，不要提交原始 CSV / `auth.json`。

---

## 环境要求

- Node.js **≥ 18**
- 首次安装 Playwright Chromium：`npm run setup`

```bash
npm install
npm run setup
```

---

## 用法 A：登录并导出 CSV

### 1）写入会话

```bash
# 任选其一
npm run login -- --chrome
npm run chrome-cdp-cmd
# 按输出的命令启动 Chrome 后：
npm run login -- --from-cdp http://127.0.0.1:9222
```

会话文件：**`data/auth.json`**。

### 2）导出

```bash
# 默认：本月 1 号 00:00 UTC → 当前，`strategy=tokens`
npm run export -- --out ./exports/my-usage.csv

# 示例：2026-01-01 UTC 起至今
node src/cli.mjs export \
  --start 1767225600000 \
  --end "$(node -e 'process.stdout.write(String(Date.now()))')" \
  --out ./exports/usage-2026-ytd.csv \
  --strategy tokens
```

若直连下载返回 HTML，可加 **`--headed`**（必要时加 **`--chrome`**）。

---

## 用法 B：Admin API

```bash
export CURSOR_API_KEY='key_你的Admin密钥'
npm run export-api -- --out ./exports/usage-from-api.json
```

---

## 计费文档快照（便于离线对照）

定期抓取官网公开页面到 **`docs/billing/`**（HTML 会包在 markdown 代码块内便于检索）：

```bash
npm run fetch-billing
```

来源索引见 **`docs/billing/INDEX.md`**。**实际计费以官网与合同为准**；政策变更后请重新 `fetch-billing` 并核对 **`config/model-rates.json`**。

---

## 成本估算：`estimate-cost`

根据 **`config/model-rates.json`**（由你维护、需与 [Models & Pricing](https://cursor.com/docs/account/pricing) 对齐）对每条用量计算 **分项 token 费用**：

- **Input (w/o Cache Write)** × `inputPerMillion`
- **Input (w/ Cache Write)** × `cacheWritePerMillion`
- **Cache Read** × `cacheReadPerMillion`（同类调用通常显著低于 full input）
- **Output Tokens** × `outputPerMillion`
- **长上下文**：若配置了 `longContextInputTokensThreshold`，当 **输入侧三类 token 之和** 超过阈值时，仅对 **输入侧费用** 乘以 `longContextMultiplier`（默认不乘 output，见配置文件 `notes`）。
- **Teams**：`--teams` 时额外按 **总 token** 粗略叠加 Cursor Token Rate（`$0.25/M`）；模型名含 `auto` 的行 **不叠加**（与文档「Auto 豁免」对齐的近似）。

```bash
npm run estimate-cost -- --in ./exports/usage-2026-ytd.csv --out ./reports/estimate.json
npm run estimate-cost -- --in ./exports/usage.csv --teams
```

产出 JSON 含 **`byModel` 汇总** 与 **`rows` 逐行明细**（`estimatedUsd`、`inputMult` 等）。  
**说明**：`Kind`/`Cost` 为 `Included` 时，脚本仍可估算「若按 API 单价计费」的美元，**不等于**当月发票；**未建模**包月池抵扣、Premium 具体选型细节、旧版「按请求计费」等。

CSV / 附加源中的 **`Model` 字符串** 先走 **`aliases`**，再按企业后缀（`joybuilder`/`oxygen`）、Claude 语序与版本点横杠变体、effort / thinking / preview 等启发式收拢到公开档位（见 `scripts/lib/resolve-model-rate.mjs`）。全新基座模型仍需在 **`config/model-rates.json`** 增补费率。

合并 DongCC 等附加源时：企业零售名由插件 `model-map.json` 映射到 `cursorModel` 后再解析；主仓解析器也能直接识别常见 `*-joybuilder` 与 `claude-haiku-4-5` 等变体。裸名 `premium`、官网无档的冒烟名（如 `Opus-5`）仍记为 `unknown_model`。

---

## 脚本一览

| 命令 | 作用 |
|------|------|
| `npm run setup` | 安装 Playwright Chromium |
| `npm run login` | 浏览器登录 → `data/auth.json` |
| `npm run chrome-cdp-cmd` | 打印带 `--user-data-dir` 的远程调试启动行 |
| `npm run export` | 用会话拉官网 CSV |
| `npm run export-api` | Admin Key 拉 API |
| `npm run fetch-billing` | 抓取计费文档到 `docs/billing/` |
| `npm run estimate-cost` | 对 CSV 做分项计价估算 |
| `npm run analyze-daily` | 日序列 / API·First-party 变化量与拟合摘要 |
| `npm run analyze-portrait` | 行为画像统计与 SVG（日历、时钟、池占比等） |

完整 CLI：`node src/cli.mjs --help`

---

## Canvas 行为画像分析（推荐分享用法）

仓库内置 Agent Skill：**`.cursor/skills/cursor-usage-canvas-report/`**。在 Cursor 里让 Agent 读取该 skill 后，可基于你本地的 `exports/usage.csv` / `reports/estimate.json` 生成**聊天旁可打开的 Canvas 报告**（日历热力图、池子接力、会话推断、缓存杠杆、请求≠费用等）。

```bash
# 1) 先有用量与估算
npm run export
npm run estimate-cost -- --in ./exports/usage.csv --out ./reports/estimate.json

# 2) 跑可复用统计脚本（需 python3 + numpy + matplotlib）
python3 scripts/analysis/analyze_daily_usage.py
python3 scripts/analysis/analyze_usage_portrait.py

# 3) 在对话中：@cursor-usage-canvas-report 或说明「按 skill 做完整用量 Canvas 报告」
```

- 脚本与 skill **可提交**；`exports/*.csv`、`reports/estimate.json` 与个人 SVG/JSON **不要提交**（已在 `.gitignore`）。
- 时间默认按 **UTC+8** 日历日；费用为公开单价**等效价值**，不是发票。
- 详细口径与叙事顺序见 skill 内 [reference.md](./.cursor/skills/cursor-usage-canvas-report/reference.md)。

---

## 后续：可视化建议

本项目包含了一个功能完整的本地 React + Vite + Express 看板，用于可视化分析从 Cursor 导出的 API 用量和成本。

- **快速启动**：运行 `./dashboard/start-dev.sh`，访问 `http://localhost:5173`。
  - **功能特色**：支持明暗主题切换、自定义日期筛选、每日用量趋势图、按 API/First-party/Auto 池子划分的堆叠图、全模型排行榜与 Cache Hit Rate。
- 更多详情请查看 [Dashboard README](./dashboard/README.md)。

- 以 CSV 或 `reports/estimate.json` 的 **`byModel` / 按日期聚合** 驱动图表（趋势、堆叠、Max Mode 对比）。
- **Cache read** 占比高通常表示命中提示缓存，单价更低，适合在图例中与 input/output 区分。
- 正式对外分享前做 **脱敏**（剔除 Cloud Agent ID 等如需）。

---

## 许可与声明

本项目为个人本地工具，与 Cursor / Anysphere 无隶属关系。请遵守服务条款；勿将工具用于绕过人机验证或滥用接口。
