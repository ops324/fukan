// 記事詳細ページ。articles/<slug>.html に出力するため base='../'。
// 低認知負荷方針：3カラム（TOC/著者/関連）を畳み、単一カラムの読み筋に集中。
// 実写真は規約準拠の帰属付きで表示。出典リンクカードを本文直後に必ず置く。
import { ticker, header, footer, page, organizationLd, absUrl } from './layout.js';
import { mdToHtml, esc } from '../src/markdown.js';
import { config } from '../src/config.js';
import { tagHref, optimizedUrl, sectionChip } from './cardbits.js';

const BASE = '../';

// セクション名 → sections/<slug>.html。未知セクションはトップへ。
function sectionHref(name) {
  const found = config.navSections.find((s) => s.name === name);
  return found ? `${BASE}sections/${found.slug}.html` : `${BASE}index.html`;
}

// 読了時間（日本語 ≈ 400字/分）。最低1分。
function readingMinutes(md = '') {
  return Math.max(1, Math.round(md.length / 400));
}

// 記事の絶対URL（共有用）
function articleUrl(a) {
  return `${config.siteUrl}/articles/${a.slug}.html`;
}

// 出典発行日時の ISO（<time> 用）
function isoDate(a) {
  const src = a.publishedAt || a.createdAt;
  if (!src) return '';
  const d = new Date(src);
  return Number.isNaN(d.getTime()) ? '' : esc(d.toISOString());
}

// 共有ボタンのインライン SVG アイコン（正式ロゴ／一目で意味が分かる字形）。
// viewBox は各社の素のパスに合わせ、CSS 側で 18px 程度に正規化する。
const SHARE_ICONS = {
  // X（旧 Twitter）公式ロゴ
  x: '<svg class="share-ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z"/></svg>',
  // LINE 公式ロゴ（吹き出し＋LINE）
  line: '<svg class="share-ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 2C6.48 2 2 5.69 2 10.23c0 4.07 3.55 7.48 8.35 8.12.32.07.77.21.88.49.1.25.06.64.03.89l-.14.85c-.04.25-.2.98.86.53s5.72-3.37 7.8-5.77c1.44-1.58 2.13-3.18 2.13-4.96C21.91 5.69 17.43 2 12 2ZM8.13 12.85H6.14a.53.53 0 0 1-.53-.53V8.36a.53.53 0 0 1 1.06 0v3.43h1.46a.53.53 0 0 1 0 1.06Zm2.08-.53a.53.53 0 0 1-1.06 0V8.36a.53.53 0 0 1 1.06 0v3.96Zm4.77 0a.53.53 0 0 1-.36.5.55.55 0 0 1-.17.03.53.53 0 0 1-.43-.21l-2.03-2.77v2.45a.53.53 0 0 1-1.06 0V8.36a.53.53 0 0 1 .36-.5.53.53 0 0 1 .6.18l2.03 2.77V8.36a.53.53 0 0 1 1.06 0v3.96Zm3.2-2.51a.53.53 0 0 1 0 1.06h-1.46v.93h1.46a.53.53 0 0 1 0 1.06h-1.99a.53.53 0 0 1-.53-.53V8.36a.53.53 0 0 1 .53-.53h1.99a.53.53 0 0 1 0 1.06h-1.46v.92h1.46Z"/></svg>',
  // はてなブックマーク
  hatebu: '<svg class="share-ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M3 3h18v18H3V3Zm6.62 11.34c-.46 0-.83.37-.83.83s.37.83.83.83.83-.37.83-.83-.37-.83-.83-.83Zm.45-1.07c.86 0 1.45-.06 1.91-.42.49-.39.72-.99.72-1.83 0-.6-.13-1.09-.4-1.46-.25-.34-.6-.55-1.06-.65.4-.13.69-.32.89-.6.19-.27.28-.62.28-1.06 0-.78-.27-1.34-.79-1.7-.49-.34-1.21-.49-2.26-.49H6.1v8.66h2.42c.6 0 1.07-.04 1.55-.18Zm-1.95-6.6h.62c.5 0 .85.06 1.05.2.21.13.31.37.31.71 0 .33-.1.56-.31.7-.2.13-.55.19-1.06.19h-.61V6.67Zm0 3.27h.74c.55 0 .94.07 1.16.21.22.15.34.4.34.78s-.12.65-.34.8c-.22.15-.6.22-1.16.22h-.74V9.94Zm9.13 3.5h1.5v-2.07h-1.5v2.07Zm0-3.07h1.5V6.7h-1.5v3.67Z"/></svg>',
  // リンクをコピー（鎖アイコン・一目で「リンク」と分かる）
  copy: '<svg class="share-ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M10.5 13.5a3.5 3.5 0 0 0 5 0l2.5-2.5a3.5 3.5 0 1 0-5-5l-1.2 1.2M13.5 10.5a3.5 3.5 0 0 0-5 0L6 13a3.5 3.5 0 1 0 5 5l1.2-1.2"/></svg>',
  // コピー成功（チェック）
  check: '<svg class="share-ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="m5 12.5 4.5 4.5L19 7"/></svg>',
  // ネイティブ共有（共有ノード）
  share: '<svg class="share-ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M18 8a2.5 2.5 0 1 0-2.45-3M18 8a2.5 2.5 0 0 1-2.45-3M18 8 8.7 12.65M6 14.5A2.5 2.5 0 1 0 6 9.5a2.5 2.5 0 0 0 0 5Zm0 0 9.55 4.77M18 21a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5Z"/></svg>',
};

