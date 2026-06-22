// タグ別の記事一覧ページ（tags/<tag>.html）と全タグ一覧（tags/index.html）。
// 低認知負荷方針：section.js と同じシンプル行リストに統一。
import { ticker, header, footer, page } from './layout.js';
import { esc } from '../src/markdown.js';
import { tagHref } from './cardbits.js';

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

// 単一タグのページ
export function renderTag(tag, articles, dateLabel, tickerItems = []) {
  const main = `  <main class="container container--narrow">

    <nav class="breadcrumb" aria-label="パンくず">
      <ol>
        <li><a href="${BASE}index.html">トップ</a></li>
        <li><a href="${BASE}tags/index.html">タグ</a></li>
        <li aria-current="page">${esc(tag)}</li>
      </ol>
    </nav>

    <header class="page-head">
      <span class="cat">タグ</span>
      <h1 class="page-head__title">#${esc(tag)}</h1>
      <p class="page-head__lead">「${esc(tag)}」に関する AXIOM AI 編集部のニュースと論評。（${articles.length} 記事）</p>
    </header>

    <section class="feed" aria-label="記事一覧">
${feedList(articles)}
    </section>

  </main>`;

  return page({
    base: BASE,
    title: `#${tag} の記事 | AXIOM AI`,
    description: `「${tag}」に関する最新の AI ニュースを AXIOM AI 編集部の要約と論評でお届けします。`,
    body: `${ticker(tickerItems)}${header(dateLabel, '', BASE)}\n\n${main}\n\n${footer(BASE)}`,
    canonicalPath: `/tags/${encodeURIComponent(tag)}.html`,
  });
}

// 全タグ一覧（タグクラウド）。entries = [tag, count][] を件数降順で渡す。
export function renderTagsIndex(entries, dateLabel, tickerItems = []) {
  const max = entries.length ? entries[0][1] : 1;
  const items = entries.map(([tag, count]) => {
    // 件数で文字サイズを段階化（タグクラウド表現）
    const scale = (0.9 + (count / max) * 0.7).toFixed(2);
    return `        <li><a class="tagcloud__item" href="${tagHref(tag, BASE)}" style="font-size: ${scale}rem;">#${esc(tag)} <span class="tagcloud__count">${count}</span></a></li>`;
  }).join('\n');

  const main = `  <main class="container container--narrow">

    <nav class="breadcrumb" aria-label="パンくず">
      <ol>
        <li><a href="${BASE}index.html">トップ</a></li>
        <li aria-current="page">タグ</li>
      </ol>
    </nav>

    <header class="page-head">
      <span class="cat">タグ</span>
      <h1 class="page-head__title">タグ一覧</h1>
      <p class="page-head__lead">記事に付与されたトピックの一覧です。気になるテーマから記事を辿れます。（${entries.length} タグ）</p>
    </header>

    <ul class="tagcloud">
${items}
    </ul>

  </main>`;

  return page({
    base: BASE,
    title: 'タグ一覧 | AXIOM AI',
    description: 'AXIOM AI の記事トピック（タグ）一覧。テーマ別に AI ニュースを辿れます。',
    body: `${ticker(tickerItems)}${header(dateLabel, '', BASE)}\n\n${main}\n\n${footer(BASE)}`,
    canonicalPath: '/tags/index.html',
  });
}
