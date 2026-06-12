// トップページ。articles（新しい順）から既存デザインのヒーロー/カード/リストを再現。
// 一覧のサムネは著作権配慮で CSS抽象サムネを使用（実写真は記事詳細で帰属付き表示）。
import { ticker, header, footer, page } from './layout.js';
import { esc } from '../src/markdown.js';
import { config } from '../src/config.js';

const THUMBS = config.thumbVariants;
const href = (a) => `articles/${a.slug}.html`;

// 実写真があれば背景画像のサムネ、無ければ CSS 抽象サムネ
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
            <span class="chip">人気記事 24h</span>
          </header>
          <ol class="ranked">
${lis}
          </ol>
        </div>`;
}

// featured = 重要度順（ヒーロー/カード/人気用）、latest = 時系列（最新記事リスト用）
export function renderIndex(featured, latest, dateLabel, archiveCount = 0) {
  const lead = featured[0];
  const side = featured.slice(1, 5);
  const cardItems = featured.slice(5, 8);
  // 「最新記事」は時系列。ヒーロー/カードで既出の上位8本は除外して重複を避ける。
  const featuredSlugs = new Set(featured.slice(0, 8).map((a) => a.slug));
  const listItems = latest.filter((a) => !featuredSlugs.has(a.slug));
  const archiveHref = archiveCount > 0 ? 'archive.html' : '#';
  const breaking = lead ? `${esc(lead.headline)}` : 'AXIOM AI — 最新のAIニュースを編集部がお届けします。';

  const body = `${ticker}

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

    <!-- ============== AD: LEADERBOARD ============== -->
    <div class="ad ad--leaderboard" role="complementary" aria-label="広告枠">
      <div class="ad__inner">
        <span>Advertisement · 970 × 90</span>
        <span style="color: var(--color-ink-3);">Google AdSense / 直接広告プレースホルダ</span>
      </div>
    </div>

    <!-- ============== 最新記事 + サイドバー ============== -->
    <div class="section" style="display: grid; grid-template-columns: 8fr 4fr; gap: var(--space-2xl); align-items: start;">
      <div>
${latestList(listItems, archiveHref) || '<p style="color: var(--color-ink-2);">記事が増えるとここに一覧が表示されます。</p>'}
      </div>
      <aside style="display: grid; gap: var(--space-xl);">
${ranked(featured.slice(0, 5))}
        <div class="ad ad--rectangle">
          <div class="ad__inner">
            <span>Advertisement · 300 × 250</span>
            <span style="color: var(--color-ink-3);">サイドバー広告</span>
          </div>
        </div>
      </aside>
    </div>

  </main>

${footer}`;

  return page({
    title: 'AXIOM AI — 信頼できるAIインテリジェンス・デイリー',
    description: '生成AI・基盤モデル・規制・産業応用に関する最新情報を、編集部の要約と論評でお届けします。',
    body,
  });
}
