// 既存記事のサムネを「記事内容との関連度」の観点で点検し、内容と噛み合わない写真を差し替える。
// 例: ロケット打ち上げの記事に「ノートPCを囲む人々」の無関係な写真が付いている状態を検出して直す。
//
// 判定は fetchImage の relevanceScore（写真の説明文 × 記事キーワード）で行い、API を使わない。
// API を使うのは差し替えの取得だけ。ブランド不一致（recheck-images）とは別軸の点検。
//
// 制約（重要）: 保存済み画像は alt のみ保持し description は破棄済み（fetchImage が保存前に剥がす）。
//   よって遡及スコアは alt のみの近似（取り込み時の live 取得は alt+description で採点でき精度が高い）。
//   しきい値は config.imageRelevance.recheckMinScore（取り込み時 minScore とは別。既定 1）。
//
// 使い方:
//   npm run recheck-image-relevance             # 点検のみ（dry-run・書き込まない）
//   npm run recheck-image-relevance -- --apply  # 低関連度を差し替えて保存＋再生成
//   npm run recheck-image-relevance -- --apply --limit 20   # 差し替え件数の上限（API レート制限対策）
import { loadArticles, saveArticles } from './store.js';
import { config } from './config.js';
import { fetchImage, imageKey, articleImageTokens, relevanceScore } from './fetchImage.js';
import { renderSite } from './render.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const limitArg = args.indexOf('--limit');
const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : 40;
const threshold = config.imageRelevance.recheckMinScore;

const arts = await loadArticles();
const used = new Set();
for (const a of arts) { const k = imageKey(a.image); if (k) used.add(k); }

// 低関連度の検出（API 不要）。公式プレス画像は報道対象そのものの写真なので対象外。
// 抽象サムネ（fallbackThumb）は実写でないため対象外（元々「適合写真なし」の結果）。
// alt 空の画像は採点材料が無く score=0 になるが、これは「ミスマッチ」ではなく「メタデータ欠落」。
// 内容の妥当性を判定できないため mismatch には数えず、別枠でカウントだけする（誤って一括差し替えしない）。
const bad = [];
let noText = 0;
for (const a of arts) {
  if (!a.image?.imageUrl || a.image.kind === 'press') continue;
  // 採点材料は alt＋description（新しい記事は description も保存。レガシーは alt のみ or どちらも無し）。
  const alt = (a.image.alt || '').trim();
  const description = (a.image.description || '').trim();
  if (!alt && !description) { noText++; continue; } // 説明文が全く無い＝判定不能（メタデータ欠落）
  const score = relevanceScore({ alt, description }, articleImageTokens(a));
  if (score < threshold) bad.push({ a, score });
}

// 新しい記事から直す（トップ/セクションに出ている＝読者の目に触れる写真を先に直す）。
bad.sort((x, y) => new Date(y.a.publishedAt || y.a.createdAt) - new Date(x.a.publishedAt || x.a.createdAt));

console.log(`全 ${arts.length} 記事を点検 → 関連度 ${threshold} 未満 ${bad.length} 件 / 説明文なしで判定不能 ${noText} 件${apply ? `（最大 ${limit} 件を差し替え）` : '（dry-run）'}\n`);
for (const { a, score } of bad) {
  console.log(`  ✗ ${a.headline}`);
  console.log(`      score=${score} query="${a.image_query || '-'}" alt="${a.image.alt || '(alt無し)'}"`);
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
