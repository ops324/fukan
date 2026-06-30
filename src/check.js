// 公開前チェック（npm run check）。開発ルール（CLAUDE.md）を「実行可能」にするためのガード。
// 1) レンダー完走チェック … 一時ディレクトリへお試しレンダーし、全テンプレが壊れていないこと＋
//    主要生成物が出力されることを確認（作業ツリーは汚さない）。
// 1b) constitution 退行検査 … ロック対象の文言（署名等）が生成記事HTMLに残っているか。
// 2) スキーマ/不変条件チェック … articles.json の必須項目・importance範囲・slug/link一意を検証。
// 3) 秘密情報チェック … .env が git 管理外であること、.env の値がトラッキング対象に混入していないこと。
// 4) 客観品質チェック … 本文長/タグ数/重複話題など。これは「警告のみ」で exit には影響しない
//    （自己改善 MVP の床。決定的・オフライン・LLM/ネットワーク不使用）。
// 1〜3 のいずれか失敗で非ゼロ終了。4 は参考情報。
import { mkdtemp, rm, readFile, access } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { loadArticles } from './store.js';
import { renderSite } from './render.js';
import { config } from './config.js';
import { evaluateArticle } from './evaluate.js';
import { mdToHtml } from './markdown.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const fail = (msg) => fails.push(msg);
const warns = [];
const warn = (msg) => warns.push(msg);

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

    // --- 1b) constitution 退行検査 ---
    // ロック対象の文言（署名表記など）が実際の生成記事HTMLに残っているか。
    // 自己改善や不用意なリファクタで「決めたこと」が消える退行を公開前に止める。
    // 1記事だけだと取りこぼすため、先頭数件をサンプルして確認する。
    const sampleSlugs = arts.slice(0, 3).map((a) => a?.slug).filter(Boolean);
    if (sampleSlugs.length && Array.isArray(config.lockedDecisions) && config.lockedDecisions.length) {
      for (const slug of sampleSlugs) {
        try {
          const html = await readFile(path.join(dir, 'articles', `${slug}.html`), 'utf8');
          for (const phrase of config.lockedDecisions) {
            if (!html.includes(phrase)) fail(`constitution 退行: ロック文言が記事HTMLにありません → 「${phrase}」(${slug})`);
          }
        } catch {
          fail(`constitution 退行検査: サンプル記事HTMLを読めませんでした (${slug})`);
        }
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
    // publishedAt は任意（出典発行日時）。値があれば妥当な日時文字列であること。
    // 欠落時は render が createdAt にフォールバック（後方互換）。
    if (a?.publishedAt != null) {
      if (typeof a.publishedAt !== 'string' || Number.isNaN(Date.parse(a.publishedAt))) {
        fail(`${where}: publishedAt が妥当な日時文字列ではありません (${a.publishedAt})`);
      }
    }
    if (!Array.isArray(a?.tags)) fail(`${where}: tags が配列ではありません`);
    // 公式プレス画像（kind==='press'）は imageUrl とクレジット(credit)を必須にする。
    // 無断・無クレジットの公式画像掲載を公開前に止める（CLAUDE.md の権利配慮）。
    const img = a?.image;
    if (img && img.kind === 'press') {
      if (typeof img.imageUrl !== 'string' || !img.imageUrl.trim()) fail(`${where}: press画像に imageUrl がありません`);
      if (typeof img.credit !== 'string' || !img.credit.trim()) fail(`${where}: press画像はクレジット(credit)が必須です`);
    }
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

// --- 3b) サニタイザ退行検査（本文MarkdownのXSS無害化）---
// 実データの本文はクリーンで素通り検知できないため、既知の悪性入力を mdToHtml に通し、
// 生HTML・危険プロトコルが無害化されることを決定的に確認する（オフライン・ネットワーク不使用）。
function checkSanitizer() {
  const malicious = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '[x](javascript:alert(1))',
    '![y](data:text/html,abc)',
    '<a href="vbscript:msgbox(1)">z</a>',
  ].join('\n\n');
  let html = '';
  try {
    html = mdToHtml(malicious);
  } catch (err) {
    fail(`サニタイザ検査: mdToHtml が例外で停止しました: ${err.message}`);
    return;
  }
  // 生HTMLはエスケープされ「&lt;…&gt;」のテキストになる（=無害）。危険なのは“実タグ”として
  // 出力された場合のみなので、判定は実タグ（リテラルな < で始まる）内に限定する。
  const lower = html.toLowerCase();
  if (lower.includes('<script')) fail('サニタイザ退行: 生の <script> が本文HTMLに出力されています');
  if (/<[^>]*\son\w+\s*=/.test(lower)) fail('サニタイザ退行: イベントハンドラ属性（on*=）が実タグに残っています');
  for (const proto of ['javascript:', 'data:', 'vbscript:']) {
    if (lower.includes(`href="${proto}`) || lower.includes(`src="${proto}`)) {
      fail(`サニタイザ退行: 危険プロトコル ${proto} が href/src に残っています`);
    }
  }
}

// --- 4) 客観品質チェック（警告のみ・exit に影響しない）---
// しきい値（config.qualityThresholds）は「床」であって最大化目標ではない。
// hard-fail は 2) スキーマ側に任せ、ここは編集の気づき用に warn を出すだけ。
function checkQuality(arts) {
  arts.forEach((a, i) => {
    const recent = arts.slice(i + 1); // この記事より古い記事を母集団に
    const { flags } = evaluateArticle(a, recent);
    for (const f of flags) warn(`${a.slug}: ${f}`);
  });
}

// --- 実行 ---
let arts;
try {
  arts = await loadArticles();
} catch (e) {
  // 破損 articles.json は loadArticles が throw する。空配列で素通りさせず check を赤にする。
  console.error(`✗ check 失敗（1 件）:\n  - ${e.message}`);
  process.exit(1);
}
await checkRender(arts);
checkSchema(arts);
checkSanitizer();
await checkSecrets(arts);
checkQuality(arts);

if (warns.length) {
  console.warn(`⚠ 品質警告（${warns.length} 件・公開はブロックしません）:`);
  for (const w of warns) console.warn(`  - ${w}`);
}

if (fails.length) {
  console.error(`✗ check 失敗（${fails.length} 件）:`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ check 通過: ${arts.length} 記事・レンダー完走・スキーマOK・サニタイザOK・鍵混入なし・constitution 維持`);
