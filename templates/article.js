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

// 機能する共有ボタン（X / はてブ / リンクコピー）
function shareButtons(a) {
  const url = articleUrl(a);
  const text = a.headline || 'AXIOM AI';
  const xHref = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
  const hatebuHref = `https://b.hatena.ne.jp/entry/${encodeURIComponent(url)}`;
  return `            <div class="article-share" aria-label="記事を共有">
              <a href="${esc(xHref)}" class="share-btn" target="_blank" rel="noopener" aria-label="X で共有">𝕏</a>
              <a href="${esc(hatebuHref)}" class="share-btn" target="_blank" rel="noopener" aria-label="はてなブックマークに追加">B!</a>
              <button type="button" class="share-btn" aria-label="リンクをコピー" onclick="navigator.clipboard&&navigator.clipboard.writeText('${esc(url)}').then(()=>{this.textContent='✓';setTimeout(()=>{this.textContent='⎘'},1200)})">⎘</button>
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
            <p>本記事は下記の一次情報を AXIOM AI 編集部が要約・論評したものです。正確な詳細・最新情報は元記事をご確認ください。</p>
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
          <span class="article-byline__by">AXIOM AI 編集部 — AI 自動要約 + 人手編集</span>
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
    title: `${a.headline} | AXIOM AI`,
    description: a.lead || a.headline,
    body: `${ticker(tickerItems)}${header(dateLabel, a.section, BASE)}\n\n${main}\n\n${footer(BASE)}`,
    canonicalPath,
    ogType: 'article',
    ogImage: img,
    jsonLd,
  });
}