// 機能する共有ボタン（X / LINE / はてブ / リンクコピー ＋ Web Share API）。
// JS なしでも個別ボタンは動作。navigator.share 対応端末では assets/share.js が
// ルートに has-web-share を付け、CSS が「共有＋コピー」の2点に畳む（progressive enhancement）。
function shareButtons(a) {
  const url = articleUrl(a);
  const text = a.headline || config.siteName;
  const xHref = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
  const lineHref = `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(url)}`;
  const hatebuHref = `https://b.hatena.ne.jp/entry/${encodeURIComponent(url)}`;
  return `            <div class="article-share" aria-label="記事を共有" data-share-url="${esc(url)}" data-share-title="${esc(text)}">
              <a href="${esc(xHref)}" class="share-btn share-btn--x" target="_blank" rel="noopener" aria-label="X で共有">${SHARE_ICONS.x}</a>
              <a href="${esc(lineHref)}" class="share-btn share-btn--line" target="_blank" rel="noopener" aria-label="LINE で送る">${SHARE_ICONS.line}</a>
              <a href="${esc(hatebuHref)}" class="share-btn share-btn--hatebu" target="_blank" rel="noopener" aria-label="はてなブックマークに追加">${SHARE_ICONS.hatebu}</a>
              <button type="button" class="share-btn share-btn--native" data-share-native hidden aria-label="共有">${SHARE_ICONS.share}</button>
              <button type="button" class="share-btn share-btn--copy" data-share-copy aria-label="リンクをコピー" title="リンクをコピー">${SHARE_ICONS.copy}</button>
            </div>`;
}

// ヒーロー画像（実写真があるときのみ）。抽象グラデのフォールバックは出さない。
function heroFigure(a) {
  const img = a.image || {};
  if (!img.imageUrl) return '';
  const isPress = img.kind === 'press';
  const credit = isPress
    ? `${esc(config.pressCreditLabel)}: ${img.creditUrl ? `<a href="${esc(img.creditUrl)}" target="_blank" rel="noopener">${esc(img.credit)}</a>` : esc(img.credit)}`
    : `Photo: <a href="${esc(img.profileUrl)}" target="_blank" rel="noopener">${esc(img.photographer)}</a> / ${esc(img.provider)}（イメージ写真）`;
  const aria = isPress ? `${esc(a.headline)} の関連画像` : `${esc(a.headline)} のイメージ写真`;
  return `      <figure class="article-hero">
        <div class="article-hero__img" role="img" aria-label="${aria}" style="background-image: url('${esc(optimizedUrl(img.imageUrl, 1600))}')"></div>
        <figcaption>${credit}</figcaption>
      </figure>`;
}

