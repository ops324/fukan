// アーカイブ。記事が増えても1ページが肥大しないよう月別に分割する。
//   /archive.html            … 月インデックス（各月へのリンク＋件数）
//   /archive/YYYY-MM.html     … その月の記事一覧（時系列）
// render.js が effDate(publishedAt??createdAt) で月グルーピングして両者を生成する。
import { ticker, header, footer, page } from './layout.js';
import { esc } from '../src/markdown.js';

// 月別ページ（archive/YYYY-MM.html）。base='../'（1階層下）。
const MONTH_BASE = '../';
const monthHref = (a) => `${MONTH_BASE}articles/${a.slug}.html`;

function listCards(items, href) {
  return items.map((a) => `        <article class="list-card">
          <span class="meta">${esc(a.displayDate || '')}・出典: ${esc(a.source || '')}</span>
          <h3 class="list-card__headline"><a href="${href(a)}">${esc(a.headline)}</a></h3>
          <p class="card__deck" style="color: var(--color-ink-2);">${esc(a.lead || '')}</p>
        </article>`).join('\n\n');
}

// 月インデックス（/archive.html）。groups = [{ ym, label, items }]（新しい月順）。
export function renderArchiveIndex(groups, dateLabel, tickerItems = []) {
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const rows = groups.map((g) => `        <article class="list-card">
          <h3 class="list-card__headline"><a href="archive/${g.ym}.html">${esc(g.label)}</a></h3>
          <p class="card__deck" style="color: var(--color-ink-2);">${g.items.length} 本</p>
        </article>`).join('\n\n');

  const main = `  <main class="container">

    <header class="article-head" style="border:0;">
      <div class="article-head__inner">
        <div class="meta"><span class="chip">アーカイブ</span><span>全 ${total} 記事</span></div>
        <h1 class="article-headline">記事アーカイブ</h1>
        <p class="article-lede">これまでに AXIOM AI 編集部が公開した記事を月別にまとめています。</p>
      </div>
    </header>

    <section class="section" aria-label="月別アーカイブ">
      <div class="section__list">
${rows || '<p style="color: var(--color-ink-2);">まだ記事がありません。</p>'}
      </div>
    </section>

  </main>`;

  return page({
    title: 'アーカイブ | AXIOM AI',
    description: 'AXIOM AI のこれまでの全記事を月別にまとめた一覧。',
    body: `${ticker(tickerItems)}\n\n${header(dateLabel, 'トップ')}\n\n${main}\n\n${footer()}`,
    canonicalPath: '/archive.html',
  });
}

// 月別ページ（/archive/YYYY-MM.html）。group = { ym, label, items }。
export function renderArchiveMonth(group, dateLabel, tickerItems = []) {
  const main = `  <main class="container">

    <nav class="breadcrumb" aria-label="パンくず">
      <ol>
        <li><a href="${MONTH_BASE}index.html">トップ</a></li>
        <li><a href="${MONTH_BASE}archive.html">アーカイブ</a></li>
        <li aria-current="page">${esc(group.label)}</li>
      </ol>
    </nav>

    <header class="article-head" style="border:0;">
      <div class="article-head__inner">
        <div class="meta"><span class="chip">${esc(group.label)}</span><span>${group.items.length} 本</span></div>
        <h1 class="article-headline">${esc(group.label)}の記事</h1>
      </div>
    </header>

    <section class="section" aria-label="${esc(group.label)}の記事">
      <div class="section__list">
${listCards(group.items, monthHref)}
      </div>
    </section>

  </main>`;

  return page({
    base: MONTH_BASE,
    title: `${group.label}の記事 | AXIOM AI`,
    description: `${group.label}に AXIOM AI 編集部が公開した記事の一覧。`,
    body: `${ticker(tickerItems)}\n\n${header(dateLabel, 'アーカイブ', MONTH_BASE)}\n\n${main}\n\n${footer(MONTH_BASE)}`,
    canonicalPath: `/archive/${group.ym}.html`,
  });
}
