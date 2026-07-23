// Phase 4: LLM 画像一致チェックの結果（data/_image_review.json）を適用する。
// auto-generate.sh が ingest 後に judge モデルで画像査読を走らせ、その verdict をここで反映する。
//
// フロー: ingestDrafts が _image_review_targets.json（境界スコアの新規画像）を書く
//   → prompts/review-images.md（judge モデル）が各画像 verdict を _image_review.json に書く
//   → 本スクリプトが verdict==='swap' の記事だけ画像を再取得し、保存＋再生成する。
//
// 設計原則（judge と同じ）: 失敗しても公開は止めない。ターゲット/結果ファイルは処理後に必ず消す
//   （残すと auto-generate.sh の git add -A に拾われ配信モデルを汚す）。
import { readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadArticles, saveArticles } from './store.js';
import { fetchImage, imageKey } from './fetchImage.js';
import { renderSite } from './render.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targetsPath = path.join(ROOT, 'data', '_image_review_targets.json');
const reviewPath = path.join(ROOT, 'data', '_image_review.json');

const cleanup = async () => {
  for (const f of [targetsPath, reviewPath]) { try { await unlink(f); } catch { /* noop */ } }
};

let review;
try {
  review = JSON.parse(await readFile(reviewPath, 'utf8'));
} catch {
  // 査読結果が無い（LLM 査読が走らなかった/失敗した）＝何もしないで残骸だけ掃除。公開は止めない。
  await cleanup();
  process.exit(0);
}

const swaps = new Set(
  (Array.isArray(review) ? review : [])
    .filter((r) => r?.verdict === 'swap' && r?.slug)
    .map((r) => r.slug),
);
if (!swaps.size) {
  console.log('画像査読: swap 対象なし。');
  await cleanup();
  process.exit(0);
}

const arts = await loadArticles();
const used = new Set();
for (const a of arts) { const k = imageKey(a.image); if (k) used.add(k); }

let replaced = 0;
for (const a of arts) {
  if (!swaps.has(a.slug) || a.image?.kind === 'press') continue;
  const k = imageKey(a.image);
  const before = a.image;
  if (k) used.delete(k); // 差し替え前の写真は解放
  let img;
  try {
    // strict: 制限中の「取得0」で既存写真を抽象サムネに潰さない。
    img = await fetchImage(a, arts.indexOf(a), used, { strict: true });
  } catch (err) {
    a.image = before;
    if (k) used.add(k);
    console.log(`※ ${err.message} により打ち切り。残りは次回に持ち越します。`);
    break;
  }
  a.image = img;
  replaced++;
  console.log(`  → 差し替え: ${a.headline} … ${img.imageUrl ? `「${img.alt}」` : '適合写真なし。抽象サムネへ'}`);
}

if (replaced) {
  await saveArticles(arts);
  const stats = await renderSite(arts);
  console.log(`✓ 画像査読: ${replaced} 件を差し替え、計 ${stats.articles} 記事を再生成しました。`);
} else {
  console.log('画像査読: 差し替えは発生しませんでした。');
}
await cleanup();
