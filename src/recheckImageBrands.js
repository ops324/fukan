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
let unchanged = 0;
const stillBad = []; // 差し替えたのに、まだ他社ブランドが写り込んでいるもの
if (apply) {
  for (const { a, allowed } of bad.slice(0, limit)) {
    const k = imageKey(a.image);
    const before = a.image;
    // 差し替え対象の写真は used に**残したまま**取得する。先に解放すると、
    // いま不一致と判定したその写真が再び選び直され、中身が変わっていないのに
    // 「差し替えました」と報告される（recheck-image-relevance と同型の不具合）。
    let img;
    try {
      // strict: 制限中の「取得0」で既存写真を抽象サムネに潰さない。
      img = await fetchImage(a, arts.indexOf(a), used, { strict: true });
    } catch (err) {
      a.image = before;
      console.log(`\n※ ${err.message} により打ち切り。時間を空けて再実行してください。`);
      break;
    }
    const nk = imageKey(img);
    if (k && nk === k) {
      unchanged++;
      console.log(`  → 変化なし: ${a.headline}（同じ写真が再選択されました）`);
      continue;
    }
    if (k) used.delete(k); // 別の写真に替わったので旧キーを解放
    if (nk) used.add(nk);
    // 適合写真ゼロなら fetchImage は抽象サムネ（{fallbackThumb}）を返す＝誤った写真より安全。
    a.image = img;
    replaced++;

    // 差し替えた結果を**同じ判定器で検査し直す**。別の他社ブランドが写った写真に
    // 替わっただけでは直っていない。ここを見ないと、点検して直したつもりのまま
    // 不適合が残り続ける。
    const shownNow = img.imageUrl ? [...photoBrands(img)].filter((x) => !allowed.has(x)) : [];
    if (shownNow.length) {
      stillBad.push({ a, shown: shownNow });
      console.log(`  → 差し替えたが依然としてブランド不一致: ${a.headline} … ${shownNow.join('/')} が写り込み`);
    } else {
      console.log(`  → 差し替え: ${a.headline} … ${img.imageUrl ? `「${img.alt}」` : '適合写真なし。抽象サムネへ'}`);
    }
  }
  if (replaced) {
    // ingestDrafts と同じ規律でレンダーが先・保存が後（描画できないデータを残さない）。
    const stats = await renderSite(arts);
    await saveArticles(arts);
    console.log(`\n✓ ${replaced} 件を差し替え（解消 ${replaced - stillBad.length} / 依然として不一致 ${stillBad.length}）`
      + `${unchanged ? ` / 変化なし ${unchanged}` : ''}、計 ${stats.articles} 記事を再生成しました。`);
  } else {
    console.log(`\n差し替えは発生しませんでした（変化なし ${unchanged} 件）。保存・再生成は行いません。`);
  }
  if (stillBad.length) {
    console.log(`\n⚠ ${stillBad.length} 件は差し替え後も他社ブランドが写り込んだままです:`);
    for (const { a, shown } of stillBad) console.log(`  - ${a.slug} ${shown.join('/')} … ${a.headline}`);
  }
} else if (bad.length) {
  console.log('\n※ dry-run。差し替えるには --apply を付けて再実行。');
}
