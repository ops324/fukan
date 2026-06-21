// トップページ。articles（新しい順）から既存デザインのヒーロー/カード/リストを再現。
// ヒーロー/カードは実写真（Unsplash・帰属付き）があれば表示、無ければ CSS抽象サムネにフォールバック。
import { ticker, header, footer, page, organizationLd } from './layout.js';
import { esc } from '../src/markdown.js';
import { config } from '../src/config.js';
import { thumb, priorityClass, sectionChip } from './cardbits.js';

const THUMBS = config.thumbVariants;
const href = (a) => `articles/${a.slug}.html`;

function relTime(a) {
  return esc(a.displayTime || a.section || '');
}

function heroLead(a) {
  if (!a) return '';
  return `        <article class="hero__lead">
          ${thumb(a, THUMBS[0], href(a))}
          <div>
            <div class="meta" style="margin-bottom: var(--space-md);">
              ${sectionChip(a.section)}
              <span>${esc(a.displayDate || '')}</span>
            </div>
            <h1 class="hero__headline">
              <a href="${href(a)}">${esc(a.headline)}</a>
            </h1>
            <p class="hero__deck">${esc(a.lead)}</p>
            <div class="meta" style="margin-top: var(--space-md);">
              <span class="meta__author">AXIOM AI 編集部</span>
              <span>出典: ${esc(a.source)}</span>
            </div>
          </div>
        </article>`;
}

function heroSide(items) {
  const blocks = items.map((a) => {
    return `          <div class="hero__side-item">
            ${sectionChip(a.section)}
            <h3><a href="${href(a)}">${esc(a.headline)}</a></h3>
            <div class="meta">
              <span>${relTime(a)}</span>
              <span>出典: ${esc(a.source)}</span>
            </div>
          </div>`;
  }).join('\n\n');
  return `        <aside class="hero__side">\n\n${blocks}\n\n        </aside>`;
}

// 注目記事（importance順）。画像つきカードのモザイク。可視見出し付きの .section で包む。
function featuredCards(items) {
  if (!items.length) return '';
  const cs = items.map((a, i) => {
    const variant = THUMBS[(i + 1) % THUMBS.length];
    return `        <article class="card${priorityClass(a)}">
          ${thumb(a, variant, href(a))}
          ${sectionChip(a.section)}
          <h3 class="card__headline"><a href="${href(a)}">${esc(a.headline)}</a></h3>
          <p class="card__deck">${esc(a.lead)}</p>
          <div class="meta">
            <span class="meta__author">AXIOM AI 編集部</span>
            <span>出典: ${esc(a.source)}</span>
          </div>
        </article>`;
  }).join('\n\n');
  return `    <section class="section" aria-label="注目記事">
      <header class="section__head">
        <div class="section__title">
          <span class="chip">FEATURED · 編集部が選ぶ</span>
          <h2>注目記事</h2>
        </div>
      </header>
      <div class="cards">
${cs}
      </div>
    </section>`;
}

// 出典発行日時（無ければ取り込み時刻）の ISO 文字列。<time datetime> 用（a11y）。
function isoDate(a) {
  const src = a.publishedAt || a.createdAt;
  if (!src) return '';
  const d = new Date(src);
  return Number.isNaN(d.getTime()) ? '' : esc(d.toISOString());
}

// 最新記事＝時系列タイムライン。displayDate で日グループ化し、各行は「時刻｜chip＋見出し＋1行deck」。
// items は recency降順・decorate済み（render が渡す universe ベース）。
function timeline(items, moreHref = '#') {
  if (!items.length) return '';
  const groups = [];
  for (const a of items) {
    const day = a.displayDate || '';
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(a);
    else groups.push({ day, items: [a] });
  }
  const groupHtml = groups.map((g) => {
    const rows = g.items.map((a) => `          <article class="timeline__row${priorityClass(a)}">
            <time class="timeline__time" datetime="${isoDate(a)}">${esc(a.displayTime || '')}</time>
            <div class="timeline__body">
              ${sectionChip(a.section)}
              <h3 class="timeline__headline"><a href="${href(a)}">${esc(a.headline)}</a></h3>
              <p class="timeline__deck">${esc(a.lead)}</p>
            </div>
          </article>`).join('\n');
    return `        <div class="timeline__day">
          <span class="timeline__daylabel">${esc(g.day)}</span>
${rows}
        </div>`;
  }).join('\n\n');
  const more = moreHref !== '#' ? `<a class="section__more" href="${moreHref}">アーカイブ</a>` : '';
  return `      <header class="section__head">
        <div class="section__title">
          <span class="chip">セクション</span>
          <h2>最新記事</h2>
        </div>
        ${more}
      </header>
      <div class="timeline">
${groupHtml}
      </div>`;
}

// 右レール＝セクション別の最新ナビ。navSections 順に各セクションの最新1本を出す（回遊の道標）。
// 既出（ヒーロー/注目カード）の slug は除外し、レールを完全に additive にする。
function sectionNav(latest, excludeSlugs) {
  const newest = new Map();
  for (const a of latest) {
    if (excludeSlugs.has(a.slug)) continue;
    if (!newest.has(a.section)) newest.set(a.section, a);
  }
  const rows = config.navSections
    .map((s) => newest.get(s.name))
    .filter(Boolean)
    .map((a) => `          <div class="section-nav__item">
            ${sectionChip(a.section)}
            <h3><a href="${href(a)}">${esc(a.headline)}</a></h3>
            <time class="meta" datetime="${isoDate(a)}">${relTime(a)}</time>
          </div>`).join('\n\n');
  if (!rows) return '';
  return `        <header class="section-nav__head">
          <h2>セクション別の最新</h2>
        </header>
${rows}`;
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

${featuredCards(cardItems)}

    <!-- ============== 最新記事（タイムライン） + セクション別ナビ ============== -->
    <section class="section" aria-label="最新記事">
      <div class="home-feed">
        <div>
${timeline(listItems, archiveHref) || '<p style="color: var(--color-ink-2);">記事が増えるとここに一覧が表示されます。</p>'}
        </div>
        <aside class="section-nav">
${sectionNav(latest, featuredSlugs)}
        </aside>
      </div>
    </section>

    <!-- ============== RSS 購読 ============== -->
    <section class="section">
      <div class="newsletter" style="text-align: center; max-width: 720px; margin: 0 auto;">
        <span class="newsletter__eyebrow">Stay Updated</span>
        <h3>最新の AI ニュースを購読</h3>
        <p>Feedly などの<strong>フィードリーダー</strong>に RSS を登録すると、新着記事を自動で受け取れます。無料・登録不要。</p>
        <p style="margin-top: var(--space-lg);">
          <a class="btn btn--primary" href="feed.xml">RSS で購読（リーダー用）</a>
        </p>
        <p style="font-size: var(--text-xs); color: var(--color-ink-2); margin-top: var(--space-sm);">※ リンク先はRSS用のページです。記事を読むにはトップや各記事をご利用ください。</p>
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
