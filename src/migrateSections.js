// 一括移行（冪等・何度でも実行可）: 既存 articles.json の旧カテゴリ section を
// config.sectionAliases で navSections へ正規化し、旧ラベルをタグへ退避する。
// あわせて全記事のタグを tagSlug で整形するため（store.js の normalizeSectionTags）、
// パスに使えない文字を持つ既存タグの一括バックフィルにもなる。
//
// **既定は dry-run**。全記事を1回の保存で書き換える唯一の一括変更系なので、
// 他の一括系（recheck-images / recheck-image-relevance / seed-veto-ledger）と揃えて
// 「見てから適用する」を既定にする。取り消しは `git checkout -- data/articles.json` しかなく、
// それはその回の自動ジョブが取り込んだ未コミットの記事も一緒に捨ててしまう。
//
// タグ名が変わると **URL も変わる**（dist/tags/<tagSlug(tag)>.html・canonical・sitemap）。
// このリポジトリにリダイレクト機構は無いため、消えるタグ URL は外部リンクが 404 になる。
// dry-run はそれを事前に一覧で出す。
//
// 実行: npm run migrate-sections            # 点検のみ
//       npm run migrate-sections -- --apply # 適用（→ 続けて npm run render）
import { loadArticles, saveArticles, normalizeSectionTags } from './store.js';
import { tagSlug } from './tagSlug.js';

const apply = process.argv.slice(2).includes('--apply');

const articles = await loadArticles();
let changed = 0;
let tagsChanged = 0;
const tagDiffs = []; // { slug, before[], after[] }
const out = articles.map((a) => {
  const before = Array.isArray(a.tags) ? a.tags : [];
  const { section, tags } = normalizeSectionTags(a.section || 'AI', before);
  if (section !== a.section) changed += 1;
  // section が動かなくてもタグだけ変わることがある（正規化はエイリアス有無に関わらず走る）。
  // ここを数えないと「0/1052 件を更新」と表示しながら全記事のタグを書き換えてしまう。
  if (JSON.stringify(tags) !== JSON.stringify(before)) {
    tagsChanged += 1;
    tagDiffs.push({ slug: a.slug, before, after: tags });
  }
  return { ...a, section, tags };
});

// 消えるタグページ URL を出す。タグ集合の差分から求める（記事単位ではなくサイト全体で見る）。
const urlsOf = (arts) => new Set(arts.flatMap((a) => (a.tags || []).map((t) => `${tagSlug(t)}.html`)));
const beforeUrls = urlsOf(articles);
const afterUrls = urlsOf(out);
const goneUrls = [...beforeUrls].filter((u) => !afterUrls.has(u)).sort();

const by = {};
for (const a of out) by[a.section] = (by[a.section] || 0) + 1;

console.log(`section を正規化: ${changed}/${out.length} 件${apply ? '' : '（dry-run）'}`);
console.log(`タグを整形: ${tagsChanged}/${out.length} 件`);
if (tagDiffs.length) {
  console.log('\n  タグが変わる記事（先頭20件）:');
  for (const d of tagDiffs.slice(0, 20)) {
    console.log(`   ${d.slug}  [${d.before.join(', ')}] → [${d.after.join(', ')}]`);
  }
  if (tagDiffs.length > 20) console.log(`   … ほか ${tagDiffs.length - 20} 件`);
}
if (goneUrls.length) {
  console.log(`\n  ⚠ 消えるタグページ ${goneUrls.length} 件（リダイレクトは無いので外部リンクは 404 になります）:`);
  for (const u of goneUrls.slice(0, 30)) console.log(`   /tags/${u}`);
  if (goneUrls.length > 30) console.log(`   … ほか ${goneUrls.length - 30} 件`);
}
console.log('\n  正規化後の内訳:', Object.entries(by).sort((p, q) => q[1] - p[1]).map(([s, n]) => `${s}=${n}`).join(' / '));

if (!apply) {
  console.log('\n※ dry-run。適用するには --apply を付けて再実行してください。');
  process.exit(0);
}
if (!changed && !tagsChanged) {
  console.log('\n変更はありません。保存しません。');
  process.exit(0);
}

await saveArticles(out);
console.log('\n✓ 保存しました。次に `npm run render` で全 HTML を再生成してください。');
