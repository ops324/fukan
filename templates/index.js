// トップページ。articles（新しい順）から既存デザインのヒーロー/カード/リストを再現。
// ヒーロー/カードは実写真（Unsplash・帰属付き）があれば表示、無ければ CSS抽象サムネにフォールバック。
import { ticker, header, footer, page, organizationLd } from './layout.js';
import { esc } from '../src/markdown.js';
import { config } from '../src/config.js';
import { thumb, credit } from './cardbits.js';

const THUMBS = config.thumbVariants;
const href = (a) => `articles/${a.slug}.html`;

function relTime(a) {
  return esc(a.displayTime || a.section || '');
}

function heroLead(a) {
  if (!a) return '';
  return `        <article class="hero__lead">
          ${thumb(a, THUMBS[0])}
          <div>
            <div class="meta" style="margin-bottom: var(--space-md);">
              <span class="chip">${esc(a.section || 'AI')}</span>
              <span>${esc(a.displayDate || '')}</span>
            </div>
            <h1 class="hero__headline">
              <a href="${href(a)}">${esc(a.headline)}</a>
            </h1>
            <p class="hero__deck">${esc(a.lead)}</p>
            <div class="meta" style="margin-top: var(--space-md);">
              <span class="meta__author">AXIOM AI 編集部</span>
              <span>出典: ${esc(a.source)}</span>
              ${credit(a)}
            </div>
          </div>
        </article>`;
}

function heroSide(items) {
  const blocks = items.map((a, i) => {
    const warm = i % 2 === 1 ? ' chip--warm' : '';
    return `          <div class="hero__side-item">
            <span class="chip${warm}">${esc(a.section || 'AI')}</span>
            <h3><a href="${href(a)}">${esc(a.headline)}</a></h3>
            <div class="meta">
              <span>${relTime(a)}</span>
              <span>出典: ${esc(a.source)}</span>
            </div>
          </div>`;
  }).join('\n\n');
  return `        <aside class="hero__side">\n\n${blocks}\n\n        </aside>`;
}

function cards(items) {
  if (!items.length) return '';
  const cs = items.map((a, i) => {
    const variant = THUMBS[(i + 1) % THUMBS.length];
    return `      <article class="card">
        ${thumb(a, variant)}
        <span class="chip">${esc(a.section || 'AI')}</span>
        <h3 class="card__headline"><a href="${href(a)}">${esc(a.headline)}</a></h3>
        <p class="card__deck">${esc(a.lead)}</p>
        <div class="meta">
          <span class="meta__author">AXIOM AI 編集部</span>
          <span>出典: ${esc(a.source)}</span>
          ${credit(a)}
        </div>
      </article>`;
  }).join('\n\n');
  return `    <section class="cards" aria-label="注目ストーリー">\n${cs}\n    </section>`;
}

function latestList(items, moreHref = '#') {
  if (!items.length) return '';
  const rows = items.map((a) => `        <article class="list-card">
          <span class="meta">${esc(a.displayDate || '')}</span>
          <h3 class="list-card__headline"><a href="${href(a)}">${esc(a.headline)}</a></h3>
          <p class="card__deck" style="color: var(--color-ink-2);">${esc(a.lead)}</p>
        </article>`).join('\n\n');
  const more = moreHref !== '#' ? `<a class="section__more" href="${moreHref}">アーカイブ</a>` : '';
  return `    <section class="section" aria-label="最新記事">
      <header class="section__head">
        <div class="section__title">
          <span class="chip">セクション</span>
          <h2>最新記事</h2>
        </div>
        ${more}
      </header>
      <div class="section__list">
${rows}
      </div>
    </section>`;
}

function ranked(items) {
  const lis = items.map((a) => `            <li class="ranked__item">
              <div>
                <h4><a href="${href(a)}">${esc(a.headline)}</a></h4>
                <div class="meta"><span>${esc(a.section || 'AI')}</span><span>${relTime(a)}</span></div>
              </div>
            </li>`).join('\n');
  return `        <div>
          <header style="margin-bottom: var(--space-md);">
            <span class="chip">注目の記事</span>
          </header>
          <ol class="ranked">
${lis}
          </ol>
        </div>`;
}

// featured = 重要度順（ヒーロー/カード/人気用）、latest = 時系列（最新記事リスト用）
export function renderIndex(featured, latest, dateLabel, archiveCount = 0, tickerItems = []) {
  const lead = featured[0];
  const side = featured.slice(1, 5);
  const cardItems = featured.slice(5, 8);
  // 「最新記事」は時系列。ヒーロー/カードで既出の上位8本は除外して重複を避ける。
  const featuredSlugs = new Set(featured.slice(0, 8).map((a) => a.slug));
  const listItems = latest.filter((a) => !featuredSlugs.has(a.slug));
  const archiveHref = archiveCount > 0 ? 'archive.html' : '#';
  const breaking = lead ? `${esc(lead.headline)}` : 'AXIOM AI — 最新のAIニュースを編集部がお届けします。';

  const body = `${ticker(tickerItems)}

${header(dateLabel, 'トップ')}

  <!-- ============== BREAKING ============== -->
  <div class="breaking">
    <div class="container breaking__inner">
      <span class="breaking__tag">速報</span>
      <span class="breaking__text">${breaking}</span>
      <span class="breaking__time">最新</span>
    </div>
  </div>

  <main class="container">

    <!-- ============== HERO ============== -->
    <section class="hero">
      <div class="hero__grid">

${heroLead(lead)}

${heroSide(side)}
      </div>
    </section>

${cards(cardItems)}

    <!-- ============== 最新記事 + サイドバー ============== -->
    <div class="section" style="display: grid; grid-template-columns: 8fr 4fr; gap: var(--space-2xl); align-items: start;">
      <div>
${latestList(listItems, archiveHref) || '<p style="color: var(--color-ink-2);">記事が増えるとここに一覧が表示されます。</p>'}
      </div>
      <aside style="display: grid; gap: var(--space-xl);">
${ranked(featured.slice(0, 5))}
      </aside>
    </div>

    <!-- ============== RSS 購読 ============== -->
    <section class="section">
      <div class="newsletter" style="text-align: center; max-width: 720px; margin: 0 auto;">
        <span class="newsletter__eyebrow">Stay Updated</span>
        <h3>最新の AI ニュースを購読</h3>
        <p>RSS フィードを登録すると、AXIOM AI の新着記事をお使いのフィードリーダーで受け取れます。無料・登録不要。</p>
        <p style="margin-top: var(--space-lg);">
          <a class="btn btn--primary" href="feed.xml">RSS フィードを開く</a>
        </p>
      </div>
    </section>

  </main>

${footer()}`;

  const jsonLd = [
    {
      '@type': 'WebSite',
      name: config.siteName,
      url: config.siteUrl,
      description: config.siteDescription,
      inLanguage: 'ja',
      potentialAction: {
        '@type': 'SearchAction',
        target: `${config.siteUrl}/?q={search_term_string}`,
        'query-input': 'required name=search_term_string',
      },
    },
    organizationLd(),
  ];

  return page({
    title: 'AXIOM AI — 信頼できるAIインテリジェンス・デイリー',
    description: '生成AI・基盤モデル・規制・産業応用に関する最新情報を、編集部の要約と論評でお届けします。',
    body,
    canonicalPath: '/',
    ogType: 'website',
    jsonLd,
  });
}
