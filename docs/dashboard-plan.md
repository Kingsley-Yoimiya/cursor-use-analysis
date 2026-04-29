# Cursor Usage Dashboard 实施计划

## 第一性原理思考

**目标**：构建一个本地数据面板（Dashboard），用于直观展示 Cursor 的 API 用量、等效成本、使用趋势和模型偏好。
**数据源**：
1. `reports/estimate.json`（总体统计与各模型等效成本）
2. `exports/usage-2026-ytd.csv`（详细的历史请求记录）

**核心问题与解决方案**：
*   **如何提供数据给前端？** 
    *   因为涉及到读取本地文件和可能的大量 CSV 解析，需要一个轻量级的后端。
    *   方案：使用 `Express.js` 构建轻量 API，提供 `/api/summary` (读取 JSON) 和 `/api/daily-trends` (解析 CSV) 等接口。
*   **前端如何快速搭建且美观？**
    *   方案：使用 `Vite` + `React` + `TypeScript` + `TailwindCSS`。
    *   图表：使用 `Recharts`，能够极其简单地基于 JSON 数组渲染折线图和堆叠柱状图。
    *   UI 组件：使用原生的 HTML/Tailwind 或轻量封装的组件，保持简单。

## 架构设计

项目将作为现有 `cursor-usage-analysis` 仓库的一部分，在根目录下新增 `dashboard` 目录：
```text
dashboard/
  ├── server/           # Express 后端
  │   ├── index.js      # 启动服务器并暴露 API
  │   └── package.json  
  └── web/              # Vite + React 前端
      ├── src/
      │   ├── App.tsx   # 主视图
      │   └── components/ # 卡片、图表组件
      └── package.json
```

## 实施阶段拆解

### 阶段一：基础环境与核心 API (当前阶段)
1. **搭建后端**：在 `dashboard/server` 初始化 Express 项目，安装 `cors`, `csv-parser` 等依赖。
2. **编写 API**：
   *   `GET /api/summary`：读取 `../../reports/estimate.json` 并返回总览数据（Total USD, Requests等）。
   *   `GET /api/daily`：读取 `../../exports/usage-2026-ytd.csv`，按天聚合 `Total Tokens`, `Cache Read`, `Cost` 等数据。
3. **搭建前端**：在 `dashboard/web` 初始化 React+Vite 项目，安装 `axios`, `recharts`, `tailwindcss`。
4. **测试运行**：确保前后端能成功启动，且能够调通 API。

### 阶段二：前端 UI 与 KPI/趋势图开发
1. **全局样式**：配置 Tailwind，设定 Dark Mode（暗色主题适合代码面板）。
2. **KPI 概览卡片**：展示总成本、总请求数、Token 消耗量。
3. **趋势图**：使用 `Recharts` 绘制：
   *   每日消耗等效 USD 折线图。
   *   每日 Token 消耗堆叠柱状图（Cache vs No Cache vs Output）。

### 阶段三：高级明细与模型偏好
1. 提取 JSON 中的 `byModel` 数据，绘制模型占比饼图。
2. 历史请求明细表格（从 CSV 提取 Top 消耗请求）。
3. 添加“刷新数据”按钮触发系统根目录的 `setup`/`export` 脚本。
