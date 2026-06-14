// articles.json から index.html / archive.html / articles/<slug>.html を生成する。
// 並び: トップは最新 retentionTop 本を母集団とし、ヒーロー/カードは重要度順、
// 「最新記事」リストは時系列、超過分はアーカイブへ。
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderIndex } from '../templates/index.js';
import { renderArticle } from '../templates/article.js';
import { renderArchive } from '../templates/archive.js';
import { renderSection } from '../templates/section.js';
import { renderTag, renderTagsIndex } from '../templates/tag.js';
import { renderLegalPages } from '../templates/legal.js';
import { config } from './config.js';

// XML 用の最小エスケープ
const xmlEsc = (s = '') => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const abs = (p) => `${config.siteUrl}${p.startsWith('/') ? p : `/${p}`}`;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

function dateLabel(d = new Date()) {
  const wd = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${wd}`;
}

function decorate(a) {
  const d = a.createdAt ? new Date(a.createdAt) : new Date();
  const displayDate = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  const displayTime = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return { ...a, displayDate, displayTime };
}

const recencyDesc = (x, y) => Date.parse(y.createdAt || 0) - Date.parse(x.createdAt || 0);
const imp = (a) => Number(a.importance) || 3;
const importanceThenRecency = (x, y) => (imp(y) - imp(x)) || recencyDesc(x, y);

// 関連記事: タグ共有数×3 + 同セクション×2 でスコアし、同点は重要度→新着。
// 関連度>0 を優先し、不足分は重要度上位で補完して count 件を返す。
function relatedFor(target, pool, count = 3) {
  const tags = new Set(target.tags || []);
  const scored = pool
    .filter((a) => a.slug !== target.slug)
    .map((a) => {
      const shared = (a.tags || []).filter((t) => tags.has(t)).length;
      const score = shared * 3 + (a.section === target.section ? 2 : 0);
      return { a, score };
    });
  const relevant = scored
    .filter((s) => s.score > 0)
    .sort((x, y) => (y.score - x.score) || importanceThenRecency(x.a, y.a))
    .map((s) => s.a);
  if (relevant.length >= count) return relevant.slice(0, count);
  // 不足分を重要度上位（既選を除く）で補完
  const chosen = new Set(relevant.map((a) => a.slug));
  const fill = pool
    .filter((a) => a.slug !== target.slug && !chosen.has(a.slug))
    .sort(importanceThenRecency);
  return [...relevant, ...fill].slice(0, count);
}

export async function renderSite(rawArticles) {
  const decorated = rawArticles.map(decorate);

  const byRecency = [...decorated].sort(recencyDesc);
  const universe = byRecency.slice(0, config.retentionTop);   // トップ掲載の母集団（最新N本）
  const archived = byRecency.slice(config.retentionTop);       // アーカイブ送り
  const featured = [...universe].sort(importanceThenRecency);  // ヒーロー/カード/人気（重要度順）

  const label = dateLabel();
  // ティッカーに流す最新見出し（架空のベンチ値を廃止し、実データを表示）
  const tickerItems = byRecency.slice(0, 12).map((a) => a.headline);

  // index.html（ルート上書き）
  await writeFile(
    path.join(ROOT, 'index.html'),
    renderIndex(featured, universe, label, archived.length, tickerItems),
    'utf8',
  );

  // archive.html（超過分があるときのみ・全記事を時系列で一覧）
  if (archived.length) {
    await writeFile(path.join(ROOT, 'archive.html'), renderArchive(byRecency, label, tickerItems), 'utf8');
  }

  // sections/<slug>.html（ナビ各タブのリンク先・重要度→新着順）
  await mkdir(path.join(ROOT, 'sections'), { recursive: true });
  for (const { name, slug } of config.navSections) {
    const items = [...decorated].filter((a) => a.section === name).sort(importanceThenRecency);
    await writeFile(path.join(ROOT, 'sections', `${slug}.html`), renderSection(name, slug, items, label, tickerItems), 'utf8');
  }

  // tags/<tag>.html + tags/index.html（タグ→記事の Map を構築）
  await mkdir(path.join(ROOT, 'tags'), { recursive: true });
  const tagMap = new Map(); // tag -> 記事[]
  for (const a of decorated) {
    for (const t of a.tags || []) {
      if (!tagMap.has(t)) tagMap.set(t, []);
      tagMap.get(t).push(a);
    }
  }
  for (const [tag, items] of tagMap) {
    items.sort(importanceThenRecency);
    await writeFile(path.join(ROOT, 'tags', `${tag}.html`), renderTag(tag, items, label, tickerItems), 'utf8');
  }
  const tagEntries = [...tagMap.entries()]
    .map(([tag, items]) => [tag, items.length])
    .sort((x, y) => (y[1] - x[1]) || x[0].localeCompare(y[0], 'ja'));
  await writeFile(path.join(ROOT, 'tags', 'index.html'), renderTagsIndex(tagEntries, label, tickerItems), 'utf8');

  // 法的・運営ページ（about / contact / privacy / terms / editorial / disclaimer）
  const legalPages = renderLegalPages(label, tickerItems);
  for (const [file, html] of Object.entries(legalPages)) {
    await writeFile(path.join(ROOT, file), html, 'utf8');
  }

  // search-index.json（クライアント検索用・全記事の軽量メタ）
  const searchIndex = byRecency.map((a) => ({
    slug: a.slug,
    headline: a.headline,
    lead: a.lead || '',
    tags: a.tags || [],
    section: a.section || '',
    date: a.displayDate || '',
  }));
  await writeFile(path.join(ROOT, 'search-index.json'), JSON.stringify(searchIndex), 'utf8');

  // 各記事ページ（全件）。関連はタグ/セクション一致でスコアし3件。
  await mkdir(path.join(ROOT, 'articles'), { recursive: true });
  let count = 0;
  for (let i = 0; i < byRecency.length; i++) {
    const a = byRecency[i];
    const related = relatedFor(a, byRecency, 3);
    const html = renderArticle(a, related, label, i, tickerItems);
    await writeFile(path.join(ROOT, 'articles', `${a.slug}.html`), html, 'utf8');
    count++;
  }

  // sitemap.xml / robots.txt / feed.xml（SEO・配信）
  await writeSeoFiles(byRecency, tagMap, Object.keys(legalPages), archived.length);

  return { index: 1, articles: count, archived: archived.length };
}

// sitemap.xml・robots.txt・feed.xml を生成
async function writeSeoFiles(byRecency, tagMap, legalFiles, archivedCount) {
  const now = new Date().toISOString();
  const lastmod = (a) => (a.createdAt ? new Date(a.createdAt).toISOString() : now);

  // --- sitemap.xml ---
  const urls = [];
  urls.push({ loc: abs('/'), lastmod: byRecency[0] ? lastmod(byRecency[0]) : now });
  for (const a of byRecency) urls.push({ loc: abs(`/articles/${a.slug}.html`), lastmod: lastmod(a) });
  for (const { slug } of config.navSections) urls.push({ loc: abs(`/sections/${slug}.html`), lastmod: now });
  urls.push({ loc: abs('/tags/index.html'), lastmod: now });
  for (const tag of tagMap.keys()) urls.push({ loc: abs(`/tags/${encodeURIComponent(tag)}.html`), lastmod: now });
  if (archivedCount) urls.push({ loc: abs('/archive.html'), lastmod: now });
  for (const f of legalFiles) urls.push({ loc: abs(`/${f}`), lastmod: now });

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${xmlEsc(u.loc)}</loc><lastmod>${u.lastmod}</lastmod></url>`).join('\n')}
</urlset>
`;
  await writeFile(path.join(ROOT, 'sitemap.xml'), sitemap, 'utf8');

  // --- robots.txt ---
  const robots = `User-agent: *
