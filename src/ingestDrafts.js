// ヘッドレスClaude執筆フロー用: Claude が書いた data/_drafts.json を取り込み、
// slug採番・画像取得・重複排除・保存・サイト再生成までを決定的に行う。
// drafts の各要素: { headline, lead, body_markdown, tags[], section, source, link }
import { readFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { loadArticles, saveArticles, makeSlug, yyyymmdd, existingLinks, normalizeSectionTags } from './store.js';
import { fetchImage, imageKey } from './fetchImage.js';
import { fetchPressImage } from './pressImage.js';
import { renderSite } from './render.js';
import { evaluateArticle, appendEvaluation, writeRunSummary } from './evaluate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const draftsPath = path.join(ROOT, 'data', '_drafts.json');
const reviewPath = path.join(ROOT, 'data', '_review.json');

let drafts;
try {
  drafts = JSON.parse(await readFile(draftsPath, 'utf8'));
} catch {
  console.error(`✗ ${path.relative(ROOT, draftsPath)} が読めません。Claude が下書きを書き出したか確認してください。`);
  process.exit(1);
}
if (!Array.isArray(drafts)) { console.error('✗ _drafts.json は配列である必要があります。'); process.exit(1); }

// 別モデル judge の判定（data/_review.json）。あれば veto された下書きを破棄する。
// 形式: [{ link, verdict: 'pass'|'veto', scores?, overall?, critique?, suggestions? }, ...]
// judge が走らなかった/失敗した場合は単に存在しない → 客観ゲートのみで通常公開（日次を止めない）。
const reviewByLink = new Map();
if (existsSync(reviewPath)) {
  try {
    const review = JSON.parse(await readFile(reviewPath, 'utf8'));
    if (Array.isArray(review)) for (const r of review) { if (r?.link) reviewByLink.set(r.link, r); }
  } catch { console.error('  WARN: _review.json を解析できませんでした（judge 判定を無視して続行）'); }
}

const store = await loadArticles();
const seen = existingLinks(store);
const dateStr = yyyymmdd();
const created = [];
const createdReviews = []; // created[i] に対応する judge 判定（無ければ null）

// 既存記事で使用済みの画像キーを集めておく（重複回避）
const usedImages = new Set();
for (const a of store) { const k = imageKey(a.image); if (k) usedImages.add(k); }

for (const d of drafts) {
  if (!d?.headline || !d?.body_markdown || !d?.link) { console.error('  スキップ（必須欠落）'); continue; }
  if (seen.has(d.link)) { console.error(`  スキップ（重複）: ${d.link}`); continue; }
  // judge が veto した下書きは公開しない（「無理に書かない」原則と一致）。強い根拠時のみ veto される。
  const rv = reviewByLink.get(d.link);
  if (rv?.verdict === 'veto') {
    console.error(`  ✗ veto により破棄: ${d.headline}${rv.critique ? ` — ${rv.critique}` : ''}`);
    continue;
  }
  seen.add(d.link);
  const importance = Math.min(5, Math.max(1, Number(d.importance) || 3));
  // 画像はヒーロー候補となる重要記事(importance>=imageImportanceFloor)だけに付ける（取得・ページ重量の節約）。
  // 軽微な記事は image:null（表示テンプレは画像が無ければ何も出さない）。
  // ① 出典が公式ドメインなら og:image（報道用素材）を優先採用 → ② 無理なら stock 写真へフォールバック。
  let image = null;
  if (importance >= config.imageImportanceFloor) {
    image = await fetchPressImage({ ...d, importance }, usedImages);
    if (image) console.error(`  [press] 公式画像を採用: ${d.headline} — 提供: ${image.credit}`);
    else image = await fetchImage(d, created.length, usedImages);
  }
  // 旧カテゴリは navSections へ正規化（旧ラベルはタグへ退避）。新規の総合カテゴリは素通り。
  const { section, tags } = normalizeSectionTags(
    d.section || 'AI',
    Array.isArray(d.tags) ? d.tags.slice(0, 5) : [],
  );
  created.push({
    slug: makeSlug(store, dateStr, created.length),
    headline: String(d.headline).trim(),
    lead: String(d.lead || '').trim(),
    body_markdown: String(d.body_markdown).trim(),
    tags,
    section,
    source: d.source || '',
    link: d.link,
    importance,
    image_query: (d.image_query || '').trim(),
    image,
    mode: 'full',
    createdAt: new Date().toISOString(),
    // 出典の発行日時（候補の publishedAt を正規化）。並び・表示・鮮度の基準。
    // 不明なら null → render は createdAt にフォールバック（後方互換）。
    publishedAt: d.publishedAt ? new Date(d.publishedAt).toISOString() : null,
  });
  createdReviews.push(rv || null);
}

if (!created.length) {
  console.log('取り込む新規記事はありませんでした。');
} else {
  const all = [...created, ...store];
  await saveArticles(all);
  const stats = await renderSite(all);
  console.log(`✓ ${created.length} 件取り込み、計 ${stats.articles} 記事を出力。`);
  for (const a of created) console.log(`  + ${a.headline}`);

  // --- 評価を ledger に蓄積（=学習の記憶）---
  // 客観指標（決定的）＋ judge 判定（あれば）を合流して1記事1行で残す。
  try {
    const evalsForCreated = [];
    for (let i = 0; i < created.length; i++) {
      const a = created[i];
      const rv = createdReviews[i];
      const objective = evaluateArticle(a, store); // 母集団は取り込み前の既存記事
      evalsForCreated.push(objective);
      await appendEvaluation({
        ...objective,
        source: rv ? 'merged' : 'objective',
        ...(rv ? { scores: rv.scores, overall: rv.overall, critique: rv.critique, suggestions: rv.suggestions } : {}),
      });
    }
    await writeRunSummary(all, evalsForCreated);
  } catch (err) {
    console.error(`  WARN: 評価の記録に失敗しました（公開は完了済み）: ${err.message}`);
  }
}

// 一時ファイルを掃除（judge の _review.json も含む）
for (const f of [draftsPath, reviewPath, path.join(ROOT, 'data', '_candidates.json')]) {
  try { await unlink(f); } catch { /* noop */ }
}
