// ヘッドレスClaude執筆フロー用: Claude が書いた data/_drafts.json を取り込み、
// slug採番・画像取得・重複排除・保存・サイト再生成までを決定的に行う。
// drafts の各要素: { headline, lead, body_markdown, tags[], section, source, link }
import { readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadArticles, saveArticles, makeSlug, yyyymmdd, existingLinks } from './store.js';
import { fetchImage, imageKey } from './fetchImage.js';
import { renderSite } from './render.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const draftsPath = path.join(ROOT, 'data', '_drafts.json');

let drafts;
try {
  drafts = JSON.parse(await readFile(draftsPath, 'utf8'));
} catch {
  console.error(`✗ ${path.relative(ROOT, draftsPath)} が読めません。Claude が下書きを書き出したか確認してください。`);
  process.exit(1);
}
if (!Array.isArray(drafts)) { console.error('✗ _drafts.json は配列である必要があります。'); process.exit(1); }

const store = await loadArticles();
const seen = existingLinks(store);
const dateStr = yyyymmdd();
const created = [];

// 既存記事で使用済みの画像キーを集めておく（重複回避）
const usedImages = new Set();
for (const a of store) { const k = imageKey(a.image); if (k) usedImages.add(k); }

for (const d of drafts) {
  if (!d?.headline || !d?.body_markdown || !d?.link) { console.error('  スキップ（必須欠落）'); continue; }
  if (seen.has(d.link)) { console.error(`  スキップ（重複）: ${d.link}`); continue; }
  seen.add(d.link);
  const image = await fetchImage(d, created.length, usedImages);
  created.push({
    slug: makeSlug(store, dateStr, created.length),
    headline: String(d.headline).trim(),
    lead: String(d.lead || '').trim(),
    body_markdown: String(d.body_markdown).trim(),
    tags: Array.isArray(d.tags) ? d.tags.slice(0, 5) : [],
    section: d.section || 'AI',
    source: d.source || '',
    link: d.link,
    importance: Math.min(5, Math.max(1, Number(d.importance) || 3)),
    image_query: (d.image_query || '').trim(),
    image,
    mode: 'full',
    createdAt: new Date().toISOString(),
  });
}

if (!created.length) {
  console.log('取り込む新規記事はありませんでした。');
} else {
  const all = [...created, ...store];
  await saveArticles(all);
  const stats = await renderSite(all);
  console.log(`✓ ${created.length} 件取り込み、計 ${stats.articles} 記事を出力。`);
  for (const a of created) console.log(`  + ${a.headline}`);
}

// 一時ファイルを掃除
for (const f of [draftsPath, path.join(ROOT, 'data', '_candidates.json')]) {
  try { await unlink(f); } catch { /* noop */ }
}