Allow: /

Sitemap: ${abs('/sitemap.xml')}
`;
  await writeFile(path.join(ROOT, 'robots.txt'), robots, 'utf8');

  // --- feed.xml（RSS 2.0・最新20件）---
  const items = byRecency.slice(0, 20).map((a) => {
    const link = abs(`/articles/${a.slug}.html`);
    const pub = a.createdAt ? new Date(a.createdAt).toUTCString() : new Date().toUTCString();
    return `    <item>
      <title>${xmlEsc(a.headline)}</title>
      <link>${xmlEsc(link)}</link>
      <guid isPermaLink="true">${xmlEsc(link)}</guid>
      <pubDate>${pub}</pubDate>
      <description>${xmlEsc(a.lead || '')}</description>
      ${a.section ? `<category>${xmlEsc(a.section)}</category>` : ''}
    </item>`;
  }).join('\n');

  const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${xmlEsc(config.siteName)}</title>
    <link>${xmlEsc(config.siteUrl)}</link>
    <atom:link href="${xmlEsc(abs('/feed.xml'))}" rel="self" type="application/rss+xml" />
    <description>${xmlEsc(config.siteDescription)}</description>
    <language>ja</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>
`;
  await writeFile(path.join(ROOT, 'feed.xml'), feed, 'utf8');
}