// 関連トピック（タグ）
function topics(tags = []) {
  if (!tags.length) return '';
  const lis = tags.map((t) => `          <li><a href="${tagHref(t, BASE)}">${esc(t)}</a></li>`).join('\n');
  return `      <div class="topics">
        <h2 class="topics__head">関連トピック</h2>
        <ul>
${lis}
        </ul>
      </div>`;
}

// 関連記事＝シンプルな行リスト（モザイク・サムネは使わない）。
function relatedList(items) {
  if (!items.length) return '';
  const rows = items.map((a) => `          <li class="feed-item">
            <a class="feed-item__title" href="${esc(a.slug)}.html">${esc(a.headline)}</a>
            <span class="feed-item__cat">${esc(a.section || 'AI')}</span>
          </li>`).join('\n');
  return `      <section class="related" aria-label="関連記事">
        <h2 class="feed__head">あわせて読みたい</h2>
        <ul class="feed-list">
${rows}
        </ul>
      </section>`;
}

// 出典リンクカード（最重要・必ず表示）
function sourceCard(a) {
  return `          <div class="callout">
            <h2 class="callout__head">出典・元記事</h2>
            <p>本記事は下記の一次情報を ${esc(config.siteName)} 編集部が要約・論評したものです。正確な詳細・最新情報は元記事をご確認ください。</p>
            <p class="callout__link"><a href="${esc(a.link)}" target="_blank" rel="noopener">${esc(a.source)} の元記事を読む →</a></p>
          </div>`;
}

export function renderArticle(a, related, dateLabel, index = 0, tickerItems = []) {
  const bodyHtml = mdToHtml(a.body_markdown);

  const main = `  <main class="container container--narrow">

      <nav class="breadcrumb" aria-label="パンくず">
        <ol>
          <li><a href="${BASE}index.html">トップ</a></li>
          <li><a href="${sectionHref(a.section)}">${esc(a.section || 'AI')}</a></li>
          <li aria-current="page">${esc(a.headline)}</li>
        </ol>
      </nav>

      <header class="article-head">
        <div class="article-head__meta">
          ${sectionChip(a.section)}
          <time datetime="${isoDate(a)}">${esc(a.displayDate || '')}${a.displayTime ? ` ${esc(a.displayTime)}` : ''}</time>
          <span>約${readingMinutes(a.body_markdown)}分</span>
          <span>出典: ${esc(a.source)}</span>
        </div>
        <h1 class="article-headline">${esc(a.headline)}</h1>
        <p class="article-lede">${esc(a.lead)}</p>
        <div class="article-byline">
          <span class="article-byline__by">俯瞰 編集部 — AI 自動要約 + 人手編集</span>
${shareButtons(a)}
        </div>
      </header>

${heroFigure(a)}

      <article class="prose">
${bodyHtml}
${sourceCard(a)}
      </article>

${topics(a.tags)}

${relatedList(related)}

  </main>`;

  const canonicalPath = `/articles/${a.slug}.html`;
  const img = a.image?.imageUrl ? optimizedUrl(a.image.imageUrl, 1200) : undefined;
  const jsonLd = {
    '@type': 'NewsArticle',
    headline: a.headline,
    description: a.lead || a.headline,
    datePublished: a.publishedAt || a.createdAt || undefined,
    dateModified: a.createdAt || a.publishedAt || undefined,
    inLanguage: 'ja',
    articleSection: a.section || undefined,
    image: img ? [img] : [absUrl(config.ogImage)],
    mainEntityOfPage: { '@type': 'WebPage', '@id': absUrl(canonicalPath) },
    author: organizationLd(),
    publisher: organizationLd(),
  };

  return page({
    base: BASE,
    title: `${a.headline} | ${esc(config.siteName)}`,
    description: a.lead || a.headline,
    body: `${ticker(tickerItems)}${header(dateLabel, a.section, BASE)}\n\n${main}\n\n${footer(BASE)}`,
    canonicalPath,
    ogType: 'article',
    ogImage: img,
    jsonLd,
  });
}
