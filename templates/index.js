// トップページ。低認知負荷・白基調ミニマル方針：
//   リード1本（大きく）→「最新」シンプル行リスト → RSS購読。
// サイドレール・注目モザイク・ティッカー・速報バーは撤去し、1カラムの読み筋に統一。
import { ticker, header, footer, page, organizationLd } from './layout.js';
import { esc } from '../src/markdown.js';
import { config } from '../src/config.js';
import { sectionChip, optimizedUrl } from './cardbits.js';

const href = (a) => `articles/${a.slug}.html`;

// 出典発行日時（無ければ取り込み時刻）の ISO 文字列。<time datetime> 用（a11y）。
function isoDate(a) {
  const src = a.publishedAt || a.createdAt;
  if (!src) return '';
  const d = new Date(src);
  return Number.isNaN(d.getTime()) ? '' : esc(d.toISOString());
}

// リード（最上段の1本）。実写真があれば控えめに添える（抽象グラデのフォールバックは出さない）。
function leadStory(a) {
  if (!a) return '';
  const img = a.image || {};
  const figure = img.imageUrl
    ? `        <a class="lead__media" href="${href(a)}" tabindex="-1" aria-hidden="true" style="background-image:url('${esc(optimizedUrl(img.imageUrl, 1200))}')"></a>\n`
    : '';
  return `    <section class="lead" aria-label="トップ記事">
${figure}        <div class="lead__meta">
          ${sectionChip(a.section)}
          <time datetime="${isoDate(a)}">${esc(a.displayDate || '')}</time>
        </div>
        <h1 class="lead__headline"><a href="${href(a)}">${esc(a.headline)}</a></h1>
        <p class="lead__deck">${esc(a.lead)}</p>
        <div class="lead__source">出典: ${esc(a.source)}</div>
    </section>`;
}

// 「最新」＝時系列の行リスト。1行＝時刻｜見出し｜カテゴリ。説明文・サムネは省きスキャン性を最優先。
function latestList(items, archiveHref = '#') {
  if (!items.length) {
    return `    <section class="feed" aria-label="最新記事">
      <h2 class="feed__head">最新</h2>
      <p class="feed__empty">記事が増えるとここに一覧が表示されます。</p>
    </section>`;
  }
  const rows = items.map((a) => `        <li class="feed-item">
          <time class="feed-item__time" datetime="${isoDate(a)}">${esc(a.displayTime || a.displayDate || '')}</time>
          <a class="feed-item__title" href="${href(a)}">${esc(a.headline)}</a>
          <span class="feed-item__cat">${esc(a.section || 'AI')}</span>
        </li>`).join('\n');
  const more = archiveHref !== '#'
    ? `\n      <a class="feed__more" href="${archiveHref}">アーカイブをすべて見る</a>`
    : '';
  return `    <section class="feed" aria-label="最新記事">
      <h2 class="feed__head">最新</h2>
      <ul class="feed-list">
${rows}
      </ul>${more}
    </section>`;
}

export function renderIndex(featured, latest, dateLabel, archiveCount = 0, tickerItems = []) {
  const lead = featured[0];
  // リード以外の最新記事を時系列で。リードは除外して重複を避ける。
  const leadSlug = lead ? lead.slug : null;
  const listItems = latest.filter((a) => a.slug !== leadSlug);
  const archiveHref = archiveCount > 0 ? 'archive.html' : '#';

  const body = `${ticker(tickerItems)}${header(dateLabel, 'トップ')}

  <main class="container container--narrow">

${leadStory(lead)}

${latestList(listItems, archiveHref)}

    <section class="subscribe" aria-label="購読">
      <h2 class="subscribe__head">最新ニュースを購読</h2>
      <p class="subscribe__lead">フィードリーダーに RSS を登録すると、新着記事を自動で受け取れます。無料・登録不要。</p>
      <a class="btn" href="feed.xml">RSS で購読</a>
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
    title: '俯瞰（FUKAN）— 世界のニュースを、要約と論評で',
    description: 'テック・AI・科学・経済・政治・国際・カルチャーまで、世界のニュースを編集部の要約と中立論評で俯瞰します。',
    body,
    canonicalPath: '/',
    ogType: 'website',
    jsonLd,
  });
}
