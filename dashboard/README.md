# Cursor Usage Dashboard

这是一个基于 React + Vite + Express 构建的本地数据看板，用于可视化分析从 Cursor 导出的 API 用量和成本。

## 功能特性

- 🌗 **明暗主题切换**：极客代码面板风与清新白底风一键切换（持久化保存）。
- 📊 **核心 KPI 概览**：直观展示总等价金额 (USD)、总请求数、Token 总计以及缓存命中率。
- 📅 **自定义日期筛选**：选择指定时间段，所有图表与数据联动更新。
- 💰 **每日用量趋势图**：使用面积图直观展示每日等价 API 消耗金额的变化趋势。
- 📈 **模型分类栈图**：将用量拆分为 `API`、`Composer` 和 `Auto` 三大池子，支持在 USD 金额和 Tokens 数量间切换。
- 🤖 **分模型详情与趋势**：详细的每日模型用量堆叠图，看清算力分配。
- 🏆 **全模型排行榜**：所有模型使用量排序，包含独特的 **Cache Hit Rate (缓存命中率)** 进度条展示。

## 目录结构

```text
dashboard/
├── server/           # Express 后端服务 (提供数据读取与计算 API)
│   ├── index.js      # 核心 API：解析 CSV、结合模型费率计算成本
│   └── package.json
├── web/              # React + Vite 前端面板
│   ├── src/          # 组件源码 (Recharts, TailwindCSS)
│   └── package.json
├── logs/             # 本地运行日志 (已被 gitignore 忽略)
└── start-dev.sh      # 一键启动脚本
```

## 如何使用

确保你已经在根目录执行了导出数据脚本，并生成了 `exports/usage.csv` 和 `reports/estimate.json`（或根据年份对应的文件，默认脚本会读取这些路径）。

### 一键启动

在项目根目录下运行：

```bash
chmod +x dashboard/start-dev.sh
./dashboard/start-dev.sh
```

这会在后台启动 Node.js 后端（默认端口 `3001`）和 Vite 前端（默认端口 `5173`），并将日志写入 `dashboard/logs/` 目录。

### 访问面板

打开浏览器访问：[http://localhost:5173](http://localhost:5173)

### 手动独立启动（用于开发调试）

如果你需要修改代码并查看实时效果，可以分别在两个终端中启动：

**启动后端：**
```bash
cd dashboard/server
npm install
npm run start
```

**启动前端：**
```bash
cd dashboard/web
npm install
npm run dev
```

## 数据流说明

1. **`/api/summary`**：直接读取根目录的 `reports/estimate.json`，提供宏观统计和模型排行榜的基础数据。
2. **`/api/daily`**：流式读取根目录的 `exports/usage.csv`，并结合 `config/model-rates.json` 的模型费率，实时计算每一行请求的真实等效 USD。按天和池子（Auto/Composer/API）进行聚合后返回给前端渲染图表。
