#!/usr/bin/env node
/**
 * 抓取 Cursor 计费相关公开页面到 docs/billing/，便于离线对照与版本差异。
 * 实际计费以官网与合同为准；请定期重新运行以同步官方变更。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'docs', 'billing');

const TARGETS = [
  {
    file: 'models-and-pricing.md',
    url: 'https://cursor.com/docs/models-and-pricing',
    title: 'Models & Pricing (docs)',
  },
  {
    file: 'pricing-policy.md',
    url: 'https://cursor.com/terms/pricing',
    title: 'Pricing Policy (terms)',
  },
  {
    file: 'pricing-landing.md',
    url: 'https://cursor.com/pricing',
    title: 'Pricing landing',
  },
  {
    file: 'model-cursor-composer-2.md',
    url: 'https://cursor.com/docs/models/cursor-composer-2',
    title: 'Model: Cursor Composer 2',
  },
];

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'cursor-usage-analysis/fetch-billing (local tool)',
      Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
    },
  });
  const ct = res.headers.get('content-type') || '';
  const buf = Buffer.from(await res.arrayBuffer());
  const text = buf.toString('utf8');
  return { ok: res.ok, status: res.status, contentType: ct, text, url: res.url };
}

function wrapMeta(meta, body) {
  return `---
fetchedAt: ${meta.fetchedAt}
sourceUrl: ${meta.sourceUrl}
title: ${meta.title}
httpStatus: ${meta.httpStatus}
contentType: ${meta.contentType}
---

> 本文件由 scripts/fetch-billing-docs.mjs 自动生成，请勿手改后当「权威」；以 sourceUrl 现行页面为准。

${body}
`;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const fetchedAt = new Date().toISOString();
  const indexLines = [`# 计费文档快照`, ``, `- 抓取时间（UTC）：${fetchedAt}`, ``];

  for (const t of TARGETS) {
    process.stdout.write(`GET ${t.url} … `);
    const r = await fetchText(t.url);
    const statusLine = r.ok ? 'ok' : `HTTP ${r.status}`;
    console.log(statusLine);

    const body =
      r.text.length > 120_000
        ? `${r.text.slice(0, 120_000)}\n\n<!-- truncated: original ${r.text.length} chars -->\n`
        : r.text;

    const md = wrapMeta(
      {
        fetchedAt,
        sourceUrl: r.url,
        title: t.title,
        httpStatus: r.status,
        contentType: r.contentType,
      },
      r.contentType.includes('html')
        ? `以下为原始 HTML（可作全文检索）。若需可读版请直接打开官网。\n\n\`\`\`html\n${body}\n\`\`\`\n`
        : body,
    );

    const outPath = join(OUT_DIR, t.file);
    await writeFile(outPath, md, 'utf8');
    indexLines.push(`- [${t.title}](${t.url}) → \`${t.file}\` (${statusLine})`);
  }

  await writeFile(join(OUT_DIR, 'INDEX.md'), `${indexLines.join('\n')}\n`, 'utf8');
  console.log(`\n已写入: ${OUT_DIR}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
