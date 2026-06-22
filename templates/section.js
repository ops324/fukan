// セクション別の記事一覧ページ（sections/<slug>.html）。
// 低認知負荷方針：カードモザイク（サムネ）を廃し、トップと同じシンプル行リストに統一。
import { ticker, header, footer, page } from './layout.js';
import { esc } from '../src/markdown.js';

const BASE = '../';
const href = (a) => `${BASE}articles/${a.slug}.html`;

function isoDate(a) {
  const src = a.publishedAt || a.createdAt;
  if (!src) return '';
  const d = new Date(src);
  return Number.isNaN(d.getTime()) ? '' : esc(d.toISOString());
}

function feedList(items) {
  const rows = items.map((a) => `        <li class="feed-item">
          <time class="feed-item__time" datetime="${isoDate(a)}">${esc(a.displayDate || '')}</time>
          <a class="feed-item__title" href="${href(a)}">${esc(a.headline)}</a>
          <span class="feed-item__cat">出典: ${esc(a.source)}</span>
        </li>`).join('\n');
  return `      <ul class="feed-list">\n${rows}\n      </ul>`;
}

export function renderSection(name, slug, articles, dateLabel, tickerItems = []) {
  const empty = `      <p class="feed__empty">このセクションの記事はまだありません。次の自動更新で追加され次第ここに表示されます。</p>`;

  const main = `  <main class="container container--narrow">

    <header class="page-head">
      <span class="cat">セクション</span>
      <h1 class="page-head__title">${esc(name)}</h1>
      <p class="page-head__lead">${esc(name)} に関する AXIOM AI 編集部のニュースと論評。（${articles.length} 記事）</p>
    </header>

    <section class="feed" aria-label="記事一覧">
${articles.length ? feedList(articles) : empty}
    </section>

  </main>`;

  return page({
    base: BASE,
    title: `${name} | AXIOM AI`,
    description: `${name} に関する最新の AI ニュースを AXIOM AI 編集部の要約と論評でお届けします。`,
    body: `${ticker(tickerItems)}${header(dateLabel, name, BASE)}\n\n${main}\n\n${footer(BASE)}`,
    canonicalPath: `/sections/${slug}.html`,
  });
}
