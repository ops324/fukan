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

// 画像シグネチャ: 同じ被写体の写真が関連枠に並ぶのを避けるための鍵集合。
// imageUrl（最強）＋ image_query の意味語（接続詞・汎用語は除外）。
const IMG_STOP = new Set([
  'the', 'a', 'an', 'of', 'and', 'in', 'on', 'at', 'for', 'with', 'to', 'from', 'by',
  'sky', 'night', 'day', 'view', 'shot', 'photo', 'image', 'closeup', 'close', 'up',
  'background', 'scene', 'modern', 'abstract',
]);
function imgSig(a) {
  const set = new Set();
  const url = (a.image && a.image.imageUrl ? String(a.image.imageUrl) : '').split('?')[0];
  if (url) set.add(`url:${url}`);
  for (const w of String(a.image_query || '').toLowerCase().split(/[^a-z0-9]+/)) {
    if (w.length > 2 && !IMG_STOP.has(w)) set.add(w);
  }
  return set;
}
const sigOverlaps = (sig, used) => {
  for (const k of sig) if (used.has(k)) return true;
  return false;
};

// 並び順（関連度／重要度順）を保ったまま貪欲に count 件選ぶ。
// 各ステップで「既選と被写体が重ならない最上位候補」を優先採用し、無ければ最上位をそのまま採用。
// → 関連度を犠牲にせず（候補集合は呼び出し側で限定）、可能な範囲で被写体を分散する。
function pickDiverse(ordered, count, usedSig = new Set()) {
  const picked = [];
  const remaining = [...ordered];
  while (picked.length < count && remaining.length) {
    let idx = remaining.findIndex((a) => !sigOverlaps(imgSig(a), usedSig));
    if (idx === -1) idx = 0; // 全候補が既選と被る → 順位最優先で妥協
    const [chosen] = remaining.splice(idx, 1);
    for (const k of imgSig(chosen)) usedSig.add(k);
    picked.push(chosen);
  }
  return picked;
}

// 関連記事: タグ共有数×3 + 同セクション×2 でスコアし、同点は重要度→新着。
// 関連度>0 の集合内で被写体を分散して選び、不足分は重要度上位で補完して count 件を返す。
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
  // まず関連集合から被写体分散で選ぶ（無関係記事は混ぜない＝関連度は不変）。
  const usedSig = new Set();
  const picked = pickDiverse(relevant, count, usedSig);
  if (picked.length >= count) return picked;
  // 不足分を重要度上位（既選を除く）で補完。補完側も既選の被写体を避ける。
  const chosen = new Set(picked.map((a) => a.slug));
  const fill = pool
    .filter((a) => a.slug !== target.slug && !chosen.has(a.slug))
    .sort(importanceThenRecency);
  return [...picked, ...pickDiverse(fill, count - picked.length, usedSig)];
}

