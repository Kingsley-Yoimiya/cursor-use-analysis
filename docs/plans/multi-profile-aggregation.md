# 多账号身份 + 汇总统计方案

## 目标（第一性原理）

你要解决的问题是：

> 一个 Cursor 账号不够用 → 多个账号各自导出用量 → 看板里勾选 A/B/C → **把勾选账号的用量算进同一套统计**。

因此交付物应是：

1. **多身份（Profile）**：每个 Cursor 账号 = 一个本地身份（有自己的会话与数据文件）
2. **右上角身份面板**：查看已登记身份、勾选参与汇总、触发该身份同步
3. **汇总**：概览 / 模型详情 / 小时节奏 / 周期统计 按勾选身份合并

不是：给看板加密码/注册系统（本机工具没必要）。

---

## 现状约束

| 点 | 含义 |
|---|---|
| 数据路径写死 | `exports/usage.csv` + `reports/estimate.json` 只有一份 |
| CSV 无 user 列 | 官网导出无法区分账号，只能「一会话一人」 |
| 已有「合并附加源」 | 插件 `mergeIntoOverview`，适合 DongCC 等外源，不适合第二 Cursor 账号 |
| CLI 已支持 `--auth` | `login` / `export` 可指向不同会话文件 |

结论：必须按 **Profile 分目录存数据**，再在 API/前端做多选汇总。

---

## 推荐模型：本地 Profile 注册表

### 目录约定

```text
config/profiles.json          # 身份列表（可提交结构；不含 Cookie）
data/profiles/<id>/
  auth.json                   # 该账号会话（gitignore）
  browser-profile/            # 可选，独立浏览器配置
exports/profiles/<id>/
  usage.csv
reports/profiles/<id>/
  estimate.json
```

兼容：保留现有根路径 `data/auth.json` / `exports/usage.csv` / `reports/estimate.json` 作为 **默认身份 `default`**（迁移：首次启动若无 profiles.json，自动登记 `default` 指向旧路径）。

### `config/profiles.json` 示例

```json
{
  "profiles": [
    {
      "id": "default",
      "label": "主账号",
      "authPath": "data/auth.json",
      "usageCsv": "exports/usage.csv",
      "estimateJson": "reports/estimate.json",
      "legacy": true
    },
    {
      "id": "alt",
      "label": "备用账号",
      "authPath": "data/profiles/alt/auth.json",
      "usageCsv": "exports/profiles/alt/usage.csv",
      "estimateJson": "reports/profiles/alt/estimate.json"
    }
  ],
  "activeForSync": "default"
}
```

- `activeForSync`：点「同步」时默认刷新哪个身份（可在面板里改）
- 勾选汇总集合存在前端 `localStorage`（如 `cursor-dashboard-selected-profiles`）

---

## UI（右上角）

在 `App.tsx` header 里，`DataSyncBar` 旁增加 **「身份」** 按钮：

```
[身份 ▾]  →  弹层
├─ ☑ 主账号     上次同步 · · ·  [同步]
├─ ☑ 备用账号   未登录 / 已过期 [登录指引] [同步]
├─ ─ ─ ─ ─ ─ ─
├─ 已选 2 个 · 汇总中
└─ [+ 添加身份]
```

交互：

1. **勾选** = 是否计入当前看板汇总（核心）
2. **同步** = 对该身份跑 `export --auth … --out …` + `estimate-cost`
3. **添加身份** = 输入 id/显示名 → 写 `profiles.json` → 提示本地执行  
   `npm run login -- --auth data/profiles/<id>/auth.json --chrome`  
   （登录需浏览器人工过 Cloudflare，看板内无法静默代登）
4. 标题旁小字：`汇总：主账号 + 备用账号`（勾选变化时更新）

报销页：**默认只用当前同步身份**，或单独选择「报销归属账号」（避免把两人费用开进一张报销单）。可在 MVP 标明「报销暂不汇总」。

---

## API 变更

| Endpoint | 变更 |
|---|---|
| `GET /api/profiles` | 列出身份 + 各文件是否存在 / 会话是否过期 |
| `POST /api/profiles` | 添加身份（建目录 + 写 profiles.json） |
| `PATCH /api/profiles/:id` | 改 label / activeForSync |
| `GET /api/daily?profiles=a,b` | 多 CSV 分别聚合再按日 merge |
| `GET /api/hourly?profiles=…` | 同上 |
| `GET /api/period-stats?profiles=…` | 同上 |
| `GET /api/summary?profiles=…` | 多 estimate 合并或改为由 daily 推导 |
| `POST /api/sync` | body `{ profileId }`，按该身份路径 export+estimate |

合并算法：复用前端已有 `mergeDailyEntries` 思路，**优先服务端合并**（周期统计、导出 CSV 也一致）。

---

## CLI / npm scripts

```bash
# 为备用账号登录
npm run login -- --auth data/profiles/alt/auth.json --chrome

# 导出到该身份目录
npm run export -- --auth data/profiles/alt/auth.json --out exports/profiles/alt/usage.csv

# 计价
npm run estimate-cost -- --in exports/profiles/alt/usage.csv --out reports/profiles/alt/estimate.json
```

可选：加薄封装 `npm run profile:sync -- alt`，看板 sync API 内部调同一套。

---

## 分期

### MVP（建议先做）

1. Profile 注册表 + 默认迁移
2. 右上角勾选多身份
3. `/api/daily` / `/api/hourly` / 概览 KPI 支持 `profiles=` 汇总
4. `POST /api/sync` 按 profileId
5. 添加身份 + 登录命令提示

### 二期

- 周期统计 / 报销按身份或汇总
- 图表按身份分色对比（可选「对比模式」）
- 看板内一键唤起 `login`（spawn，仍需人工过验证）

### 不做（明确）

- 云端多租户 / 密码注册
- 把 Teams Admin `userEmail` 当成个人多账号（那是企业成员维度，另一条路）

---

## 风险与注意

- 同步耗时：多账号依次 sync，日志分目录带时间戳（符合现有 `start-dev.sh` 约定）
- Cookie 隔离：每个身份独立 `auth.json` + 建议独立 `--profile` 浏览器目录
- 费用口径：汇总是「多账号等效 USD 相加」，不是官方合并账单

---

## 实现状态（2026-08-05）

已落地 MVP：

- `config/profiles.json` + `dashboard/server/profiles.js`
- 邮箱：`GET https://cursor.com/api/auth/me`，缓存于 `data/profile-identity/`
- API：`/api/profiles`、`?profiles=` 汇总、`POST /api/sync` body.`profileId`
- UI：右上角 `ProfileSwitcher`；报销固定 `default`

## 待确认（已确认）

1. MVP：勾选汇总 + 分身份同步；报销不汇总 ✓
2. 第二账号：添加身份 + npm login ✓
3. 显示尽量解邮箱 ✓
