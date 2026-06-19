// セクション別の記事一覧ページ（sections/<slug>.html）。
// articles は render.js 側で「当該セクション・重要度→新着順・decorate済み」を渡す。
import { ticker, header, footer, page } from './layout.js';
import { esc } from '../src/markdown.js';
import { config } from '../src/config.js';
import { thumb, sectionChip } from './cardbits.js';

const BASE = '../';
const THUMBS = config.thumbVariants;
const href = (a) => `${BASE}articles/${a.slug}.html`;

function cards(items) {
  const cs = items.map((a, i) => {
    const variant = THUMBS[i % THUMBS.length];
    return `      <article class="card">
        ${thumb(a, variant, href(a))}
        ${sectionChip(a.section)}
        <h3 class="card__headline"><a href="${href(a)}">${esc(a.headline)}</a></h3>
        <p class="card__deck">${esc(a.lead)}</p>
        <div class="meta">
          <span class="meta__author">AXIOM AI 編集部</span>
          <span>${esc(a.displayDate || '')}</span>
          <span>出典: ${esc(a.source)}</span>
        </div>
      </article>`;
  }).join('\n\n');
  return `    <section class="cards" aria-label="記事一覧">\n${cs}\n    </section>`;
}

export function renderSection(name, slug, articles, dateLabel, tickerItems = []) {
  const empty = `    <p style="color: var(--color-ink-2); padding: var(--space-2xl) 0;">このセクションの記事はまだありません。次の自動更新で追加され次第ここに表示されます。</p>`;

  const main = `  <main class="container">

    <header class="article-head" style="border: 0;">
      <div class="article-head__inner">
        <div class="meta"><span class="chip">セクション</span><span>${articles.length} 記事</span></div>
        <h1 class="article-headline">${esc(name)}</h1>
        <p class="article-lede">${esc(name)} に関する AXIOM AI 編集部のニュースと論評。</p>
      </div>
    </header>

${articles.length ? cards(articles) : empty}

  </main>`;

  return page({
    base: BASE,
    title: `${name} | AXIOM AI`,
    description: `${name} に関する最新の AI ニュースを AXIOM AI 編集部の要約と論評でお届けします。`,
    body: `${ticker(tickerItems)}\n\n${header(dateLabel, name, BASE)}\n\n${main}\n\n${footer(BASE)}`,
    canonicalPath: `/sections/${slug}.html`,
  });
}
