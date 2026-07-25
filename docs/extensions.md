# 可选本地扩展

Dashboard 支持从本机路径加载可选扩展（默认关闭）。未配置时界面与行为与单数据源版本一致。

```bash
cp config/plugins.example.json config/plugins.local.json
```

`config/plugins.local.json` 已被 gitignore。  
契约与示例见 `plugins/example-source/` 及 `dashboard/server/plugin-host.js`。

## 合并附加用量与模型识别

打开「合并附加用量」后，概览 KPI 的「未识别模型」会叠入插件 `cursor-summary` 的 `unknownModelRows`。  
企业代理（如 DongCC）的零售名需先映射到主仓 `config/model-rates.json` 规范键；规则见主仓 `scripts/lib/resolve-model-rate.mjs` notes，以及插件侧 `model-map.json`。
