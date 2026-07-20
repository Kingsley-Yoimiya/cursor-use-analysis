/**
 * 公开示例插件：写出一份假的平行数据源 summary，用于验证 Plugin Host。
 */
import fs from 'fs';
import path from 'path';

function writeSummary(ctx) {
  const outPath = path.join(ctx.paths.reports, 'example-source-summary.json');
  fs.mkdirSync(ctx.paths.reports, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const payload = {
    schemaVersion: 1,
    id: 'example-source',
    title: 'Example Parallel Source',
    generatedAt: new Date().toISOString(),
    disclaimer:
      '这是公开仓自带的示例数据，不是真实用量。用于验证插件 Tab / API。',
    totals: {
      requests: 3,
      ok: 3,
      input_tokens: 1200,
      output_tokens: 800,
      cache_read_tokens: 5000,
      cache_creation_tokens: 1500,
      total_tokens: 8500,
    },
    byDay: [
      {
        date: today,
        requests: 3,
        ok: 3,
        input_tokens: 1200,
        output_tokens: 800,
        cache_read_tokens: 5000,
        cache_creation_tokens: 1500,
        total_tokens: 8500,
      },
    ],
    byModel: [
      {
        model: 'example-model-a',
        requests: 2,
        input_tokens: 900,
        output_tokens: 600,
        cache_read_tokens: 4000,
        cache_creation_tokens: 1000,
        total_tokens: 6500,
      },
      {
        model: 'example-model-b',
        requests: 1,
        input_tokens: 300,
        output_tokens: 200,
        cache_read_tokens: 1000,
        cache_creation_tokens: 500,
        total_tokens: 2000,
      },
    ],
    meta: { source: 'plugins/example-source' },
  };
  fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  ctx.log('info', `已写入 ${outPath}`);
  return { path: outPath };
}

export async function syncStep(ctx) {
  return writeSummary(ctx);
}

export async function register(_app, ctx) {
  ctx.log('info', 'example-source 已注册（无额外路由）');
}
