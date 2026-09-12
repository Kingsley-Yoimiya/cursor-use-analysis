# 静态看板：Vercel + 浏览器数据面

## 目的

把「人人可打开的用量看板」和「用 Cursor 会话拉 CSV」拆开。

- **云端**：`dashboard/web` 静态部署（Vercel）。用户导入官网导出的 CSV，解析 / 计价 / 画图都在浏览器里完成，数据放 IndexedDB。
- **本机**：现有 CLI + Express 不变，继续 Playwright 登录与一键同步。
- **Cloud Agent**：不依赖 Cookie；用可提交的脱敏 fixture + `?demo=1` 空跑整页。

## 第一性原理

网站读不到 `cursor.com` 的 HttpOnly Cookie，也不能安全地在 Vercel Function 里拿会话打官网（CORS、Cloudflare 机房 IP、账号密钥）。因此云端路径 **禁止 Cookie / `auth.json` / 代登录**。

数据从哪来：用户在 [cursor.com 控制台](https://cursor.com/dashboard) 导出的 `strategy=tokens` CSV（与 `npm run export` 同口径），或本机 CLI 已经写出的文件。

## 数据模式

| 模式 | 何时 | 数据从哪来 |
|---|---|---|
| `local` | `/api/health` 通（本机 Express） | 现有后端，行为不变 |
| `static` | 健康检查失败，或 `?mode=static` | IndexedDB 里导入的 CSV；可点「加载演示」 |
| `fixture` | `?demo=1` / `?mode=fixture` / `VITE_DATA_MODE=fixture` | 打包内 `public/fixtures/usage.sample.csv` |

探测顺序：URL / 环境变量强制 `fixture` 或 `static` → 探测 health → 否则 static。

## 前端怎么接现有 API

静态模式下用 axios adapter 在浏览器内实现与 Express 同形的 `/api/*`：

- 有：`health` `daily` `hourly` `period-stats` `summary` `profiles` `data-status` `reload` `reimbursement-profile` `export/usage-with-cost.csv`
- 无：`sync` / `refresh` / 插件 / 读 Cookie 解邮箱
- 报销人信息进 IndexedDB（不要把本机 `dashboard-settings.json` 里的姓名邮箱打进公开前端）

口径与 `dashboard/server/index.js` 对齐：同一套 `processUsageRow`、池子分类、账单周期、上海时区小时。费率仍读仓库 `config/model-rates.json`（构建期打进包）。

## 身份

静态：每个导入的 CSV = 一个身份，勾选汇总与本机 Profile 面板同交互。主按钮导入写入 `default`。不提供「复制 npm login」。

## Vercel

只构建 `dashboard/web`。无 Serverless、无 Playwright、无环境变量 Cookie。访问记录用 Vercel Web Analytics（`@vercel/analytics`，根组件挂 `<Analytics />`）。

## 明确不做

- 跳转 Cursor 抓 Cookie
- 把 `auth.json` 交给 Cloud Agent 或 Vercel env
- 云端多租户账号系统

## 验收

1. 无 Express：`/?demo=1` 能看完概览 / 周期 / 报销 / 模型。
2. 导入真实 CSV 后图表与本机看板同口径（允许浮点误差）。
3. 本机 `./dashboard/start-dev.sh` 仍走 Express，同步按钮仍在。
4. `data/`、`*.csv`（fixture 除外）、Cookie 不被提交。
