// 記事詳細ページ。articles/<slug>.html に出力するため base='../'。
// 実写真は規約準拠の帰属付きで表示。出典リンクカードを目立つ位置に必ず置く。
import { ticker, header, footer, page, organizationLd, absUrl } from './layout.js';
import { mdToHtml, esc } from '../src/markdown.js';
import { config } from '../src/config.js';
import { thumb, credit, tagHref, optimizedUrl } from './cardbits.js';

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

function heroFigure(a, index = 0) {
  const img = a.image || {};
  if (img.imageUrl) {
    const credit = `Photo: <a href="${esc(img.profileUrl)}" target="_blank" rel="noopener">${esc(img.photographer)}</a> / ${esc(img.provider)}`;
    return `      <figure class="article-hero">
        <div class="thumb" role="img" aria-label="${esc(a.headline)} のイメージ写真" style="aspect-ratio: 21 / 9; background-image: url('${esc(optimizedUrl(img.imageUrl, 1600))}'); background-size: cover; background-position: center;"></div>
        <figcaption>${esc(a.headline)}<span style="color: var(--color-ink-2);"> — ${credit}（イメージ写真）</span></figcaption>
      </figure>`;
  }
  const variant = img.fallbackThumb || config.thumbVariants[index % config.thumbVariants.length];
  return `      <figure class="article-hero">
        <div class="thumb ${variant}" style="aspect-ratio: 21 / 9;"></div>
        <figcaption>編集部によるイメージ（抽象表現）。</figcaption>
      </figure>`;
}

function topics(tags = []) {
  if (!tags.length) return '';
  const lis = tags.map((t) => `              <li><a href="${tagHref(t, BASE)}">${esc(t)}</a></li>`).join('\n');
  return `          <div class="topics">
            <h4>関連トピック</h4>
            <ul>
${lis}
            </ul>
          </div>`;
}

function relatedCards(items) {
  if (!items.length) return '';
  const variants = ['thumb--rose', 'thumb--teal', 'thumb--amber'];
  const cs = items.map((a, i) => `          <article class="card">
            ${thumb(a, variants[i % variants.length])}
            <span class="chip">${esc(a.section || 'AI')}</span>
            <h3 class="card__headline"><a href="${esc(a.slug)}.html">${esc(a.headline)}</a></h3>
            <p class="card__deck">${esc(a.lead)}</p>
            <div class="meta"><span class="meta__author">AXIOM AI 編集部</span><span>出典: ${esc(a.source)}</span>${credit(a)}</div>
          </article>`).join('\n\n');
  return `      <section class="section" aria-label="関連記事">
        <header class="section__head">
          <div class="section__title">
            <span class="chip">関連</span>
            <h2>あわせて読みたい</h2>
          </div>
          <a class="section__more" href="${BASE}index.html">トップに戻る</a>
        </header>
        <div class="cards">
${cs}
        </div>
      </section>`;
}

// 出典リンクカード（最重要・必ず表示）
function sourceCard(a) {
  return `          <div class="callout" style="border-color: var(--color-accent);">
            <h4>出典・元記事</h4>
            <p>本記事は下記の一次情報を AXIOM AI 編集部が要約・論評したものです。正確な詳細・最新情報は元記事をご確認ください。</p>
            <p style="margin-top: var(--space-sm);">
              <a href="${esc(a.link)}" target="_blank" rel="noopener" style="font-weight: 600;">▶ ${esc(a.source)} の元記事を読む</a>
            </p>
          </div>`;
}

export function renderArticle(a, related, dateLabel, index = 0, tickerItems = []) {
  const bodyHtml = mdToHtml(a.body_markdown);

  const main = `  <main>
    <div class="container">

      <nav class="breadcrumb" aria-label="パンくず">
        <ol>
          <li><a href="${BASE}index.html">トップ</a></li>
          <li><a href="${sectionHref(a.section)}">${esc(a.section || 'AI')}</a></li>
          <li aria-current="page">${esc(a.headline)}</li>
        </ol>
      </nav>

      <header class="article-head">
        <div class="article-head__inner">
          <div class="meta">
            <span class="chip">${esc(a.section || 'AI')}</span>
            <span>${esc(a.displayDate || '')}${a.displayTime ? ` ${esc(a.displayTime)}` : ''}</span>
            <span>約${readingMinutes(a.body_markdown)}分で読めます</span>
            <span>出典: ${esc(a.source)}</span>
          </div>
          <h1 class="article-headline">${esc(a.headline)}</h1>
          <p class="article-lede">${esc(a.lead)}</p>
          <div class="article-byline">
            <span>署名 <strong>AXIOM AI 編集部</strong></span>
            <span>AI 自動要約 + 編集</span>
${shareButtons(a)}
          </div>
        </div>
      </header>

${heroFigure(a, index)}

      <div class="article-body-grid">

        <aside class="article-side-left">
          <div class="author-card">
            <div class="author-card__avatar" aria-hidden="true"></div>
            <span class="author-card__name">AXIOM AI 編集部</span>
            <span class="author-card__role">AI 自動要約 + 人手編集</span>
            <p style="font-size: var(--text-xs); color: var(--color-ink-2); margin-top: var(--space-xs); line-height: 1.55;">本記事は AI が一次情報を取材・要約・論評し、編集方針に沿って生成しています。</p>
          </div>
        </aside>

        <article class="prose">
${bodyHtml}
${sourceCard(a)}
        </article>

        <aside class="article-side-right">
${topics(a.tags)}
        </aside>
      </div>

${relatedCards(related)}

    </div>
  </main>`;

  const canonicalPath = `/articles/${a.slug}.html`;
  const img = a.image?.imageUrl ? optimizedUrl(a.image.imageUrl, 1200) : undefined;
  const jsonLd = {
    '@type': 'NewsArticle',
    headline: a.headline,
    description: a.lead || a.headline,
    datePublished: a.createdAt || undefined,
    dateModified: a.createdAt || undefined,
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
    body: `${ticker(tickerItems)}\n\n${header(dateLabel, a.section, BASE)}\n\n${main}\n\n${footer(BASE)}`,
    canonicalPath,
    ogType: 'article',
    ogImage: img,
    jsonLd,
  });
}