// outDir を指定すると ROOT ではなくそのディレクトリへ全生成物を書き出す（既定は ROOT）。
// check.js が一時ディレクトリへ「お試しレンダー」して作業ツリーを汚さないために使う。
export async function renderSite(rawArticles, { outDir = ROOT } = {}) {
  const decorated = rawArticles.map(decorate);

  const byRecency = [...decorated].sort(recencyDesc);
  const universe = byRecency.slice(0, config.retentionTop);   // トップ掲載の母集団（最新N本）
  const archived = byRecency.slice(config.retentionTop);       // アーカイブ送り
  const featured = [...universe].sort(importanceThenRecency);  // ヒーロー/カード/人気（重要度順）

  // ヒーロー（featured[0]）だけは「鮮度ウィンドウ」内の最重要記事に差し替える。
  // featured は importance 降順なので、ウィンドウ内で最初に見つかる記事＝直近 N 時間の最重要記事。
  // これを先頭へ移すことで、古い高importance記事がトップに居座る停滞を防ぐ（サイド/カード/人気の重要度順は維持）。
  // ウィンドウ内に該当が無ければ何もしない＝従来どおり全体の最重要がヒーロー（保険）。
  const heroCutoff = Date.now() - config.heroRecencyHours * 3600 * 1000;
  const heroIdx = featured.findIndex((a) => Date.parse(a.createdAt || 0) >= heroCutoff);
  if (heroIdx > 0) {
    const [hero] = featured.splice(heroIdx, 1);
    featured.unshift(hero);
  }

  const label = dateLabel();
  // ティッカーに流す最新見出し（架空のベンチ値を廃止し、実データを表示）
  const tickerItems = byRecency.slice(0, 12).map((a) => a.headline);

  // index.html（ルート上書き）
  await writeFile(
    path.join(outDir, 'index.html'),
    renderIndex(featured, universe, label, archived.length, tickerItems),
    'utf8',
  );

  // archive.html（超過分があるときのみ・全記事を時系列で一覧）
  if (archived.length) {
    await writeFile(path.join(outDir, 'archive.html'), renderArchive(byRecency, label, tickerItems), 'utf8');
  }

  // sections/<slug>.html（ナビ各タブのリンク先・重要度→新着順）
  await mkdir(path.join(outDir, 'sections'), { recursive: true });
  for (const { name, slug } of config.navSections) {
    const items = [...decorated].filter((a) => a.section === name).sort(importanceThenRecency);
    await writeFile(path.join(outDir, 'sections', `${slug}.html`), renderSection(name, slug, items, label, tickerItems), 'utf8');
  }

  // tags/<tag>.html + tags/index.html（タグ→記事の Map を構築）
  await mkdir(path.join(outDir, 'tags'), { recursive: true });
  const tagMap = new Map(); // tag -> 記事[]
  for (const a of decorated) {
    for (const t of a.tags || []) {
      if (!tagMap.has(t)) tagMap.set(t, []);
      tagMap.get(t).push(a);
    }
  }
  for (const [tag, items] of tagMap) {
    items.sort(importanceThenRecency);
    await writeFile(path.join(outDir, 'tags', `${tag}.html`), renderTag(tag, items, label, tickerItems), 'utf8');
  }
  const tagEntries = [...tagMap.entries()]
    .map(([tag, items]) => [tag, items.length])
    .sort((x, y) => (y[1] - x[1]) || x[0].localeCompare(y[0], 'ja'));
  await writeFile(path.join(outDir, 'tags', 'index.html'), renderTagsIndex(tagEntries, label, tickerItems), 'utf8');

  // 法的・運営ページ（about / contact / privacy / terms / editorial / disclaimer）
  const legalPages = renderLegalPages(label, tickerItems);
  for (const [file, html] of Object.entries(legalPages)) {
    await writeFile(path.join(outDir, file), html, 'utf8');
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
  await writeFile(path.join(outDir, 'search-index.json'), JSON.stringify(searchIndex), 'utf8');

  // 各記事ページ（全件）。関連はタグ/セクション一致でスコアし3件。
  await mkdir(path.join(outDir, 'articles'), { recursive: true });
  let count = 0;
  for (let i = 0; i < byRecency.length; i++) {
    const a = byRecency[i];
    const related = relatedFor(a, byRecency, 3);
    const html = renderArticle(a, related, label, i, tickerItems);
    await writeFile(path.join(outDir, 'articles', `${a.slug}.html`), html, 'utf8');
    count++;
  }

  // sitemap.xml / robots.txt / feed.xml（SEO・配信）
  await writeSeoFiles(byRecency, tagMap, Object.keys(legalPages), archived.length, outDir);

  return { index: 1, articles: count, archived: archived.length };
}

// sitemap.xml・robots.txt・feed.xml を生成
async function writeSeoFiles(byRecency, tagMap, legalFiles, archivedCount, outDir = ROOT) {
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
  await writeFile(path.join(outDir, 'sitemap.xml'), sitemap, 'utf8');

  // --- robots.txt ---
  const robots = `User-agent: *
Allow: /

Sitemap: ${abs('/sitemap.xml')}
`;
  await writeFile(path.join(outDir, 'robots.txt'), robots, 'utf8');

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
<?xml-stylesheet type="text/xsl" href="/feed.xsl"?>
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
  await writeFile(path.join(outDir, 'feed.xml'), feed, 'utf8');

  // feed.xsl — ブラウザで feed.xml を開いたとき読み物として表示するスタイルシート
  await writeFile(path.join(outDir, 'feed.xsl'), feedStylesheet(), 'utf8');
}

// RSS をブラウザで人間向けに描画する XSLT 1.0 スタイルシート。
// （フィードリーダーは XML としてそのまま読むので購読機能には影響しない）
function feedStylesheet() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:atom="http://www.w3.org/2005/Atom">
  <xsl:output method="html" encoding="UTF-8" indent="yes"/>
  <xsl:template match="/rss/channel">
    <html lang="ja">
    <head>
      <meta charset="utf-8"/>
      <meta name="viewport" content="width=device-width, initial-scale=1"/>
      <title><xsl:value-of select="title"/> — RSS フィード</title>
      <style>
        :root { color-scheme: dark; }
        body { margin:0; background:#0b0e1a; color:#f4f1ea;
          font-family:'Hiragino Kaku Gothic ProN','Yu Gothic',system-ui,sans-serif; line-height:1.7; }
        .wrap { max-width:760px; margin:0 auto; padding:48px 24px 96px; }
        .brand { font-family:Georgia,serif; font-size:30px; font-weight:600; letter-spacing:-0.02em; }
        .brand em { color:#7fb6ff; font-style:normal; }
        .eyebrow { color:#7fb6ff; letter-spacing:0.3em; text-transform:uppercase; font-size:12px; font-weight:600; }
        .note { background:#14182a; border:1px solid #2a3050; border-radius:6px; padding:16px 18px; margin:24px 0 8px; font-size:14px; color:#cfd6e4; }
        .note a, a { color:#7fb6ff; }
        h1 { font-size:22px; margin:18px 0 4px; }
        .desc { color:#aab2c5; font-size:15px; }
        .item { padding:20px 0; border-bottom:1px solid #222842; }
        .item a.t { color:#f4f1ea; font-size:18px; font-weight:600; text-decoration:none; }
        .item a.t:hover { color:#7fb6ff; }
        .item p { margin:6px 0 0; color:#aab2c5; font-size:14px; }
        .meta { margin-top:8px; color:#7d8597; font-size:12px; font-family:ui-monospace,monospace; }
        .back { display:inline-block; margin-top:28px; }
      </style>
    </head>
    <body>
      <div class="wrap">
        <div class="eyebrow">RSS Feed</div>
        <div class="brand">AXIOM<em>·</em>AI</div>
        <h1><xsl:value-of select="title"/> の最新記事</h1>
        <p class="desc"><xsl:value-of select="description"/></p>
        <div class="note">
          これは <strong>RSSフィード</strong> です。Feedly・Inoreader などの
          <strong>フィードリーダー</strong>にこのページのURLを登録すると、新着記事を自動で受け取れます。
          記事をそのまま読むなら <a href="/">サイトトップ</a> へ。
        </div>
        <xsl:for-each select="item">
          <div class="item">
            <a class="t"><xsl:attribute name="href"><xsl:value-of select="link"/></xsl:attribute><xsl:value-of select="title"/></a>
            <p><xsl:value-of select="description"/></p>
            <div class="meta"><xsl:value-of select="category"/> · <xsl:value-of select="pubDate"/></div>
          </div>
        </xsl:for-each>
        <a class="back" href="/">← AXIOM AI トップへ戻る</a>
      </div>
    </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
`;
}
