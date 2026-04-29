# Cursor 用量数据采集

把 **cursor.com 控制台** 里的用量导出为 **CSV**（按 token 策略），便于后续做本地可视化与统计（按模型、按天、费用等）。  
官方接口文档（API 类产品线）：[Cursor API 总览](https://cursor.com/docs/api)

---

## 数据采集方式（两条路径）

| 方式 | 命令 | 鉴权 | 说明 |
|------|------|------|------|
| **A. 浏览器会话（本仓库默认）** | `npm run login` → `npm run export` | 将登录态写入 `data/auth.json` | 调用官网导出：`GET /api/dashboard/export-usage-events-csv?startDate=&endDate=&strategy=tokens`。与在网页里点导出等价；可能遇 Cloudflare，可用 CDP + Chrome（见下）。 |
|B. 企业 Admin API | `npm run export-api` | 环境变量 `CURSOR_API_KEY`（`key_…`，`admin:*`） | 调用 `https://api.cursor.com`，`POST /teams/filtered-usage-events`，返回 JSON（可导出 CSV）。**需企业团队**，与 Dashboard 里 Integrations 的 **User API Key** 不是同一种密钥。 |

本仓库当前以 **方式 A** 为主；方式 B 适合已有 Admin 密钥的团队自动化。

**导出 CSV 表头（方式 A）一般包含：** `Date`, `Cloud Agent ID`, `Automation ID`, `Kind`, `Model`, `Max Mode`, `Input (w/ Cache Write)`, `Input (w/o Cache Write)`, `Cache Read`, `Output Tokens`, `Total Tokens`, `Cost`（以实际响应为准）。

**时间参数：** `startDate` / `endDate` 为 **UTC 毫秒时间戳**（与官网链接一致）。

---

## 安全与隐私

- **`data/`**（含 `auth.json`、Playwright/Chrome 持久配置目录等）已在 `.gitignore` 中忽略，**切勿提交**。其中 Cookie / 会话等同账号权限。
- **`.env*`**（如存放 `CURSOR_API_KEY`）已忽略。
- **`*.csv`** 可能包含详细使用记录，默认 **全部忽略**，避免误传仓库。
- 若将 CSV 复制到别处分析，请自行控制分享范围。

---

## 环境要求

- Node.js **≥ 18**
- 首次安装浏览器内核：`npm run setup`

```bash
npm install
npm run setup
```

---

## 使用方式 A：登录并导出 CSV

### 1）登录并保存会话

任选其一：

```bash
# 持久化目录 + stealth（推荐先试）
npm run login -- --chrome

# 或：先打印带 --user-data-dir 的 Chrome 命令，再远程调试连接
npm run chrome-cdp-cmd
# 按提示启动 Chrome 后：
npm run login -- --from-cdp http://127.0.0.1:9222
```

会话写入 **`data/auth.json`**。

### 2）导出用量

```bash
# 默认：本月 1 号 00:00 UTC → 当前时间，strategy=tokens
npm run export -- --out ./exports/my-usage.csv

# 指定区间（示例：2026-01-01 UTC → 当前）
node src/cli.mjs export \
  --start 1767225600000 \
  --end "$(node -e 'process.stdout.write(String(Date.now()))')" \
  --out ./exports/usage-2026-ytd.csv \
  --strategy tokens
```

若纯 HTTP 请求被拦截，可加 **`--headed`**（必要时再加 **`--chrome`**）用有头浏览器拉同一 URL。

---

## 使用方式 B：Admin API

```bash
export CURSOR_API_KEY='key_你的Admin密钥'
npm run export-api -- --out ./exports/usage-from-api.json
# 或 --out ./exports/usage.csv 输出扁平 CSV
```

---

## 脚本一览

| 脚本 | 作用 |
|------|------|
| `npm run setup` | 安装 Playwright Chromium |
| `npm run login` | 浏览器登录并写入 `data/auth.json` |
| `npm run chrome-cdp-cmd` | 打印远程调试 Chrome 启动命令 |
| `npm run export` | 用会话拉官网 CSV |
| `npm run export-api` | 用 Admin Key 拉 API 数据 |

完整参数：`node src/cli.mjs --help`

---

## 后续：可视化建议

- 以 **方式 A** 的 CSV 为数据源时，可按 **`Date`** 聚合日用量，按 **`Model`** / **`Kind`** 拆分，对 **`Total Tokens`** 或 **`Cost`** 做趋势与占比（注意 `Cost` 列可能为 `"Included"` 等文本，解析时做分支）。
- 建议将 **原始 CSV** 留在本机 `exports/`（已 git 忽略），版本库只保留 **脱敏/聚合后的数据** 或 **生成图表的脚本**，避免仓库泄露明细。

---

## 许可与声明

本项目为个人本地工具，与 Cursor 官方无隶属关系。请遵守 Cursor 服务条款；勿将自动化用于绕过人机验证或滥用接口。
