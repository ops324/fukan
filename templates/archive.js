// アーカイブページ（archive.html）。全記事を時系列で一覧表示する。
// 既存デザイン（ticker/header/footer/page）と list-card スタイルを流用。
import { ticker, header, footer, page } from './layout.js';
import { esc } from '../src/markdown.js';

const href = (a) => `articles/${a.slug}.html`;

// 年月でグルーピングして見出しを付ける（"2026年6月" 等）
function groupByMonth(articles) {
  const groups = [];
  let cur = null;
  for (const a of articles) {
    const d = a.createdAt ? new Date(a.createdAt) : new Date();
    const key = `${d.getFullYear()}年${d.getMonth() + 1}月`;
    if (!cur || cur.key !== key) { cur = { key, items: [] }; groups.push(cur); }
    cur.items.push(a);
  }
  return groups;
}

export function renderArchive(articles, dateLabel, tickerItems = []) {
  const sections = groupByMonth(articles).map((g) => {
    const rows = g.items.map((a) => `        <article class="list-card">
          <span class="meta">${esc(a.displayDate || '')}・出典: ${esc(a.source || '')}</span>
          <h3 class="list-card__headline"><a href="${href(a)}">${esc(a.headline)}</a></h3>
          <p class="card__deck" style="color: var(--color-ink-2);">${esc(a.lead || '')}</p>
        </article>`).join('\n\n');
    return `    <section class="section" aria-label="${esc(g.key)}">
      <header class="section__head">
        <div class="section__title">
          <span class="chip">${esc(g.key)}</span>
          <h2>${g.items.length} 本</h2>
        </div>
        <a class="section__more" href="index.html">トップに戻る</a>
      </header>
      <div class="section__list">
${rows}
      </div>
    </section>`;
  }).join('\n\n');

  const body = `${ticker(tickerItems)}

${header(dateLabel, 'トップ')}

  <main class="container">

    <header class="article-head" style="border:0;">
      <div class="article-head__inner">
        <div class="meta"><span class="chip">アーカイブ</span><span>全 ${articles.length} 記事</span></div>
        <h1 class="article-headline">記事アーカイブ</h1>
        <p class="article-lede">これまでに AXIOM AI 編集部が公開した全記事の一覧です。</p>
      </div>
    </header>

${sections || '<p style="color: var(--color-ink-2);">まだ記事がありません。</p>'}

  </main>

${footer()}`;

  return page({
    title: 'アーカイブ | AXIOM AI',
    description: 'AXIOM AI のこれまでの全記事一覧。',
    body,
    canonicalPath: '/archive.html',
  });
}
