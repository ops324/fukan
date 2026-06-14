// タグ別の記事一覧ページ（tags/<tag>.html）と全タグ一覧（tags/index.html）。
// section.js と同じカードグリッドを流用する。
import { ticker, header, footer, page } from './layout.js';
import { esc } from '../src/markdown.js';
import { config } from '../src/config.js';
import { thumb, credit, tagHref } from './cardbits.js';

const BASE = '../';
const THUMBS = config.thumbVariants;
const href = (a) => `${BASE}articles/${a.slug}.html`;

function cards(items) {
  const cs = items.map((a, i) => {
    const variant = THUMBS[i % THUMBS.length];
    return `      <article class="card">
        ${thumb(a, variant)}
        <span class="chip">${esc(a.section || 'AI')}</span>
        <h3 class="card__headline"><a href="${href(a)}">${esc(a.headline)}</a></h3>
        <p class="card__deck">${esc(a.lead)}</p>
        <div class="meta">
          <span class="meta__author">AXIOM AI 編集部</span>
          <span>${esc(a.displayDate || '')}</span>
          <span>出典: ${esc(a.source)}</span>
          ${credit(a)}
        </div>
      </article>`;
  }).join('\n\n');
  return `    <section class="cards" aria-label="記事一覧">\n${cs}\n    </section>`;
}

// 単一タグのページ
export function renderTag(tag, articles, dateLabel, tickerItems = []) {
  const main = `  <main class="container">

    <nav class="breadcrumb" aria-label="パンくず">
      <ol>
        <li><a href="${BASE}index.html">トップ</a></li>
        <li><a href="${BASE}tags/index.html">タグ</a></li>
        <li aria-current="page">${esc(tag)}</li>
      </ol>
    </nav>

    <header class="article-head" style="border: 0;">
      <div class="article-head__inner">
        <div class="meta"><span class="chip">タグ</span><span>${articles.length} 記事</span></div>
        <h1 class="article-headline">#${esc(tag)}</h1>
        <p class="article-lede">「${esc(tag)}」に関する AXIOM AI 編集部のニュースと論評。</p>
      </div>
    </header>

${cards(articles)}

  </main>`;

  return page({
    base: BASE,
    title: `#${tag} の記事 | AXIOM AI`,
    description: `「${tag}」に関する最新の AI ニュースを AXIOM AI 編集部の要約と論評でお届けします。`,
    body: `${ticker(tickerItems)}\n\n${header(dateLabel, '', BASE)}\n\n${main}\n\n${footer(BASE)}`,
    canonicalPath: `/tags/${encodeURIComponent(tag)}.html`,
  });
}

// 全タグ一覧（タグクラウド）。entries = [tag, count][] を件数降順で渡す。
export function renderTagsIndex(entries, dateLabel, tickerItems = []) {
  const max = entries.length ? entries[0][1] : 1;
  const items = entries.map(([tag, count]) => {
    // 件数で文字サイズを段階化（タグクラウド表現）
    const scale = (0.85 + (count / max) * 0.9).toFixed(2);
    return `        <li><a class="tagcloud__item" href="${tagHref(tag, BASE)}" style="font-size: ${scale}rem;">#${esc(tag)} <span class="tagcloud__count">${count}</span></a></li>`;
  }).join('\n');

  const main = `  <main class="container">

    <nav class="breadcrumb" aria-label="パンくず">
      <ol>
        <li><a href="${BASE}index.html">トップ</a></li>
        <li aria-current="page">タグ</li>
      </ol>
    </nav>

    <header class="article-head" style="border: 0;">
      <div class="article-head__inner">
        <div class="meta"><span class="chip">タグ</span><span>${entries.length} タグ</span></div>
        <h1 class="article-headline">タグ一覧</h1>
        <p class="article-lede">記事に付与されたトピックの一覧です。気になるテーマから記事を辿れます。</p>
      </div>
    </header>

    <ul class="tagcloud">
${items}
    </ul>

  </main>`;

  return page({
    base: BASE,
    title: 'タグ一覧 | AXIOM AI',
    description: 'AXIOM AI の記事トピック（タグ）一覧。テーマ別に AI ニュースを辿れます。',
    body: `${ticker(tickerItems)}\n\n${header(dateLabel, '', BASE)}\n\n${main}\n\n${footer(BASE)}`,
    canonicalPath: '/tags/index.html',
  });
}
