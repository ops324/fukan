// 公開前チェック（npm run check）。開発ルール（CLAUDE.md）を「実行可能」にするためのガード。
// 1) レンダー完走チェック … 一時ディレクトリへお試しレンダーし、全テンプレが壊れていないこと＋
//    主要生成物が出力されることを確認（作業ツリーは汚さない）。
// 2) スキーマ/不変条件チェック … articles.json の必須項目・importance範囲・slug/link一意を検証。
// 3) 秘密情報チェック … .env が git 管理外であること、.env の値がトラッキング対象に混入していないこと。
// いずれか失敗で非ゼロ終了。
import { mkdtemp, rm, readFile, access } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { loadArticles } from './store.js';
import { renderSite } from './render.js';
import { config } from './config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const fail = (msg) => fails.push(msg);

// --- 1) レンダー完走チェック（副作用なし：一時dirへ書く）---
async function checkRender(arts) {
  const dir = await mkdtemp(path.join(tmpdir(), 'axiom-check-'));
  try {
    await renderSite(arts, { outDir: dir });

    // 主要生成物が確かに出力されているか（テンプレ破壊の検知）
    const expected = [
      'index.html', 'sitemap.xml', 'robots.txt', 'feed.xml', 'feed.xsl',
      'search-index.json', path.join('tags', 'index.html'),
    ];
    if (arts.length > config.retentionTop) expected.push('archive.html');
    if (arts[0]?.slug) expected.push(path.join('articles', `${arts[0].slug}.html`));
    for (const { slug } of config.navSections) expected.push(path.join('sections', `${slug}.html`));

    for (const rel of expected) {
      try {
        await access(path.join(dir, rel));
      } catch {
        fail(`レンダー: 期待した生成物がありません → ${rel}`);
      }
    }
  } catch (err) {
    fail(`レンダーが例外で停止しました: ${err.message}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// --- 2) スキーマ/不変条件チェック ---
function checkSchema(arts) {
  if (!Array.isArray(arts)) { fail('articles.json が配列ではありません'); return; }
  const slugs = new Map();   // slug -> 件数
  const links = new Map();   // link -> 件数
  arts.forEach((a, i) => {
    const where = `articles[${i}]${a?.slug ? ` (${a.slug})` : ''}`;
    for (const key of ['slug', 'headline', 'body_markdown', 'link', 'createdAt']) {
      if (typeof a?.[key] !== 'string' || !a[key].trim()) fail(`${where}: 必須項目 ${key} が欠落/空です`);
    }
    // importance は任意（レガシー記事は欠落。render は欠落時 3 にフォールバック）。
    // 値が入っているときだけ 1-5 を検証する。
    if (a?.importance != null) {
      const imp = Number(a.importance);
      if (!Number.isFinite(imp) || imp < 1 || imp > 5) fail(`${where}: importance が 1-5 ではありません (${a.importance})`);
    }
    if (!Array.isArray(a?.tags)) fail(`${where}: tags が配列ではありません`);
    if (typeof a?.slug === 'string') slugs.set(a.slug, (slugs.get(a.slug) || 0) + 1);
    if (typeof a?.link === 'string') links.set(a.link, (links.get(a.link) || 0) + 1);
  });
  for (const [slug, n] of slugs) if (n > 1) fail(`slug が重複しています: ${slug}（${n}件）`);
  for (const [link, n] of links) if (n > 1) fail(`link が重複しています: ${link}（${n}件）`);
}

// --- 3) 秘密情報チェック ---
async function checkSecrets(arts) {
  // .env が git 管理下に入っていないか
  try {
    const tracked = execFileSync('git', ['ls-files', '.env'], { cwd: ROOT, encoding: 'utf8' }).trim();
    if (tracked) fail('.env が git にトラッキングされています（.gitignore を確認）');
  } catch { /* git 不在等は無視 */ }

  // .env の値がトラッキング対象に混入していないか。
  // ただし「設計上ページに埋め込まれる公開値」は除外する（誤検知防止）:
  //  - CF_BEACON_TOKEN … Cloudflare Web Analytics の公開ビーコン。全ページHTMLに出るのが正しい。
  //  - SITE_URL / IMAGE_PROVIDER … 公開URL・プロバイダ名（秘密ではない）。
  const PUBLIC_ENV_KEYS = new Set(['CF_BEACON_TOKEN', 'SITE_URL', 'IMAGE_PROVIDER']);
  const envPath = path.join(ROOT, '.env');
  if (!existsSync(envPath)) return;
  let secrets = []; // { key, value }
  try {
    const raw = await readFile(envPath, 'utf8');
    secrets = raw.split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => ({ key: l.slice(0, l.indexOf('=')).trim(), value: l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '') }))
      .filter(({ key, value }) => value.length >= 8 && !PUBLIC_ENV_KEYS.has(key)); // 短い値・公開値は対象外
  } catch { return; }

  for (const { key, value } of secrets) {
    try {
      // git grep は見つかると exit 0、無ければ exit 1（throw）。見つかったら漏洩。
      execFileSync('git', ['grep', '-F', '--', value], { cwd: ROOT, stdio: 'ignore' });
      fail(`.env の ${key} の値がトラッキング対象ファイルに混入しています（鍵の値が漏れています）`);
    } catch { /* 未検出＝正常 */ }
  }
}

// --- 実行 ---
const arts = await loadArticles();
await checkRender(arts);
checkSchema(arts);
await checkSecrets(arts);

if (fails.length) {
  console.error(`✗ check 失敗（${fails.length} 件）:`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ check 通過: ${arts.length} 記事・レンダー完走・スキーマOK・鍵混入なし`);
