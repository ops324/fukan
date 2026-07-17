// 既存記事のサムネを「ブランド不一致」の観点で点検し、他社ロゴ/UI が写った写真を差し替える。
// 例: Anthropic の記事に OpenAI ロゴの 3D レンダが付いている状態を検出して直す。
//
// 判定は imageBrands（①写真の alt テキスト ②ブランド写真の索引 data/brand-photos.json）で行う。
// 索引はスラッグ照合なので、点検そのものは API を使わない。API を使うのは差し替えの取得だけ。
// → 先に `npm run refresh-brand-photos` で索引を作っておくこと。
//
// 使い方:
//   npm run recheck-images            # 点検のみ（dry-run・書き込まない）
//   npm run recheck-images -- --apply # 不一致を差し替えて保存＋再生成
//   npm run recheck-images -- --apply --limit 20   # 差し替え件数の上限（API レート制限対策）
import { loadArticles, saveArticles } from './store.js';
import { fetchImage, imageKey } from './fetchImage.js';
import { articleBrands, photoBrands } from './imageBrands.js';
import { renderSite } from './render.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const limitArg = args.indexOf('--limit');
const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : 40;

const arts = await loadArticles();
const used = new Set();
for (const a of arts) { const k = imageKey(a.image); if (k) used.add(k); }

// 不一致の検出（API 不要）。公式プレス画像は報道対象そのものの写真なので対象外。
const bad = [];
for (const a of arts) {
  if (!a.image?.imageUrl || a.image.kind === 'press') continue;
  const allowed = articleBrands(a);
  const shown = [...photoBrands(a.image)].filter((k) => !allowed.has(k));
  if (shown.length) bad.push({ a, allowed, shown });
}

// 新しい記事から直す（トップ/セクションに出ている＝読者の目に触れる写真を先に直す）。
bad.sort((x, y) => new Date(y.a.publishedAt || y.a.createdAt) - new Date(x.a.publishedAt || x.a.createdAt));

console.log(`全 ${arts.length} 記事を点検 → ブランド不一致 ${bad.length} 件${apply ? `（最大 ${limit} 件を差し替え）` : '（dry-run）'}\n`);
for (const { a, allowed, shown } of bad) {
  console.log(`  ✗ ${a.headline}`);
  console.log(`      写真に ${shown.join('/')} が写り込み（記事=${[...allowed].join('/') || 'ブランド非依存'}）`);
}

let replaced = 0;
if (apply) {
  for (const { a } of bad.slice(0, limit)) {
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
      console.log(`\n※ ${err.message} により打ち切り。時間を空けて再実行してください。`);
      break;
    }
    // 適合写真ゼロなら fetchImage は抽象サムネ（{fallbackThumb}）を返す＝誤った写真より安全。
    a.image = img;
    replaced++;
    console.log(`  → 差し替え: ${a.headline} … ${img.imageUrl ? `「${img.alt}」` : '適合写真なし。抽象サムネへ'}`);
  }
  await saveArticles(arts);
  const stats = await renderSite(arts);
  console.log(`\n✓ ${replaced} 件を差し替え、計 ${stats.articles} 記事を再生成しました。`);
} else if (bad.length) {
  console.log('\n※ dry-run。差し替えるには --apply を付けて再実行。');
}
