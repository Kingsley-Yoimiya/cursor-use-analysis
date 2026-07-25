# Cursor 用量 Canvas 分析参考

## 数据链路

```
npm run login → data/auth.json
npm run export → exports/usage.csv
npm run estimate-cost → reports/estimate.json
scripts/analysis/*.py → reports/*.json / *.svg
Canvas（inline 数字）→ ~/.cursor/projects/<ws>/canvases/*.canvas.tsx
```

看板：`dashboard/server/index.js` 的 `/api/daily` 按 UTC 日字符串前缀聚合；本分析脚本统一转 **UTC+8**，二者日界可能差一行事件，报告里要写明用的是哪套。

## 脚本

| 脚本 | 作用 |
|------|------|
| `scripts/analysis/analyze_daily_usage.py` | 日序列、API/First-party 变化量、趋势+星期拟合、滚动 MAE |
| `scripts/analysis/analyze_usage_portrait.py` | 日历、洛伦兹/Gini、状态机、小时钟、月度池占比、峰值日 |
| `scripts/analysis/plot_style.py` | 大字号、去顶右边框、y 点线网格 |

运行前需：`numpy`、`matplotlib`。输出目录 `reports/` 默认 gitignore。

## 推荐叙事（完整报告）

按这个顺序写 Canvas，读者更容易跟上：

1. 一句话画像（持续 / 爆发 / 单模型 / 跨月换挡）
2. 日历 + 集中度（Gini、Top 天贡献）
3. 五种日状态（沉寂 / API 主导 / First-party 主导 / 混合 / 爆发）
4. 月度池接力 + 账单周期（刷新日可配置，默认 23）
5. 会话与模型接力对
6. 小时钟 + 星期（周末是否更强）
7. 模型排行、日有效模型数、主导份额
8. Fast / Max Mode
9. 缓存反事实杠杆
10. 请求多≠更贵的对照表
11. 五条综合结论

## 反直觉结论检查清单

算完后逐项看是否成立（用**当前用户数据**的数字，不要抄示例）：

- [ ] 活跃日很多，但 token/费用高度集中在少数天？
- [ ] API↔First-party 是跨月换挡，还是同日负相关？
- [ ] 全期模型很多，单日是否仍然“一个主力”？
- [ ] 周末是否强于工作日？
- [ ] Cache Read 是否占输入侧九成左右？
- [ ] 是否存在“请求第二高但费用很低”的日子？

## Canvas 组件偏好

常用：`Stack` `Grid` `Stat` `Callout` `Card` `LineChart` `BarChart` `PieChart` `Table` `Text` `H1`/`H2` `Divider` `useHostTheme`。

日历可用 CSS grid 色阶格子（主题 token），避免手写 hex。`Text` 上不要直接塞 React `key`（包一层 `span`）。

## 附加源与未识别模型

打开「合并附加用量」时，KPI 的 `unknownModelRows` = 主仓 estimate + 各插件 `cursor-summary` 之和。

DongCC 未识别通常来自企业名 → Cursor 键映射缺口，而不是主仓 CSV。排查顺序：

1. `reports/dongcc-cursor-summary.json` → `byModel` 里 `rateResolved: false`
2. 插件 `model-map.json` / `map_model.py`（Sonnet 5 → `claude-sonnet-5`；`claude-haiku-4-5` → `claude-4.5-haiku`）
3. 主仓 `config/model-rates.json` aliases + `scripts/lib/resolve-model-rate.mjs`（已支持 `*-joybuilder`、Claude 语序/版本变体）

Claude Opus 5（`claude-opus-5`，$5/$6.25/$0.5/$25）已入主仓费率；企业名 `Opus-5` / `Claude-Opus-5*` 应能解析。仅测试垃圾名与裸名 `premium` 保持 unknown。

## 隐私

分享仓库或截图前：不要提交原始 CSV / estimate 全量 rows；Canvas 只内嵌聚合数字即可。
