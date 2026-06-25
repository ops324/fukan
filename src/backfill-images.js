// 既存記事の画像を整える: ①実写真が無い記事に付与、②他記事と画像が重複している記事を
// ユニークな写真に差し替える。前提: .env に UNSPLASH_KEY か PEXELS_KEY を設定済み。
// 使い方: npm run backfill-images
import { config } from './config.js';
import { loadArticles, saveArticles } from './store.js';
import { fetchImage, imageKey } from './fetchImage.js';
import { renderSite } from './render.js';

const arts = await loadArticles();
let updated = 0;
const usedImages = new Set();

for (let i = 0; i < arts.length; i++) {
  const a = arts[i];
  const k = imageKey(a.image);

  // 公式プレス画像（手動登録）は自動上書きしない。使用済みキーには登録して他記事の重複を防ぐ。
  if (a.image?.kind === 'press') {
    if (k) usedImages.add(k);
    continue;
  }

  // 画像はヒーロー候補となる重要記事だけに付ける方針（imageImportanceFloor）。
  // これ未満の記事には画像を付与しない（再付与もしない）。既存キーは重複回避のため登録だけする。
  if ((Number(a.importance) || 3) < config.imageImportanceFloor) {
    if (k) usedImages.add(k);
    continue;
  }

  // 既にユニークな実写真がある → そのまま使用済み登録
  if (a.image?.imageUrl && k && !usedImages.has(k)) {
    usedImages.add(k);
    continue;
  }

  // 画像が無い、または他記事と重複 → ユニークな写真を取得
  const reason = a.image?.imageUrl ? '重複差し替え' : '新規付与';
  const img = await fetchImage(a, i, usedImages);
  if (img?.imageUrl) {
    a.image = img;
    updated++;
    console.log(`  + [${reason}] ${a.headline} → ${img.provider} / ${img.photographer}`);
  }
}

if (updated > 0) {
  await saveArticles(arts);
  const stats = await renderSite(arts);
  console.log(`\n✓ ${updated} 件の画像を更新し、計 ${stats.articles} 記事を再生成しました。`);
} else {
  console.log('更新する画像はありませんでした（全記事ユニーク、またはキー未設定/ヒット0）。');
}
