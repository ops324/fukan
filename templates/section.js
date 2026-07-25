// セクション別の記事一覧ページ（sections/<slug>.html）。
// 低認知負荷方針：カードモザイク（サムネ）を廃し、トップと同じシンプル行リストに統一。
import { ticker, header, footer, page } from './layout.js';
import { esc } from '../src/markdown.js';
import { config } from '../src/config.js';
import { metaLine, imp } from './cardbits.js';

const BASE = '../';
const href = (a) => `${BASE}articles/${a.slug}.html`;

function feedList(items) {
  // セクションページは全記事が同一カテゴリ＝カテゴリ表記は冗長なので省く（日時のみ）。
  const rows = items.map((a) => `        <li class="feed-item" data-imp="${imp(a)}">
          ${metaLine(a, false)}
          <a class="feed-item__title" href="${href(a)}">${esc(a.headline)}</a>
          <span class="feed-item__src">出典: ${esc(a.source)}</span>
        </li>`).join('\n');
  return `      <ul class="feed-list">\n${rows}\n      </ul>`;
}

export function renderSection(name, slug, articles, dateLabel, tickerItems = []) {
  const empty = `      <p class="feed__empty">このセクションの記事はまだありません。次の自動更新で追加され次第ここに表示されます。</p>`;

  const main = `  <main id="main" tabindex="-1" class="container container--narrow">

    <header class="page-head">
      <span class="cat">セクション</span>
      <h1 class="page-head__title">${esc(name)}</h1>
      <p class="page-head__lead">${esc(name)} に関する ${esc(config.siteName)} 編集部のニュースと論評。（${articles.length} 記事）</p>
    </header>

    <section class="feed" aria-label="記事一覧">
${articles.length ? feedList(articles) : empty}
    </section>

  </main>`;

  return page({
    base: BASE,
    title: `${name} | ${esc(config.siteName)}`,
    description: `${name} に関する最新ニュースを ${esc(config.siteName)} 編集部の要約と論評でお届けします。`,
    body: `${ticker(tickerItems)}${header(dateLabel, name, BASE)}\n\n${main}\n\n${footer(BASE)}`,
    canonicalPath: `/sections/${slug}.html`,
  });
}
