// トップページ。総合ニュースの骨格（ヒーロー＋トップニュース → 最新グリッド → カテゴリ別ブロック → 購読）。
//   PC は widen（.page--home）で2カラム化、モバイルは1カラムに積む。色は青のみ・テキスト先行（画像はヒーローのみ）。
import { ticker, header, footer, page, organizationLd } from './layout.js';
import { esc } from '../src/markdown.js';
import { config } from '../src/config.js';
import { sectionChip, optimizedUrl, isoDate, metaLine } from './cardbits.js';

const href = (a) => `articles/${a.slug}.html`;

// 並び基準（render.js と同義のローカル実装）。featured/universe は decorate 済みで渡る。
const eff = (a) => a.publishedAt || a.createdAt;
const imp = (a) => Number(a.importance) || 3;
const recencyDesc = (x, y) => Date.parse(eff(y) || 0) - Date.parse(eff(x) || 0);
const importanceThenRecency = (x, y) => (imp(y) - imp(x)) || recencyDesc(x, y);

// リード（最上段の1本）。実写真があれば控えめに添える（抽象グラデのフォールバックは出さない）。
function leadStory(a) {
  if (!a) return '';
  const img = a.image || {};
  const figure = img.imageUrl
    ? `        <a class="lead__media" href="${href(a)}" tabindex="-1" aria-hidden="true" style="background-image:url('${esc(optimizedUrl(img.imageUrl, 1200))}')"></a>\n`
    : '';
  return `      <section class="lead" aria-label="トップ記事">
${figure}        <div class="lead__meta">
          ${sectionChip(a.section)}
          <time datetime="${isoDate(a)}">${esc(a.displayDate || '')}</time>
        </div>
        <h1 class="lead__headline"><a href="${href(a)}">${esc(a.headline)}</a></h1>
        <p class="lead__deck">${esc(a.lead)}</p>
        <div class="lead__source">出典: ${esc(a.source)}</div>
      </section>`;
}

// トップニュース（右レール）。重要度上位の数本をエブロー行で。画像・説明文は省く。
function topRail(items) {
  if (!items.length) return '';
  const rows = items.map((a) => `          <li class="rail-item">
            ${metaLine(a)}
            <a class="rail-item__title" href="${href(a)}">${esc(a.headline)}</a>
          </li>`).join('\n');
  return `      <aside class="home__rail" aria-label="トップニュース">
        <h2 class="feed__head">トップニュース</h2>
        <ul class="rail-list">
${rows}
        </ul>
      </aside>`;
}

// 「最新」＝時系列の行リスト（エブロー）。PC では多列グリッドに、モバイルは縦積み。
function latestList(items, archiveHref = '#') {
  if (!items.length) {
    return `    <section class="feed" aria-label="最新記事">
      <h2 class="feed__head">最新</h2>
      <p class="feed__empty">記事が増えるとここに一覧が表示されます。</p>
    </section>`;
  }
  const rows = items.map((a) => `        <li class="feed-item">
          ${metaLine(a)}
          <a class="feed-item__title" href="${href(a)}">${esc(a.headline)}</a>
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

// カテゴリ別ブロックのカード（ブロック見出しがカテゴリを示すので、カード側はカテゴリを省き日時のみ）。
function sectionCard(a) {
  return `          <li class="seccard">
            ${metaLine(a, false)}
            <a class="seccard__title" href="${href(a)}">${esc(a.headline)}</a>
          </li>`;
}

function sectionBlock(name, slug, items) {
  const more = slug ? `<a class="secblock__more" href="sections/${slug}.html">すべて見る →</a>` : '';
  const cards = items.map(sectionCard).join('\n');
  return `    <section class="secblock" aria-label="${esc(name)}">
      <div class="secblock__head">
        <h2 class="secblock__title">${esc(name)}</h2>
        ${more}
      </div>
      <ul class="secblock__grid">
${cards}
      </ul>
    </section>`;
}

// universe を実在の section 値でグループ化し、≥3本のものをブロック化。
// 並びは navSections 順を優先、残りは本数降順。slug 一致時のみ「すべて見る」リンク。
function sectionBlocks(universe, shown) {
  const slugByName = new Map(config.navSections.map((s) => [s.name, s.slug]));
  const navOrder = config.navSections.map((s) => s.name);

  const groups = new Map();
  for (const a of universe) {
    const s = a.section || 'AI';
    if (!groups.has(s)) groups.set(s, []);
    groups.get(s).push(a);
  }

  const names = [...groups.keys()].sort((x, y) => {
    const ix = navOrder.indexOf(x);
    const iy = navOrder.indexOf(y);
    if (ix !== -1 && iy !== -1) return ix - iy;
    if (ix !== -1) return -1;
    if (iy !== -1) return 1;
    return groups.get(y).length - groups.get(x).length;
  });

  const blocks = [];
  for (const name of names) {
    const items = groups.get(name)
      .filter((a) => !shown.has(a.slug))
      .sort(importanceThenRecency)
      .slice(0, config.sectionBlockMax);
    if (items.length < config.sectionBlockMin) continue;
    blocks.push(sectionBlock(name, slugByName.get(name) || '', items));
  }
  return blocks.length ? `\n${blocks.join('\n\n')}\n` : '';
}

export function renderIndex(featured, latest, dateLabel, archiveCount = 0, tickerItems = []) {
  const hero = featured[0];
  const topStories = featured.slice(1, 7);
  // ヒーロー＋トップニュースで既出のものは下段から除外して重複を抑える。
  const shown = new Set([hero, ...topStories].filter(Boolean).map((a) => a.slug));
  const latestItems = latest.filter((a) => !shown.has(a.slug)).slice(0, 10);
  const archiveHref = archiveCount > 0 ? 'archive.html' : '#';

  const body = `${ticker(tickerItems)}${header(dateLabel, 'トップ')}

  <main class="container home">

    <div class="home__lead">
${leadStory(hero)}
${topRail(topStories)}
    </div>

${latestList(latestItems, archiveHref)}
${sectionBlocks(latest, shown)}
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
    bodyClass: 'page--home',
  });
}
