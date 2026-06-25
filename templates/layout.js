// 既存 index.html / article.html のマークアップを逐語再現した共通骨格。
// 記事差込領域以外のデザインは一切変えない。
import { config } from '../src/config.js';
import { esc } from '../src/markdown.js';

// サイト内パス（"/articles/x.html"）→ 絶対URL（canonical/OGP/JSON-LD 用）
export function absUrl(path = '/') {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${config.siteUrl}${p}`;
}

const FONTS = `  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400..500&family=Noto+Serif+JP:wght@500;600&family=Inter:wght@400;500&family=Noto+Sans+JP:wght@400;500&display=swap">`;

// 旧ティッカー（常時スクロール）は認知負荷・a11y の観点で撤去。
// 各テンプレが `ticker(...)` を呼ぶ箇所が残るため、空文字を返す薄いスタブとして維持する。
export function ticker() {
  return '';
}

export function header(dateLabel, activeNav = 'トップ', base = '') {
  const nav = [{ name: 'トップ', slug: '' }, ...config.navSections];
  const items = nav
    .map(({ name, slug }) => {
      const href = name === 'トップ' ? `${base}index.html` : `${base}sections/${slug}.html`;
      const cur = name === activeNav ? ' aria-current="page"' : '';
      return `          <li><a href="${href}"${cur}>${name}</a></li>`;
    })
    .join('\n');
  return `  <!-- ============== HEADER ============== -->
  <header class="site-header">
    <div class="container site-header__bar">
      <a class="brand" href="${base}index.html">
        <span class="brand__mark">俯瞰<em>·</em>FUKAN</span>
      </a>
      <div class="site-header__tools">
        <div class="hsearch">
          <input type="search" id="site-search" class="hsearch__input" placeholder="検索" aria-label="サイト内検索" autocomplete="off" data-base="${base}">
          <div id="site-search-results" class="hsearch__results" role="listbox" hidden></div>
        </div>
      </div>
    </div>
    <nav class="site-nav" aria-label="主要セクション">
      <div class="container">
        <ul class="site-nav__list">
${items}
        </ul>
      </div>
    </nav>
  </header>`;
}

// フッター（base 対応・実リンク接続）。記事/セクション/タグ配下からは base='../'。
export function footer(base = '') {
  const sections = config.navSections
    .map(({ name, slug }) => `            <li><a href="${base}sections/${slug}.html">${esc(name)}</a></li>`)
    .join('\n');
  return `  <!-- ============== FOOTER ============== -->
  <footer class="site-footer">
    <div class="container">
      <div class="site-footer__top">
        <div class="site-footer__brand">
          <span class="brand__mark">俯瞰<em>·</em>FUKAN</span>
          <p>テック・AI・科学・経済・政治・国際・カルチャーまで、世界のニュースを毎日お届けします。本サイトの記事は各一次情報源の要約・論評であり、詳細は必ず出典元をご確認ください。</p>
        </div>
        <div class="site-footer__col">
          <h4>セクション</h4>
          <ul>
${sections}
          </ul>
        </div>
        <div class="site-footer__col">
          <h4>運営情報</h4>
          <ul>
            <li><a href="${base}about.html">運営者情報</a></li>
            <li><a href="${base}editorial.html">編集方針</a></li>
            <li><a href="${base}contact.html">お問い合わせ</a></li>
          </ul>
        </div>
        <div class="site-footer__col">
          <h4>規約</h4>
          <ul>
            <li><a href="${base}privacy.html">プライバシーポリシー</a></li>
            <li><a href="${base}terms.html">利用規約</a></li>
            <li><a href="${base}disclaimer.html">免責事項</a></li>
          </ul>
        </div>
        <div class="site-footer__col">
          <h4>配信</h4>
          <ul>
            <li><a href="${base}feed.xml">RSS フィード</a></li>
          </ul>
        </div>
      </div>
      <div class="site-footer__bottom">
        <span>© 2026 ${esc(config.operator.brand)}. All rights reserved.</span>
        <div class="site-footer__legal">
          <a href="${base}about.html">運営者情報</a>
          <a href="${base}privacy.html">プライバシー</a>
          <a href="${base}contact.html">お問い合わせ</a>
        </div>
      </div>
      <p class="site-footer__note">${esc(config.trademarkNotice)}</p>
    </div>
  </footer>`;
}

// Cloudflare Web Analytics（Cookieless）。token が設定されているときのみ出力。
function analyticsSnippet() {
  const t = config.analytics?.token;
  if (!t) return '';
  return `  <script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "${t}"}'></script>\n`;
}

// 構造化データ/OGP で再利用する発行者（Organization）。
export function organizationLd() {
  return {
    '@type': 'Organization',
    name: config.siteName,
    url: config.siteUrl,
    logo: { '@type': 'ImageObject', url: absUrl(config.logo) },
  };
}

// ogImage がフルURLならそのまま、サイト内パスなら絶対化。未指定は共通OG。
function resolveOg(img) {
  if (!img) return absUrl(config.ogImage);
  return /^https?:\/\//.test(img) ? img : absUrl(img);
}

// JSON-LD を安全に script へ（</script> 混入対策で < をエスケープ）
function jsonLdScript(jsonLd) {
  if (!jsonLd) return '';
  const arr = Array.isArray(jsonLd) ? jsonLd : [jsonLd];
  return arr
    .map((obj) => {
      const data = { '@context': 'https://schema.org', ...obj };
      const json = JSON.stringify(data).replace(/</g, '\\u003c');
      return `  <script type="application/ld+json">${json}</script>`;
    })
    .join('\n') + '\n';
}

// ページ全体のHTMLを組み立てる。
// base: サブディレクトリ用の相対プレフィックス / canonicalPath: サイト内絶対パス（"/..."）
// ogImage: 共有画像 / ogType: 'website'|'article' / jsonLd: 構造化データ（obj か配列）
export function page({ title, description, body, base = '', canonicalPath = '/', ogImage, ogType = 'website', jsonLd }) {
  const canonical = absUrl(canonicalPath);
  const img = resolveOg(ogImage);
  const desc = description || config.siteDescription;
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script>(function(){try{var t=localStorage.getItem('theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}document.documentElement.setAttribute('data-theme',t);}catch(e){}})();</script>
  <title>${title}</title>
  <meta name="description" content="${esc(desc)}">
  <link rel="canonical" href="${esc(canonical)}">
  <meta property="og:type" content="${ogType}">
  <meta property="og:site_name" content="${esc(config.siteName)}">
  <meta property="og:locale" content="ja_JP">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:url" content="${esc(canonical)}">
  <meta property="og:image" content="${esc(img)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(title)}">
  <meta name="twitter:description" content="${esc(desc)}">
  <meta name="twitter:image" content="${esc(img)}">
  <link rel="preconnect" href="https://images.unsplash.com" crossorigin>
${FONTS}
  <link rel="stylesheet" href="${base}assets/styles.css">
  <link rel="alternate" type="application/rss+xml" title="${esc(config.siteName)} RSS" href="${base}feed.xml">
${jsonLdScript(jsonLd)}${analyticsSnippet()}</head>
<body>

${body}

  <script defer src="${base}assets/reveal.js"></script>
  <script defer src="${base}assets/search.js"></script>
</body>
</html>
`;
}
