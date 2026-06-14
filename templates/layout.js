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
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..600;1,9..144,300..600&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600;700&display=swap">`;

// 最新見出しを流すティッカー（架空のベンチ値は廃止）。items=最新の見出し配列。
export function ticker(items = []) {
  const heads = (items || []).filter(Boolean);
  const feed = heads.length
    // シームレスなループのため2周分を並べる
    ? [...heads, ...heads].map((h) => `        <span class="ticker__item">${esc(h)}</span>`).join('\n')
    : `        <span class="ticker__item">AXIOM AI — 最新のAIニュースを編集部の要約と論評でお届けします。</span>`;
  return `  <!-- ============== TICKER ============== -->
  <div class="ticker" role="region" aria-label="最新の見出し">
    <div class="ticker__inner">
      <div class="ticker__label">LIVE</div>
      <div class="ticker__feed">
${feed}
      </div>
    </div>
  </div>`;
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
    <div class="container">
      <div class="site-header__top">
        <a class="brand" href="${base}index.html">
          <span class="brand__mark">AXIOM<em>·</em>AI</span>
          <span class="brand__sub">Intelligence Daily</span>
        </a>
        <div class="site-header__right">
        <div class="site-header__meta">
          <span>東京</span>
          <time>${dateLabel}</time>
          <a href="#" class="btn btn--ghost" title="準備中" onclick="event.preventDefault(); alert('ログイン機能は準備中です');">ログイン</a>
          <a href="#" class="btn btn--primary" title="準備中" onclick="event.preventDefault(); alert('購読機能は準備中です');">購読 ¥0/月</a>
        </div>
        <div class="site-header__tools">
          <div class="hsearch">
            <input type="search" id="site-search" class="hsearch__input" placeholder="記事を検索…" aria-label="サイト内検索" autocomplete="off" data-base="${base}">
            <div id="site-search-results" class="hsearch__results" role="listbox" hidden></div>
          </div>
          <button type="button" id="theme-toggle" class="theme-toggle" aria-label="配色テーマを切り替え" title="配色テーマを切り替え" onclick="(function(d){var n=d.getAttribute('data-theme')==='light'?'dark':'light';d.setAttribute('data-theme',n);try{localStorage.setItem('theme',n)}catch(e){}var b=document.getElementById('theme-toggle');if(b)b.textContent=n==='light'?'☀':'☾';})(document.documentElement)">☾</button>
        </div>
        </div>
      </div>
      <nav class="site-nav container" aria-label="主要セクション">
        <ul class="site-nav__list">
${items}
        </ul>
      </nav>
    </div>
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
          <span class="brand__mark">AXIOM<em>·</em>AI</span>
          <p>生成 AI と基盤モデルを中心に、AI のニュースを毎日お届けします。本サイトの記事は各一次情報源の要約・論評であり、詳細は必ず出典元をご確認ください。</p>
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
            <li><span style="color: var(--color-ink-3);">メール配信（準備中）</span></li>
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

  <script defer src="${base}assets/search.js"></script>
</body>
</html>
`;
}
