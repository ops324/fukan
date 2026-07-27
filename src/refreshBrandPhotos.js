// ブランド写真の索引（data/brand-photos.json）を作る。
// 各ブランド名でストック写真を検索し、上位に出る写真のスラッグを「そのブランドが写った写真」として
// 記録する。fetchImage はこの索引を使い、記事が扱っていないブランドの写真を候補から捨てる。
//
// なぜ alt では足りないか: alt は自動生成で、OpenAI ロゴの 3D レンダですら「ball of string」になる。
// 「そのブランド名で検索すると上位に出る」方が、ロゴ/UI の写り込みの信号として強い。
//
// 索引は既存へ**マージ**する（写真とブランドの対応は後から変わらないので、足すだけでよい）。
// Unsplash デモキーは 50req/時のため 1 回で全ブランドを回れないことがある。制限に当たったら
// そこまでの成果を保存して終了する → 時間を空けて何度か実行すれば索引が育つ。
//
// 使い方: npm run refresh-brand-photos
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { searchCandidates } from './fetchImage.js';
import { brandQueries, photoSlug } from './imageBrands.js';
import { atomicWrite } from './atomicWrite.js';

const indexPath = fileURLToPath(new URL('../data/brand-photos.json', import.meta.url));
const indexLabel = 'data/brand-photos.json';

let slugs = {};
let done = [];
// 「ファイルが無い＝初回」と「壊れている＝異常」を区別する（store.js の loadArticles と同じ規律）。
// 一緒くたに catch すると、破損時に索引を空から作り直し → レート制限で途中終了 → その部分索引で
// **上書き**して、レート制限的に作り直しが高価な 1,700 件超の対応付けを静かに失う。
if (existsSync(indexPath)) {
  let raw;
  try {
    raw = await readFile(indexPath, 'utf8');
  } catch (e) {
    console.error(`✗ ${indexLabel} を読み込めません: ${e.message}`);
    process.exit(1);
  }
  let prev;
  try {
    prev = JSON.parse(raw);
  } catch (e) {
    console.error(`✗ ${indexLabel} が壊れています（JSON として読めません）: ${e.message}`);
    console.error('  空から作り直すと既存の索引を失います。git で復元するか、意図的に作り直すならファイルを削除してください:');
    console.error(`    git checkout -- ${indexLabel}`);
    process.exit(1);
  }
  slugs = prev.slugs || {};
  done = prev.doneQueries || [];
  console.log(`既存の索引: ${Object.keys(slugs).length} 件 / 済み検索語 ${done.length} 個\n`);
}

async function save() {
  const out = { generatedAt: new Date().toISOString(), doneQueries: done, slugs };
  // 途中終了でも索引が半端な状態で残らないよう原子的に置き換える。
  await atomicWrite(indexPath, `${JSON.stringify(out, null, 2)}\n`);
}

const pending = brandQueries.flatMap(({ key, queries }) =>
  queries.filter((q) => !done.includes(q)).map((q) => ({ key, q })));

if (!pending.length) {
  console.log('全ての検索語が済み。索引を作り直すには data/brand-photos.json を消してから再実行。');
  process.exit(0);
}

for (const { key, q } of pending) {
  let cands;
  try {
    cands = await searchCandidates(q);
  } catch (err) {
    await save(); // ここまでの成果は残す（索引は足すだけなので部分保存でも壊れない）
    console.error(`\n※ ${err.message} により中断。索引 ${Object.keys(slugs).length} 件を保存しました。`);
    console.error(`  残り ${pending.length - done.filter((d) => pending.some((p) => p.q === d)).length} 語。時間を空けて再実行すると続きから進みます。`);
    process.exit(1);
  }
  let added = 0;
  for (const c of cands) {
    const s = photoSlug(c);
    // 先勝ち: 複数ブランドで引っかかる写真は最初のブランドに寄せる（どちらにせよ他社記事では弾く）。
    if (s && !slugs[s]) { slugs[s] = key; added++; }
  }
  done.push(q);
  console.log(`  ${key} / "${q}" → ${cands.length} 件中 ${added} 件を索引化`);
}

await save();
console.log(`\n✓ 索引 ${Object.keys(slugs).length} 件（検索語 ${done.length} 個ぶん）を保存しました。`);
