// 記事詳細ページ。articles/<slug>.html に出力するため base='../'。
// 実写真は規約準拠の帰属付きで表示。出典リンクカードを目立つ位置に必ず置く。
import { ticker, header, footer, page } from './layout.js';
import { mdToHtml, esc } from '../src/markdown.js';
import { config } from '../src/config.js';

const BASE = '../';

// 実写真があれば背景画像サムネ、無ければ CSS 抽象サムネ
function thumb(a, variant) {
  const img = a.image || {};
  if (img.imageUrl) {
    return `<figure class="thumb" style="background-image: url('${esc(img.imageUrl)}'); background-size: cover; background-position: center;" aria-hidden="true"></figure>`;
  }
  return `<figure class="thumb ${variant}" aria-hidden="true"></figure>`;
}

// Unsplash 規約準拠の帰属（実写真のときのみ）
function credit(a) {
  const img = a.image || {};
  if (!img.imageUrl) return '';
  return `<span style="color: var(--color-ink-3); font-size: var(--text-xs);">Photo: <a href="${esc(img.profileUrl)}" target="_blank" rel="noopener">${esc(img.photographer)}</a> / ${esc(img.provider)}</span>`;
}

function heroFigure(a, index = 0) {
  const img = a.image || {};
  if (img.imageUrl) {
    const credit = `Photo: <a href="${esc(img.profileUrl)}" target="_blank" rel="noopener">${esc(img.photographer)}</a> / ${esc(img.provider)}`;
    return `      <figure class="article-hero">
        <div class="thumb" style="aspect-ratio: 21 / 9; background-image: url('${esc(img.imageUrl)}'); background-size: cover; background-position: center;"></div>
        <figcaption>${esc(a.headline)}<span style="color: var(--color-ink-3);"> — ${credit}（本文と直接の関係はないイメージ画像）</span></figcaption>
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
  const lis = tags.map((t) => `              <li><a href="#">${esc(t)}</a></li>`).join('\n');
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

export function renderArticle(a, related, dateLabel, index = 0) {
  const bodyHtml = mdToHtml(a.body_markdown);

  const main = `  <main>
    <div class="container">

      <nav class="breadcrumb" aria-label="パンくず">
        <ol>
          <li><a href="${BASE}index.html">トップ</a></li>
          <li><a href="#">${esc(a.section || 'AI')}</a></li>
          <li aria-current="page">${esc(a.headline)}</li>
        </ol>
      </nav>

      <header class="article-head">
        <div class="article-head__inner">
          <div class="meta">
            <span class="chip">${esc(a.section || 'AI')}</span>
            <span>${esc(a.displayDate || '')}</span>
            <span>出典: ${esc(a.source)}</span>
          </div>
          <h1 class="article-headline">${esc(a.headline)}</h1>
          <p class="article-lede">${esc(a.lead)}</p>
          <div class="article-byline">
            <span>署名 <strong>AXIOM AI 編集部</strong></span>
            <span>AI 自動要約 + 編集</span>
            <div class="article-share" aria-label="記事を共有">
              <a href="#" class="share-btn" aria-label="X で共有">𝕏</a>
              <a href="#" class="share-btn" aria-label="LinkedIn で共有">in</a>
              <a href="#" class="share-btn" aria-label="リンクをコピー">⎘</a>
            </div>
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

  return page({
    base: BASE,
    title: `${a.headline} | AXIOM AI`,
    description: a.lead || a.headline,
    body: `${ticker}\n\n${header(dateLabel, a.section, BASE)}\n\n${main}\n\n${footer}`,
  });
}
