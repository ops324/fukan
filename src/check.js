// 公開前チェック（npm run check）。開発ルール（CLAUDE.md）を「実行可能」にするためのガード。
// 1) レンダー完走チェック … 一時ディレクトリへお試しレンダーし、全テンプレが壊れていないこと＋
//    主要生成物が出力されることを確認（作業ツリーは汚さない）。あわせて assets/ の実在も見る
//    （renderSite は assets を複製せず build.js が cpSync するため、ここが check の唯一の死角）。
// 1b) constitution 退行検査 … ロック対象の文言（署名等）が生成記事HTMLに残っているか。
// 2) スキーマ/不変条件チェック … articles.json の必須項目・importance範囲・slug の形式/一意・link一意を検証。
// 3) 秘密情報チェック … .env が git 管理外であること、.env の値がトラッキング対象に混入していないこと。
// 3b) サニタイザ退行検査 … 既知の悪性入力を mdToHtml に通し、生HTML・危険プロトコルが無害化されるか。
// 3c) 下書きリント退行検査 … 既知の事故形（別記事からの混入・比率の食い違い等）を合成入力で通し、
//    src/lintDrafts.js が今も検出できることを確認する（writer の検算が空回りする退行を止める）。
// 3d) タグ slug 検査 … tagSlug() の変換退行・変換後の衝突（hard-fail）・実データの危険文字（warn）。
// 3e) タグ→パス配線の退行検査 … 危険文字を含む合成タグを実際に描画し、書き出し名・tagHref・
//    canonical・sitemap の4経路が tagSlug を通っているかを突き合わせる。実データは取り込み時に
//    正規化済みで tagSlug の不動点になるため、実データを描画しても配線の外れを検知できない。
// 3f) judge 判定ガードの退行検査 … 壊れた _review.json を合成して、判定器・CLI の終了コード・
//    配線（ガードと消費側が同じモジュールを通っているか）を検証する。ここが「ファイルの存在」
//    だけを見ていたため、2026-11-04 は壊れた判定が素通りして veto 3本が取り込まれた。
// 3g) 長期トークン認証の退行検査 … .env の CLAUDE_CODE_OAUTH_TOKEN の読み取りを実際に zsh で
//    走らせ（書式ごとの取り落ちは正常な .env では顕れない）、.env を source していないこと・
//    トークンをログへ出さないこと・失効トークンからセッションへ退避する経路が残っていることを見る。
//    環境変数はキーチェーンより優先されるため、退避が消えると「古いトークンを置くと公開が止まる」。
// 4) 客観品質チェック … 本文長/タグ数/重複話題など。これは「警告のみ」で exit には影響しない
//    （自己改善 MVP の床。決定的・オフライン・LLM/ネットワーク不使用）。
// 4b) ledger 網羅チェック … 直近記事が evaluations.jsonl に残っているか（警告のみ）。
//    取り込み時の記録は try/catch で握るため、失敗しても記事は正常に見え誰も気づけない。
// 1〜3g のいずれか失敗で非ゼロ終了。4 / 4b は警告のみで exit に影響しない（参考情報）。
import { mkdtemp, rm, readFile, readdir, access, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { loadArticles } from './store.js';
import { renderSite } from './render.js';
import { config } from './config.js';
import { evaluateArticle } from './evaluate.js';
import { lintDrafts } from './lintDrafts.js';
import { mdToHtml } from './markdown.js';
import { tagSlug } from './tagSlug.js';
import { validateVerdicts } from './reviewVerdict.js';
import { tagHref } from '../templates/cardbits.js';

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

    // --- 1d) sitemap の URL 数（警告のみ）---
    // sitemaps.org の上限は 1 ファイル 50,000 URL。超えると検索エンジンが読まなくなる。
    // Vercel の出力ファイル数やサイズより**こちらが先に効く**（SPEC §11）。
    // 増加を牽引するのは記事ではなくタグページ（ユニークタグは記事数の 1.7 倍前後で増える）。
    try {
      const sm = await readFile(path.join(dir, 'sitemap.xml'), 'utf8');
      const urls = (sm.match(/<loc>/g) || []).length;
      if (urls >= config.sitemapWarnUrls) {
        warn(`sitemap.xml の URL が ${urls} 件です（上限 50,000）。`
          + ' sitemap index への分割か、記事数の少ないタグをページ化しない閾値の導入を検討してください');
      }
    } catch { /* sitemap 不在は上の expected チェックが検出する */ }
  } catch (err) {
    fail(`レンダーが例外で停止しました: ${err.message}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  // renderSite は assets を複製しない（build.js が cpSync する）。ここが check の
  // 唯一の死角なので、「check 緑 ⇒ npm run build 緑」を成り立たせるため実在を確かめる。
  for (const rel of ['assets', path.join('assets', 'styles.css')]) {
    try {
      await access(path.join(ROOT, rel));
    } catch {
      fail(`ビルド用アセットがありません → ${rel}（npm run build が失敗します）`);
    }
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
    // slug は articles/<slug>.html のファイル名と各ページの URL になる。今は makeSlug() 由来の
    // YYYYMMDD-NN しか無いが、それは慣習であって保証ではない。手編集や復元で '/' が入れば
    // タグの 2026-07-26 と同じ形でレンダーごと落ちるため、形式を不変条件として固定する。
    if (typeof a?.slug === 'string' && !/^\d{8}-\d+$/.test(a.slug)) {
      fail(`${where}: slug の形式が YYYYMMDD-連番 ではありません (${a.slug})`);
    }
    if (!Array.isArray(a?.tags)) fail(`${where}: tags が配列ではありません`);
    // sources は任意（裏取りに使った2次媒体。レガシー記事には無い＝後方互換）。
    // あるときは形を検証する: 読者が辿れないリンクを載せると「明示した」ことにならないため。
    if (a?.sources != null) {
      if (!Array.isArray(a.sources)) {
        fail(`${where}: sources が配列ではありません`);
      } else {
        a.sources.forEach((s, j) => {
          if (typeof s?.url !== 'string' || !/^https?:\/\//.test(s.url)) {
            fail(`${where}: sources[${j}] の url が http(s) の URL ではありません`);
          }
          if (typeof s?.name !== 'string' || !s.name.trim()) {
            fail(`${where}: sources[${j}] に媒体名(name)がありません`);
          }
        });
      }
    }
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

// --- 3g) 長期トークン認証の退行検査（トークンが「静かに効かない／静かに事故る」のを止める）---
// 2026-10-02〜11-04: キーチェーンの OAuth セッションが失効し、復旧に対話的な /login が
// 要るため 66 ラン・33日間公開が止まった。.env の CLAUDE_CODE_OAUTH_TOKEN で無人化したが、
// 実測で環境変数は**キーチェーンより優先される**ことが分かっている（CLI 2.1.185）。
// つまり古いトークンを置いたままだと、生きているセッションを上書きして落ちる。
// 守るべきは次の4つで、どれも実データや正常系の実行では検証できない。
//   (1) 読み取りが素朴すぎて黙って空になる（＝トークンを置いたのに効かない）
//   (2) `.env` を source する（任意コード実行＋全ての秘密を子プロセスへ漏らす）
//   (3) トークン値をログへ出す（scheduler.log は gitignore なので漏洩検査に掛からない）
//   (4) 失効トークンでジョブを落とす（退避が消えると可用性の改善が可用性の事故になる）
// 本番シェル（zsh）が使えるか。無ければ読み取り関数の挙動は検証できない。
function hasZsh() {
  try {
    execFileSync('zsh', ['-c', 'exit 0'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function checkAuthTokenWiring() {
  const shPath = path.join(ROOT, 'scripts', 'auto-generate.sh');
  let sh = '';
  try {
    sh = await readFile(shPath, 'utf8');
  } catch (err) {
    fail(`長期トークン退行: scripts/auto-generate.sh を読めません: ${err.message}`);
    return;
  }

  // (1) 読み取りの挙動。関数定義を抜き出して実際に zsh で走らせる。
  //     書式ごとの取り落とし（引用符・export・空白・CRLF）は、正常な .env では一切顕れない。
  const fnMatch = sh.match(/^read_env_token\(\) \{\n[\s\S]*?^\}$/m);
  if (!fnMatch) {
    // 抜き出せないこと自体が退行（関数が消えた／名前が変わった）。素通りさせない。
    fail('長期トークン退行: auto-generate.sh に read_env_token() が見つかりません');
  } else if (!hasZsh()) {
    // zsh が無い環境（GitHub Actions の ubuntu ランナー等）。**黙って飛ばさない**——
    // 「検査が空回りする」のはこの検査が防ごうとしている失敗そのもので、しかも CI は
    // この検査がいちばん効くべき場所。bash で代用もしない: 本番の auto-generate.sh は
    // `#!/bin/zsh` なので、動かないシェルで検証したことになる。CI には zsh を入れてある
    // （.github/workflows/check.yml）。1行の明示的な失敗として出す（11件の ENOENT ではなく）。
    fail('長期トークン退行: zsh が無いため read_env_token を検証できません'
      + '（本番シェルは zsh。CI なら .github/workflows/check.yml の zsh インストール手順を確認）');
  } else {
    const dir = await mkdtemp(path.join(tmpdir(), 'fukan-authtok-'));
    try {
      const fnPath = path.join(dir, 'fn.zsh');
      await writeFile(fnPath, `${fnMatch[0]}\n`, 'utf8');
      const T = 'sk-ant-oat01-TESTVALUE';
      const cases = [
        ['素の値', `CLAUDE_CODE_OAUTH_TOKEN=${T}\nSLACK_WEBHOOK_URL=https://hooks.example/SECRET\n`, T],
        ['二重引用符', `CLAUDE_CODE_OAUTH_TOKEN="${T}"\n`, T],
        ['単一引用符', `CLAUDE_CODE_OAUTH_TOKEN='${T}'\n`, T],
        ['前後の空白', `CLAUDE_CODE_OAUTH_TOKEN =  ${T}   \n`, T],
        ['export 接頭辞', `export CLAUDE_CODE_OAUTH_TOKEN=${T}\n`, T],
        ['CRLF 改行', `CLAUDE_CODE_OAUTH_TOKEN=${T}\r\n`, T],
        ['空の値', 'CLAUDE_CODE_OAUTH_TOKEN=\n', ''],
        ['キー無し', 'SLACK_WEBHOOK_URL=https://hooks.example/SECRET\n', ''],
        ['コメント行', `#CLAUDE_CODE_OAUTH_TOKEN=${T}\n`, ''],
        ['重複は最後が勝つ', `CLAUDE_CODE_OAUTH_TOKEN=old\nCLAUDE_CODE_OAUTH_TOKEN=${T}\n`, T],
      ];
      for (const [name, envBody, want] of cases) {
        const caseDir = await mkdtemp(path.join(dir, 'case-'));
        await writeFile(path.join(caseDir, '.env'), envBody, 'utf8');
        let got = '';
        try {
          got = execFileSync('zsh', ['-c', `set -u; source ${JSON.stringify(fnPath)}; read_env_token`], {
            cwd: caseDir, encoding: 'utf8', env: { ...process.env, PROJECT_DIR: caseDir },
          }).replace(/\n+$/, '');
        } catch (err) {
          fail(`長期トークン退行: read_env_token が異常終了しました（${name}）: ${err.message}`);
          continue;
        }
        if (got !== want) {
          fail(`長期トークン退行: read_env_token の結果が違います（${name}）: 期待 "${want}" / 実際 "${got}"`);
        }
      }
      // .env が無いときに空を返すこと（ここで何か返すと存在しない鍵で認証を壊す）。
      const noEnv = await mkdtemp(path.join(dir, 'noenv-'));
      try {
        const got = execFileSync('zsh', ['-c', `set -u; source ${JSON.stringify(fnPath)}; read_env_token`], {
          cwd: noEnv, encoding: 'utf8', env: { ...process.env, PROJECT_DIR: noEnv },
        }).replace(/\n+$/, '');
        if (got !== '') fail(`長期トークン退行: .env 不在なのに値を返しました: "${got}"`);
      } catch (err) {
        fail(`長期トークン退行: .env 不在で read_env_token が異常終了しました: ${err.message}`);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  // (2) `.env` を source していないこと。source は任意コード実行であり、
  //     かつ SLACK_WEBHOOK_URL 等の秘密を writer/judge の子プロセスすべてへ渡してしまう。
  if (/^\s*(source|\.)\s+[^\n]*\.env\b/m.test(sh)) {
    fail('長期トークン退行: auto-generate.sh が .env を source しています（任意コード実行＋秘密の漏洩）');
  }

  // (3) トークン値をログへ出していないこと。scheduler.log は gitignore なので
  //     checkSecrets の漏洩検査には掛からない＝ここで止めるしかない。
  const printsToken = sh.split('\n').some((l) => (
    /^\s*(echo|print|printf)\b/.test(l) && /\$\{?CLAUDE_CODE_OAUTH_TOKEN/.test(l)
  ));
  if (printsToken) {
    fail('長期トークン退行: auto-generate.sh がトークン値を出力しています（ログに秘密が残ります）');
  }

  // (4) 失効トークンからの退避が残っていること。これが消えると、可用性のための仕組みが
  //     「古いトークンを置いた瞬間に公開が止まる」という逆向きの事故に変わる。
  if (!/unset CLAUDE_CODE_OAUTH_TOKEN/.test(sh)) {
    fail('長期トークン退行: 失効トークンからセッションへ退避する経路（unset）がありません');
  }
  if (!/AUTH_MODE="session-fallback"/.test(sh)) {
    fail('長期トークン退行: session-fallback の分岐がありません（退避したことが観測できません）');
  }
  if (!/auth_token_invalid/.test(sh)) {
    fail('長期トークン退行: トークン失効を incidents へ記録していません（後から気づけません）');
  }

  // (5) 秘密を「公開値」に足していないこと。足すと .env 漏洩検査がこの鍵を素通りする。
  if (PUBLIC_ENV_KEYS.has('CLAUDE_CODE_OAUTH_TOKEN')) {
    fail('長期トークン退行: CLAUDE_CODE_OAUTH_TOKEN が PUBLIC_ENV_KEYS に入っています（秘密です）');
  }

  // (6) .env.example に項目があること（無いと復旧時に存在に気づけない）。
  try {
    const ex = await readFile(path.join(ROOT, '.env.example'), 'utf8');
    if (!/CLAUDE_CODE_OAUTH_TOKEN/.test(ex)) {
      fail('長期トークン退行: .env.example に CLAUDE_CODE_OAUTH_TOKEN の項目がありません');
    }
  } catch { /* .env.example が無い環境は検査対象外 */ }
}

// 設計上ページに埋め込まれる「公開値」。秘密を増やしたときにここへ足してしまうと
// 漏洩検査がその鍵を素通りさせる。CLAUDE_CODE_OAUTH_TOKEN のような秘密は足さないこと
// （checkAuthTokenWiring が hard-fail で見張る）。
const PUBLIC_ENV_KEYS = new Set(['CF_BEACON_TOKEN', 'SITE_URL', 'IMAGE_PROVIDER']);

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

// --- 3c) 下書きリント退行検査（決定論の検算器が壊れていないか）---
// 実データ（公開済み記事）はリントを通っているものが多く素通り検知できないため、サニタイザ検査と
// 同じ方式で「既知の事故そのものの形」を合成入力として通し、検出されることを確認する。
// 入力は 2026-07-25 に実際に差し戻された下書きの再現（原因の型のみ・本文は最小化）。
// この検査が落ちるとき、リントは事故を素通りさせている（＝writer の検算が空回りしている）。
function checkDraftLint() {
  // 緊急停止（config.draftLint.enabled=false）中は検査対象が存在しない。ここで hard-fail に
  // すると「安全弁を引いたら check が赤になって公開できない」という逆転が起きるので警告に留める。
  if (config.draftLint?.enabled === false) {
    warn('下書きリントが無効化されています（config.draftLint.enabled=false）。writer の検算は効きません');
    return;
  }
  const drafts = [
    { // 別記事（この後の要素）の固有名詞・数値が紛れ込んだ形
      headline: 'Trumpが新関税を発動、ブラジルに25%・カナダに50%',
      lead: 'Trump政権は関税を発動し、Brent原油は100ドル超に上昇した。',
      body_markdown: 'ブラジルに25%、カナダに50%の関税を課す。対象は自動車と乳製品。',
      link: 'https://www.cnbc.com/example',
    },
    { headline: 'フーシ派がサウジアラムコ石油施設を攻撃、Brent原油100ドル突破',
      lead: 'Brent原油は100ドルを超えた。',
      body_markdown: 'Brent原油の先物は100ドルを突破した。Brentの上昇は供給不安による。',
      link: 'https://www.reuters.com/example',
    },
    { // 同一対象を別の比率で書いた形＋全角合成文字
      headline: 'Opus 5を発表、Fable 5より安価',
      lead: '価格はFable 5の半値に設定された。',
      body_markdown: 'コストはおよそ3分の1に下がったとされる。㌦建ての試算もある。',
      link: 'https://techcrunch.com/example',
    },
  ];
  let results = [];
  try {
    results = lintDrafts(drafts);
  } catch (err) {
    fail(`下書きリント検査: lintDrafts が例外で停止しました: ${err.message}`);
    return;
  }
  const codes = new Set(results.flatMap((r) => r.findings.map((f) => f.code)));
  for (const expected of ['summary-only-number', 'crosstalk', 'ratio-conflict', 'composite-char']) {
    if (!codes.has(expected)) fail(`下書きリント退行: 既知の事故形（${expected}）を検出できません`);
  }
}

// --- 3d) タグ slug 検査（パスに化けるタグでビルドが落ちる退行を止める）---
// 2026-07-26: タグ 'AR/VR' が dist/tags/AR/VR.html と解釈され render 全体が ENOENT で停止、
// 同じ npm run build を走らせる Vercel のデプロイも失敗した。
// (1) 変換器そのものの退行、(2) 変換後の衝突、(3) 実データの危険文字 を見る。
// 「render/テンプレが tagSlug を呼んでいるか」は checkTagPathWiring() が担当する。
function checkTagSlugs(arts) {
  // (1) 変換器の退行検査。合成入力で、パス区切り・親ディレクトリ参照が残らないこと。
  for (const [input, expected] of [
    ['AR/VR', 'AR-VR'],
    ['a:b', 'a-b'],
    ['x\\y', 'x-y'],
    ['..', '_'],
    ['.hidden', 'hidden'],
    ['  前後  ', '前後'],
    ['', '_'],
    // 既存タグは不動点であること（公開済み URL を変えない）
    ['テクノロジー', 'テクノロジー'],
    ['Physical AI', 'Physical AI'],
    ['M&A', 'M&A'],
    ['GLP-1', 'GLP-1'],
    ['C#', 'C#'],
  ]) {
    const got = tagSlug(input);
    if (got !== expected) fail(`タグslug退行: tagSlug(${JSON.stringify(input)}) が ${JSON.stringify(got)}（期待 ${JSON.stringify(expected)}）`);
  }
  for (const bad of ['AR/VR', '..', 'a\\b']) {
    const got = tagSlug(bad);
    if (got.includes('/') || got.includes('\\') || got === '.' || got === '..') {
      fail(`タグslug退行: ${JSON.stringify(bad)} の変換結果 ${JSON.stringify(got)} がまだパスとして危険です`);
    }
  }

  if (!Array.isArray(arts)) return;
  const tags = [...new Set(arts.flatMap((a) => (Array.isArray(a?.tags) ? a.tags : [])))];

  // (2) 衝突は hard-fail。別タグが同じファイル名に落ちると片方のページが後勝ちで消え、
  // sitemap が「中身が別タグ」の URL を広告する（読者にも検索エンジンにも誤りが出る）。
  const bySlug = new Map();
  for (const t of tags) {
    const s = tagSlug(t);
    if (!bySlug.has(s)) bySlug.set(s, []);
    bySlug.get(s).push(t);
  }
  for (const [s, ts] of bySlug) {
    if (ts.length > 1) fail(`タグ ${ts.map((t) => `「${t}」`).join('・')} が同じファイル名 ${s}.html に衝突します`);
  }

  // 大文字小文字だけの違いは warn に留める。本番(Linux)は別ファイルとして正しく配信され、
  // 取り違えが起きるのは大小を区別しない macOS でのローカル生成時だけのため。
  const byLower = new Map();
  for (const s of bySlug.keys()) {
    const k = s.toLowerCase();
    if (!byLower.has(k)) byLower.set(k, []);
    byLower.get(k).push(s);
  }
  for (const [, ss] of byLower) {
    if (ss.length > 1) warn(`タグ ${ss.join(' / ')} は大文字小文字しか違いません（macOS のローカル生成では片方が上書きされます）`);
  }

  // (3) 実データの危険文字は warn。render 側が tagSlug で全域化されたため公開は安全で、
  // ここで止めると「公開できないデータが日次を無限に塞ぐ」＝今回潰した失敗モードの再生産になる。
  for (const t of tags) {
    if (tagSlug(t) !== t) warn(`タグ「${t}」はパスに使えない文字を含むため ${tagSlug(t)}.html として出力されます`);
  }
}

// --- 3e) タグ→パス配線の退行検査（4つの適用箇所が実際に tagSlug を通っているか）---
// 2026-07-26 に壊れたのは tagSlug ではなく「render がそれを呼んでいないこと」だった。
// ところが取り込み時の正規化（store.js）のおかげで実データの全タグは tagSlug の不動点なので、
// 実データを描画しても配線が外れたことを検知できない（素通りする）。
// そこで危険な文字を含む合成タグを1件だけ別の一時ディレクトリへ描画し、
// ファイル名・記事内リンク・canonical・sitemap の4経路すべてを突き合わせる。
async function checkTagPathWiring() {
  const RAW = 'AR/VR';
  const SLUG = tagSlug(RAW); // 'AR-VR'
  const art = {
    slug: '20000101-01',
    headline: 'タグ配線検査用のダミー記事',
    lead: '検査用。公開されません。',
    body_markdown: '検査用のダミー本文です。',
    tags: [RAW],
    section: config.navSections[0]?.name || 'AI',
    source: '検査',
    link: 'https://example.com/tag-wiring-check',
    importance: 3,
    createdAt: new Date().toISOString(),
    publishedAt: null,
  };
  const dir = await mkdtemp(path.join(tmpdir(), 'axiom-tagwire-'));
  try {
    await renderSite([art], { outDir: dir });
  } catch (err) {
    // '/' を含むタグで落ちる＝ render.js の書き出し名が tagSlug を通っていない。
    fail(`タグ配線退行: 危険な文字を含むタグでレンダーが停止しました（render.js の書き出し名を確認）: ${err.message}`);
    await rm(dir, { recursive: true, force: true });
    return;
  }
  try {
    // ① 書き出し名（src/render.js のタグページ writeFile）
    try {
      await access(path.join(dir, 'tags', `${SLUG}.html`));
    } catch {
      fail(`タグ配線退行: tags/${SLUG}.html が生成されていません（render.js の書き出し名）`);
    }

    const expectedHref = `tags/${encodeURIComponent(SLUG)}.html`;
    // ② 記事ページ内のタグリンク（templates/cardbits.js の tagHref）
    const articleHtml = await readFile(path.join(dir, 'articles', `${art.slug}.html`), 'utf8');
    if (!articleHtml.includes(expectedHref)) {
      fail(`タグ配線退行: 記事HTMLのタグリンクが ${expectedHref} を指していません（cardbits.js の tagHref）`);
    }
    // ③ タグページの canonical（templates/tag.js）
    const tagHtml = await readFile(path.join(dir, 'tags', `${SLUG}.html`), 'utf8');
    if (!tagHtml.includes(`/tags/${encodeURIComponent(SLUG)}.html`)) {
      fail(`タグ配線退行: タグページの canonical が /tags/${SLUG}.html を指していません（tag.js）`);
    }
    // ④ sitemap（src/render.js）
    const sitemap = await readFile(path.join(dir, 'sitemap.xml'), 'utf8');
    if (!sitemap.includes(`/tags/${encodeURIComponent(SLUG)}.html`)) {
      fail(`タグ配線退行: sitemap.xml が /tags/${SLUG}.html を含みません（render.js）`);
    }
  } catch (err) {
    fail(`タグ配線検査が例外で停止しました: ${err.message}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// --- 4) 客観品質チェック（警告のみ・exit に影響しない）---
// しきい値（config.qualityThresholds）は「床」であって最大化目標ではない。
// hard-fail は 2) スキーマ側に任せ、ここは編集の気づき用に warn を出すだけ。
// --- 3f) judge 判定ガードの退行検査（veto が無言で無効化される穴を塞いだまま保つ）---
// 2026-11-04: judge は 25本中3本を veto と判定して _review.json を書き出したが中身が壊れており、
// auto-generate.sh のガードが**ファイルの存在しか見ていなかった**ため「査読成功」と扱われ、
// judge_absent も Slack 通知も出ないまま veto 3本（桁誤り・出典に無い記述）が取り込まれた。
// 記事は正常に見えるので、push が GitHub の 500 で失敗していなければ誰も気づけなかった。
// (1) 判定器そのものの退行、(2) CLI の終了コード＝ガードが読む契約、(3) 配線の外れ を見る。
// 実データ（正常な判定）を通しても、この3つはどれも検証できない。
async function checkReviewVerdictGuard() {
  const links = ['https://a.example/1', 'https://b.example/2'];
  const good = JSON.stringify([
    { link: links[0], verdict: 'pass' },
    { link: links[1], verdict: 'veto', critique: '桁が10倍ずれている' },
  ]);

  // (1) 判定器の退行。壊れ方ごとに「使えない／不完全／正常」を取り違えないこと。
  //     ok=false は judge 不在と同じ扱い、complete=false は一部が未査読のまま公開される回。
  const cases = [
    ['不正な JSON', '[{"link":"a",', false, false],
    ['配列でない', '{"link":"a","verdict":"pass"}', false, false],
    ['使える行なし', '[{"foo":1},{"link":123,"verdict":"pass"}]', false, false],
    ['空配列', '[]', false, false],
    ['verdict が未知の語', `[{"link":"${links[0]}","verdict":"maybe"}]`, false, false],
    ['一部だけ使える', `[{"link":"${links[0]}","verdict":"pass"},{"link":"${links[1]}"}]`, true, false],
    ['正常', good, true, true],
  ];
  for (const [name, raw, wantOk, wantComplete] of cases) {
    let v;
    try {
      v = validateVerdicts(raw, links);
    } catch (err) {
      fail(`judge 判定ガード退行: validateVerdicts が例外で停止しました（${name}）: ${err.message}`);
      continue;
    }
    if (v.ok !== wantOk) {
      fail(`judge 判定ガード退行: 「${name}」を ok=${v.ok} と判定しました（期待 ${wantOk}）`);
    } else if (v.complete !== wantComplete) {
      fail(`judge 判定ガード退行: 「${name}」を complete=${v.complete} と判定しました（期待 ${wantComplete}）`);
    }
  }

  // (2) CLI の終了コード。auto-generate.sh のガードはこれだけで分岐するので、
  //     文言ではなく終了コードを検証する（0=完全 / 1=使えない / 2=不完全）。
  const dir = await mkdtemp(path.join(tmpdir(), 'fukan-verdict-'));
  try {
    const draftsFile = path.join(dir, 'drafts.json');
    await writeFile(draftsFile, JSON.stringify(links.map((l) => ({ link: l }))), 'utf8');
    for (const [name, raw, wantCode] of [
      ['壊れた判定', '[{"link":"a",', 1],
      ['判定ファイル無し', null, 1],
      ['一部未査読', `[{"link":"${links[0]}","verdict":"pass"}]`, 2],
      ['正常', good, 0],
    ]) {
      const f = path.join(dir, `${name}.json`);
      if (raw !== null) await writeFile(f, raw, 'utf8');
      let code = 0;
      try {
        execFileSync(
          process.execPath,
          [path.join(ROOT, 'src', 'reviewVerdict.js'), '--validate', '--review', f, '--drafts', draftsFile],
          { stdio: 'pipe' },
        );
      } catch (err) {
        code = typeof err.status === 'number' ? err.status : -1;
      }
      if (code !== wantCode) {
        fail(`judge 判定ガード退行: CLI が「${name}」で exit=${code} を返しました（期待 ${wantCode}）`);
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  // (3) 配線。判定の解釈が複数箇所に増えると、またガードと消費側がズレて veto が消える。
  for (const [rel, re, msg] of [
    ['scripts/auto-generate.sh', /src\/reviewVerdict\.js\s+--validate/, 'ガードが reviewVerdict.js を呼んでいません'],
    ['src/ingestDrafts.js', /from '\.\/reviewVerdict\.js'/, 'ingestDrafts が reviewVerdict.js を使っていません'],
    ['src/prepareFixRound.js', /from '\.\/reviewVerdict\.js'/, 'prepareFixRound が reviewVerdict.js を使っていません'],
  ]) {
    let src;
    try {
      src = await readFile(path.join(ROOT, rel), 'utf8');
    } catch {
      fail(`judge 判定ガード退行: ${rel} を読めません`);
      continue;
    }
    if (!re.test(src)) fail(`judge 判定ガード退行: ${msg}（${rel}）`);
    // 消費側が自前で _review.json を parse し直していないこと（解釈が二重化するとズレる）。
    if (rel !== 'scripts/auto-generate.sh' && /JSON\.parse\(await readFile\(reviewPath/.test(src)) {
      fail(`judge 判定ガード退行: ${rel} が _review.json を自前で JSON.parse しています（判定の解釈は reviewVerdict.js に一本化すること）`);
    }
    // 存在チェックだけのガードに戻っていないこと（-f では壊れた JSON が素通りする）。
    if (rel === 'scripts/auto-generate.sh' && /!\s*-f\s+"\$PROJECT_DIR\/data\/_review\.json"/.test(src)) {
      fail('judge 判定ガード退行: auto-generate.sh が _review.json の存在（-f）で査読の成否を判定しています（壊れた JSON が素通りします）');
    }
  }
}

function checkQuality(arts) {
  arts.forEach((a, i) => {
    const recent = arts.slice(i + 1); // この記事より古い記事を母集団に
    const { flags } = evaluateArticle(a, recent);
    for (const f of flags) warn(`${a.slug}: ${f}`);
  });
}

// --- 4b) 品質 ledger の網羅チェック（警告のみ・exit に影響しない）---
// 公開された記事が evaluations.jsonl に残っているかを見る。ingest の評価記録は try/catch で
// 握る設計（評価機構の故障で公開を止めない）なので、書き込みが失敗しても誰も気づけない。
// 2026-07-26 はレンダー落ちで ingest の記録ブロックごと飛び、21本が未記録のまま公開された——
// 記事は正常に見えるため、人に指摘されるまで発覚しなかった。その「気づけなさ」を埋める。
//
// hard-fail にはしない。ledger は評価機構であって公開ゲートではなく、ここで公開を止めると
// 「評価機構の故障で公開事故/停止を起こさない」という規律（SPEC §12）を破る。
// 母集団を直近 coverageWindow 件に絞るのは、ledger 導入前のレガシー記事と
// ローテーションで切り詰められた古い行を誤検知しないため。
async function checkLedgerCoverage(arts) {
  // ledger 書き込みに失敗した回に退避された judge 出力。放置すると溜まる一方なので、
  // 「replay して消す」ことを促す。存在自体が「記録に失敗した回があった」証拠。
  try {
    const kept = (await readdir(path.join(ROOT, 'data', 'quality')))
      .filter((f) => f.startsWith('_review-failed-'));
    if (kept.length) {
      warn(`judge 出力の退避ファイルが ${kept.length} 件残っています（${kept.slice(0, 3).join(', ')}${kept.length > 3 ? ' ほか' : ''}）。`
        + ' ledger への記録に失敗した回があります。内容を evaluations.jsonl へ反映したら削除してください');
    }
  } catch { /* data/quality が無い＝初回。無視 */ }

  if (!Array.isArray(arts) || !arts.length) return;
  let have;
  try {
    const raw = await readFile(path.join(ROOT, 'data', 'quality', 'evaluations.jsonl'), 'utf8');
    have = new Set(raw.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l).slug; } catch { return null; } }));
  } catch {
    warn('品質 ledger（evaluations.jsonl）を読めません。評価の蓄積が止まっている可能性があります');
    return;
  }
  const recent = arts.slice(0, config.ledger?.coverageWindow ?? 50);
  const missing = recent.filter((a) => a?.slug && !have.has(a.slug));
  if (!missing.length) return;
  warn(`直近 ${recent.length} 件のうち ${missing.length} 件が品質 ledger に未記録です`
    + `（${missing.slice(0, 5).map((a) => a.slug).join(', ')}${missing.length > 5 ? ' ほか' : ''}）。`
    + ' 取り込み時の記録が失敗した可能性 → data/scheduler.log の「評価の記録に失敗」を確認してください');
}

// --- 5) 更新鮮度チェック（警告のみ・exit に影響しない）---
// 自動ジョブが無言停止しても articles.json は「壊れていない」ため 1〜4 は全て通る。
// 最終記事からの経過を見て、パイプライン停止に気づける最後の砦にする。
// warns に混ぜると記事ごとの品質警告に埋もれるので、独立させて末尾に目立たせる。
function checkFreshness(arts) {
  const newest = arts.reduce((max, a) => {
    const t = Date.parse(a.publishedAt || a.createdAt || '');
    return Number.isNaN(t) ? max : Math.max(max, t);
  }, 0);
  if (!newest) return null; // 日時が1件も読めない＝スキーマ側の担当（ここでは黙る）
  const days = (Date.now() - newest) / 86400000;
  if (days < config.freshness.staleDays) return null;
  return `最終記事から ${days.toFixed(1)} 日経過（しきい値 ${config.freshness.staleDays} 日）。`
    + ` 自動ジョブが停止している可能性 → data/.status と data/scheduler.log を確認してください。`;
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
checkDraftLint();
checkTagSlugs(arts);
await checkTagPathWiring();
await checkReviewVerdictGuard();
await checkAuthTokenWiring();
await checkSecrets(arts);
checkQuality(arts);
await checkLedgerCoverage(arts);

if (warns.length) {
  console.warn(`⚠ 品質警告（${warns.length} 件・公開はブロックしません）:`);
  for (const w of warns) console.warn(`  - ${w}`);
}

const stale = checkFreshness(arts);
if (stale) {
  console.warn(`\n⚠ 更新が滞っています: ${stale}\n`);
}

if (fails.length) {
  console.error(`✗ check 失敗（${fails.length} 件）:`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ check 通過: ${arts.length} 記事・レンダー完走・スキーマOK・サニタイザOK・下書きリントOK・judge判定ガードOK・認証トークン配線OK・鍵混入なし・constitution 維持`);
