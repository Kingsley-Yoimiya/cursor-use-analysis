# 可选本地扩展

Dashboard 支持从本机路径加载可选扩展（默认关闭）。未配置时界面与行为与单数据源版本一致。

```bash
cp config/plugins.example.json config/plugins.local.json
```

`config/plugins.local.json` 已被 gitignore。  
契约与示例见 `plugins/example-source/` 及 `dashboard/server/plugin-host.js`。
