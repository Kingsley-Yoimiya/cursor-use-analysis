---
name: cursor-usage-canvas-report
description: >-
  Analyzes local Cursor usage exports and produces a Chinese Canvas behavior
  report (calendar heatmap, pool relay, sessions, cache leverage, cost
  paradoxes). Use when the user asks for usage analysis, behavior portrait,
  fancy/完整分析报告, API vs First-party trends, or Canvas-style data storytelling
  on cursor-use-analysis.
---

# Cursor 用量 Canvas 分析报告

把本地 Cursor 用量做成**可打开的 Canvas 行为画像报告**，风格偏“有意思的结论 + 自描述图表”，不是空拟合曲线。

## 何时使用

用户提到：用量分析、行为画像、完整报告、fancy 结论、API/First-party 变化、日历热力图、缓存杠杆、会话接力，或要生成/更新这类 Canvas。

## 必读依赖

1. 先读并遵循 Cursor 内置 **canvas** skill（路径、`cursor/canvas` 组件、禁止空状态/渐变/emoji）。
2. 本仓库数据与脚本约定见下方；细节见 [reference.md](reference.md)。

## 工作流

### 1. 确认数据

需要：

| 文件 | 作用 |
|------|------|
| `exports/usage.csv` | 事件明细（勿提交） |
| `reports/estimate.json` | 逐行估算 + `pool`（勿提交原始大文件） |
| `config/model-rates.json` | 费率与 `billingPool` |

若缺失或过旧：

```bash
npm run export
npm run estimate-cost -- --in ./exports/usage.csv --out ./reports/estimate.json
```

看板同步也行：`./dashboard/start-dev.sh` 后点同步，或 `POST /api/sync`。

### 2. 跑可复用分析脚本

```bash
# 依赖：python3 + numpy + matplotlib
python3 scripts/analysis/analyze_daily_usage.py
python3 scripts/analysis/analyze_usage_portrait.py
```

产出落在 `reports/`（已 gitignore）：统计 JSON、变化量 CSV、SVG。

### 3. 再挖“有意思”的角度（推荐）

在脚本结果之外，用 `estimate.json` 的 `rows` 额外计算并写进报告（完整日排除“今天未结束”）：

- **会话**：相邻事件间隔 >30 分钟切分；多模型占比、高频接力对
- **Fast / Max Mode**：请求占比 vs 费用占比、单次均价
- **星期/小时**：周日是否更强；16:00 峰值；晚间 vs 凌晨
- **账单周期**：默认刷新日 23 的周期累计费用
- **请求≠费用**：挑“忙而便宜”与“少而昂贵”对照日
- **缓存反事实**：Cache Read 若按普通 input 计价的差额（标明不是实付节省）

### 4. 写 Canvas（主交付物）

路径（按本机用户名替换）：

`/Users/<user>/.cursor/projects/<workspace>/canvases/<name>.canvas.tsx`

推荐文件名：

- `usage-behavior-portrait.canvas.tsx` — 画像短版
- `usage-complete-report.canvas.tsx` — 完整报告

结构模板：

1. **一句话画像**（Callout）
2. **4–8 个 Stat**（活跃率、Gini、主导模型份额、峰值小时等）
3. **日历热力图**（可用分位色阶格子；或嵌入脚本 SVG 说明）
4. **池子接力**（月度堆叠占比）
5. **会话/接力、时钟、星期**
6. **模型排行 + Fast/Max**
7. **缓存杠杆 + 请求≠费用表**
8. **综合结论**（5 条以内）
9. 页脚：数据源、时区、完整日范围、费用免责声明

硬规则：

- 只 `import` from `cursor/canvas`；数据全部 inline
- 每个图有标题、单位、来源/口径 caption
- 中文文案；费用写“公开单价等效”，勿写成发票
- API 池 ≠ `Kind=User API Key`
- 时间：UTC → **UTC+8** 日历日；末日未结束不参与排名/环比

### 5. 可选书面报告

若用户要可版本化文档：写 `reports/usage-complete-analysis.md`（目录仍 ignore；或摘要放 README 不贴个人数字）。

### 6. 回复用户

- 给 Canvas 的 markdown 链接（绝对路径）
- 3–6 条最有信息量的结论，不要复述整个图表

## 口径速记

- **Token** = cacheWrite + noCache + cacheRead + output
- **池**：`Auto` / `FirstParty`（`billingPool=firstParty`）/ `API`
- **请求数** = CSV/estimate 行数，≠ 用户手动 prompt 次数
- **会话** = 30 分钟间隔推断，≠ 官方 session ID

## 不要做

- 不要提交 `exports/*.csv`、`reports/estimate.json`、`data/`、个人 SVG/JSON
- 不要用高次多项式硬拟合当主结论
- 不要把等效美元说成实付账单
