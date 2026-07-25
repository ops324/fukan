// RSS（主力・キー不要）+ NewsAPI/GNews（任意）から記事候補を集め、
// 既処理 link を除外して上位 maxArticles 件を返す。
import Parser from 'rss-parser';
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { enrichCandidates } from './summaryFetch.js';

const parser = new Parser({ timeout: config.timeouts.rssMs });
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 候補選別の内訳を ledger に残す（除外が効きすぎ/効かなさすぎを後から検知するため）。
// 記録に失敗しても候補取得は止めない＝日次を止めない。
async function recordCandidateStats(rec) {
  try {
    const dir = path.join(ROOT, 'data', 'quality');
    await mkdir(dir, { recursive: true });
    const line = JSON.stringify({ ts: new Date().toISOString(), type: 'candidates', ...rec });
    await appendFile(path.join(dir, 'incidents.jsonl'), `${line}\n`, 'utf8');
  } catch { /* 記録の失敗で候補取得を止めない */ }
}

function clean(s = '') {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function fromRss() {
  const results = [];
  await Promise.all(
    config.rssFeeds.map(async (feed) => {
      try {
        const parsed = await parser.parseURL(feed.url);
        for (const item of (parsed.items || []).slice(0, 8)) {
          if (!item.link || !item.title) continue;
          results.push({
            title: clean(item.title),
            link: item.link.split('?')[0],
            summary: clean(item.contentSnippet || item.content || item.summary || ''),
            source: feed.source,
            section: feed.section,
            tier: feed.tier || 'media',
            aiFilter: feed.aiFilter === true, // true のフィードのみ AI関連度で足切りする
            publishedAt: item.isoDate || item.pubDate || null,
          });
        }
      } catch (err) {
        console.warn(`  [rss] 取得失敗: ${feed.source} (${err.message})`);
      }
    })
  );
  return results;
}

async function fromNewsApi() {
  if (!config.newsapiKey) return [];
  try {
    const url = `https://newsapi.org/v2/everything?q=AI%20OR%20%22artificial%20intelligence%22&language=en&sortBy=publishedAt&pageSize=10&apiKey=${config.newsapiKey}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.articles || []).map((a) => ({
      title: clean(a.title || ''),
      link: (a.url || '').split('?')[0],
      summary: clean(a.description || a.content || ''),
      source: a.source?.name || 'NewsAPI',
      section: '産業応用',
      tier: 'media',
      publishedAt: a.publishedAt || null,
    })).filter((a) => a.link && a.title);
  } catch (err) {
    console.warn(`  [newsapi] 失敗: ${err.message}`);
    return [];
  }
}

async function fromGNews() {
  if (!config.gnewsKey) return [];
  try {
    const url = `https://gnews.io/api/v4/search?q=AI&lang=en&max=10&apikey=${config.gnewsKey}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.articles || []).map((a) => ({
      title: clean(a.title || ''),
      link: (a.url || '').split('?')[0],
      summary: clean(a.description || ''),
      source: a.source?.name || 'GNews',
      section: '産業応用',
      tier: 'media',
      publishedAt: a.publishedAt || null,
    })).filter((a) => a.link && a.title);
  } catch (err) {
    console.warn(`  [gnews] 失敗: ${err.message}`);
    return [];
  }
}

// 動画/ポッドキャスト等の弱いソースか判定（抽出本文が乏しく捏造の温床になる）
function isWeakSource(link) {
  const url = (link || '').toLowerCase();
  return config.skipUrlPatterns.some((p) => url.includes(p));
}

// AI関連度スコア: title+summary に含まれる aiKeywords の種類数を数える
function aiRelevance(a) {
  const hay = `${a.title || ''} ${a.summary || ''}`.toLowerCase();
  let hits = 0;
  for (const kw of config.aiKeywords) {
    if (hay.includes(kw.toLowerCase())) hits++;
  }
  return hits;
}

// 既処理リンク集合を渡すと、未処理の新着のみを上位 limit 件返す
export async function fetchNews(existing, limit = config.maxArticles) {
  const all = (await Promise.all([fromRss(), fromNewsApi(), fromGNews()])).flat();

  // link で重複排除（取得元内・横断）＋弱いソース除外＋AI関連度フィルタ
  const seen = new Set();
  const unique = [];
  let skippedWeak = 0;
  let skippedIrrelevant = 0;
  for (const a of all) {
    if (seen.has(a.link) || existing.has(a.link)) continue;
    if (isWeakSource(a.link)) { skippedWeak++; continue; }
    // primary(公式)は常に通す。aiFilter:true のフィードのみ AI関連度が閾値未満なら除外。
    // （総合ニュースの一般ソースは素通しし、重要度フロアと writer の選別に委ねる。）
    if (a.tier !== 'primary' && a.aiFilter && aiRelevance(a) < config.relevanceFloorMedia) {
      skippedIrrelevant++;
      continue;
    }
    seen.add(a.link);
    unique.push(a);
  }
  if (skippedWeak) console.log(`  弱いソース(動画/音声等)を ${skippedWeak} 件除外`);
  if (skippedIrrelevant) console.log(`  AI関連度が低い汎用フィードを ${skippedIrrelevant} 件除外`);

  // 一次情報(primary)を優先し、その中で新しい順。media は後ろ。
  const tierRank = (t) => (t === 'primary' ? 0 : 1);
  unique.sort((a, b) => {
    const tr = tierRank(a.tier) - tierRank(b.tier);
    if (tr !== 0) return tr;
    const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0;
    const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0;
    return tb - ta;
  });

  // カバレッジ均等化: 高頻度メディア(BBC/Guardian等)が低頻度セクション(Quanta等)を
  // 候補プールから締め出さないよう、セクション round-robin でプールを満たす。
  // primary(企業公式・少数)は一次情報として常に先頭で確保し、残り枠を media のセクション
  // ごとのキュー(各々は上の sort で鮮度順)から順繰りに 1 件ずつ取り出して埋める。
  const primary = unique.filter((a) => a.tier === 'primary');
  const mediaBySection = new Map();
  for (const a of unique) {
    if (a.tier === 'primary') continue;
    if (!mediaBySection.has(a.section)) mediaBySection.set(a.section, []);
    mediaBySection.get(a.section).push(a);
  }
  const picked = primary.slice(0, limit);
  const queues = [...mediaBySection.values()];
  let qi = 0;
  while (picked.length < limit && queues.some((q) => q.length)) {
    const q = queues[qi % queues.length];
    if (q.length) picked.push(q.shift());
    qi++;
  }
  const pool = picked.slice(0, limit);

  // RSS 要約が薄い候補の本文を補完する（対象は robots.txt が許可したドメインのみ・§summaryFetch）。
  // writer/judge の WebFetch は 403 に打つ手がないため、Node 側で先に読んで summary に載せておく。
  // 失敗しても候補はそのまま残る＝日次を止めない。
  const { candidates: enrichedPool, enriched } = await enrichCandidates(pool);
  if (enriched) console.log(`  出典本文で要約を補完: ${enriched} 件`);

  // 除外の観測性: この console.log は writer の CLI セッション内で消え、どのログにも残らない
  // （2026-07-25 に実測）。効きすぎ／効かなさすぎを後から検知できるよう ledger に残す。
  await recordCandidateStats({ total: all.length, pool: enrichedPool.length, skippedWeak, skippedIrrelevant, enriched });

  return enrichedPool;
}
