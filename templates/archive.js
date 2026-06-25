// アーカイブ。記事が増えても1ページが肥大しないよう月別に分割する。
//   /archive.html            … 月インデックス（各月へのリンク＋件数）
//   /archive/YYYY-MM.html     … その月の記事一覧（時系列）
// 低認知負荷方針：シンプル行リストに統一。
import { ticker, header, footer, page } from './layout.js';
import { esc } from '../src/markdown.js';
import { config } from '../src/config.js';

const MONTH_BASE = '../';
const monthHref = (a) => `${MONTH_BASE}articles/${a.slug}.html`;

function isoDate(a) {
  const src = a.publishedAt || a.createdAt;
  if (!src) return '';
  const d = new Date(src);
  return Number.isNaN(d.getTime()) ? '' : esc(d.toISOString());
}

function feedList(items, href) {
  const rows = items.map((a) => `        <li class="feed-item">
          <time class="feed-item__time" datetime="${isoDate(a)}">${esc(a.displayDate || '')}</time>
          <a class="feed-item__title" href="${href(a)}">${esc(a.headline)}</a>
          <span class="feed-item__cat">出典: ${esc(a.source || '')}</span>
        </li>`).join('\n');
  return `      <ul class="feed-list">\n${rows}\n      </ul>`;
}

// 月インデックス（/archive.html）。groups = [{ ym, label, items }]（新しい月順）。
export function renderArchiveIndex(groups, dateLabel, tickerItems = []) {
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const rows = groups.map((g) => `        <li class="feed-item">
          <a class="feed-item__title" href="archive/${g.ym}.html">${esc(g.label)}</a>
          <span class="feed-item__cat">${g.items.length} 本</span>
        </li>`).join('\n');

  const main = `  <main class="container container--narrow">

    <header class="page-head">
      <span class="cat">アーカイブ</span>
      <h1 class="page-head__title">記事アーカイブ</h1>
      <p class="page-head__lead">これまでに ${esc(config.siteName)} 編集部が公開した記事を月別にまとめています。（全 ${total} 記事）</p>
    </header>

    <section class="feed" aria-label="月別アーカイブ">
      <ul class="feed-list">
${rows || '<li class="feed__empty">まだ記事がありません。</li>'}
      </ul>
    </section>

  </main>`;

  return page({
    title: `アーカイブ | ${esc(config.siteName)}`,
    description: `${esc(config.siteName)} のこれまでの全記事を月別にまとめた一覧。`,
    body: `${ticker(tickerItems)}${header(dateLabel, 'トップ')}\n\n${main}\n\n${footer()}`,
    canonicalPath: '/archive.html',
  });
}

// 月別ページ（/archive/YYYY-MM.html）。group = { ym, label, items }。
export function renderArchiveMonth(group, dateLabel, tickerItems = []) {
  const main = `  <main class="container container--narrow">

    <nav class="breadcrumb" aria-label="パンくず">
      <ol>
        <li><a href="${MONTH_BASE}index.html">トップ</a></li>
        <li><a href="${MONTH_BASE}archive.html">アーカイブ</a></li>
        <li aria-current="page">${esc(group.label)}</li>
      </ol>
    </nav>

    <header class="page-head">
      <span class="cat">${esc(group.label)}</span>
      <h1 class="page-head__title">${esc(group.label)}の記事</h1>
      <p class="page-head__lead">${group.items.length} 本</p>
    </header>

    <section class="feed" aria-label="${esc(group.label)}の記事">
${feedList(group.items, monthHref)}
    </section>

  </main>`;

  return page({
    base: MONTH_BASE,
    title: `${group.label}の記事 | ${esc(config.siteName)}`,
    description: `${group.label}に ${esc(config.siteName)} 編集部が公開した記事の一覧。`,
    body: `${ticker(tickerItems)}${header(dateLabel, 'アーカイブ', MONTH_BASE)}\n\n${main}\n\n${footer(MONTH_BASE)}`,
    canonicalPath: `/archive/${group.ym}.html`,
  });
}
