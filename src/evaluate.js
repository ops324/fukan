// 自己改善ハーネス（MVP）— 客観評価と「記憶」(ledger)。
// 追加依存なし（Node 組み込みのみ）。LLM は使わない＝決定的。
//
// 役割:
//  1) evaluateArticle(a, recent) … 記事の客観指標を計算する純関数（判定は warn 止まり）
//  2) appendEvaluation(rec)       … data/quality/evaluations.jsonl に1行追記（=記憶）
//  3) writeRunSummary(arts, evals)… data/quality/run-<ts>.json にサイト集計を書く
//  4) CLI: `node src/evaluate.js`               直近記事を採点して ledger 追記＋集計＋表示
//          `node src/evaluate.js --rate <slug> <1-5> [メモ]` 人間キャリブレーションを追記
//          `node src/evaluate.js --link-check`  出典リンク死活（非ゲート・参考）
//
// 重要: しきい値（config.qualityThresholds）は「床/ガードレール」であって最大化目標ではない。
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadArticles } from './store.js';
import { config } from './config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QUALITY_DIR = path.join(ROOT, 'data', 'quality');
const EVAL_FILE = path.join(QUALITY_DIR, 'evaluations.jsonl');
const CALIB_FILE = path.join(QUALITY_DIR, 'calibration.jsonl');
const RUNS_FILE = path.join(QUALITY_DIR, 'runs.jsonl');

async function ensureDir() { await mkdir(QUALITY_DIR, { recursive: true }); }

// --- テキスト正規化と類似度（重複話題検出用・ゼロ依存）---
// 記号・空白を除いて小文字化。日本語/英語を素朴にまとめる。
function normalize(s = '') {
  return String(s).toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}
// 文字 2-gram のシングル集合（日本語の語境界が無くても類似を拾える）
function charBigrams(s = '') {
  const n = normalize(s);
  const out = new Set();
  for (let i = 0; i < n.length - 1; i++) out.add(n.slice(i, i + 2));
  if (n.length === 1) out.add(n);
  return out;
}
// 記事の「話題トークン集合」= タグ（語そのもの）＋ 見出しの文字 2-gram
function topicTokens(a) {
  const set = new Set((a.tags || []).map((t) => normalize(t)).filter(Boolean));
  for (const g of charBigrams(a.headline)) set.add(g);
  return set;
}
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

// 画像種別を判定: 'photo'（ストック写真）/ 'press'（公式）/ 'fallback'（CSS抽象）
function imageKindOf(img) {
  if (img && img.imageUrl) return img.kind === 'press' ? 'press' : 'photo';
  return 'fallback';
}

// --- 記事1件の客観評価（純関数・ネットワーク無し）---
// recent: この記事より前に出た記事配列（重複話題チェックの母集団）
export function evaluateArticle(a, recent = []) {
  const t = config.qualityThresholds;
  const bodyLen = (a.body_markdown || '').length;
  const headlineLen = (a.headline || '').length;
  const leadLen = (a.lead || '').length;
  const tagCount = Array.isArray(a.tags) ? a.tags.length : 0;
  const sectionOk = config.navSections.some((s) => s.name === a.section);
  const kind = imageKindOf(a.image);

  // 直近記事との最大話題類似度
  const myTokens = topicTokens(a);
  const pool = recent.slice(0, t.recentWindow);
  let maxDupSim = 0;
  let dupWith = null;
  for (const r of pool) {
    if (r.slug === a.slug || r.link === a.link) continue;
    const sim = jaccard(myTokens, topicTokens(r));
    if (sim > maxDupSim) { maxDupSim = sim; dupWith = r.slug; }
  }

  const flags = [];
  if (headlineLen > t.headlineMax) flags.push(`見出しが長い (${headlineLen}>${t.headlineMax})`);
  if (leadLen > t.leadMax) flags.push(`リードが長い (${leadLen}>${t.leadMax})`);
  if (bodyLen < t.bodyMin) flags.push(`本文が短い (${bodyLen}<${t.bodyMin})`);
  if (bodyLen > t.bodyMax) flags.push(`本文が長い (${bodyLen}>${t.bodyMax})`);
  if (tagCount < t.tagsMin || tagCount > t.tagsMax) flags.push(`タグ数が範囲外 (${tagCount}∉[${t.tagsMin},${t.tagsMax}])`);
  if (!sectionOk) flags.push(`未知のセクション (${a.section})`);
  if (maxDupSim >= t.dupJaccardMax) flags.push(`話題が近い記事あり (sim=${maxDupSim.toFixed(2)} ↔ ${dupWith})`);
  if (kind === 'press' && !(a.image?.credit || '').trim()) flags.push('press画像にクレジットなし');

  return {
    slug: a.slug,
    metrics: { bodyLen, headlineLen, leadLen, tagCount, sectionOk, maxDupSim: Number(maxDupSim.toFixed(3)), imageKind: kind, importance: a.importance ?? null },
    flags,
  };
}

// --- ledger 追記 ---
// rec は evaluateArticle の戻り値に source 等を足したもの。judge 結果(scores/critique)も合流可。
export async function appendEvaluation(rec) {
  await ensureDir();
  const line = JSON.stringify({ evaluatedAt: new Date().toISOString(), source: 'objective', ...rec });
  await appendFile(EVAL_FILE, line + '\n', 'utf8');
}

// --- 実行ごとのサイト集計 ---
export async function writeRunSummary(arts, evals = []) {
  await ensureDir();
  const sectionDistribution = {};
  const importanceDistribution = {};
  let photo = 0, press = 0, fallback = 0;
  for (const a of arts) {
    sectionDistribution[a.section] = (sectionDistribution[a.section] || 0) + 1;
    const imp = a.importance ?? 'null';
    importanceDistribution[imp] = (importanceDistribution[imp] || 0) + 1;
    const k = imageKindOf(a.image);
    if (k === 'photo') photo++; else if (k === 'press') press++; else fallback++;
  }
  const totalFlags = evals.reduce((n, e) => n + (e.flags?.length || 0), 0);
  const summary = {
    ts: new Date().toISOString(),
    articleCount: arts.length,
    evaluated: evals.length,
    sectionDistribution,
    importanceDistribution,
    imageHitRate: arts.length ? Number(((photo + press) / arts.length).toFixed(3)) : 0,
    imageBreakdown: { photo, press, fallback },
    avgFlagsPerEvaluated: evals.length ? Number((totalFlags / evals.length).toFixed(2)) : 0,
  };
  // 1実行1行で追記（ファイル乱立を避け、時系列分析しやすくする）。
  await appendFile(RUNS_FILE, JSON.stringify(summary) + '\n', 'utf8');
  return summary;
}

// --- 人間キャリブレーション（高レバレッジの錨）---
export async function appendCalibration(slug, score, note = '') {
  await ensureDir();
  const line = JSON.stringify({ ratedAt: new Date().toISOString(), slug, score: Number(score), note });
  await appendFile(CALIB_FILE, line + '\n', 'utf8');
}

// --- 出典リンク死活（非ゲート・参考）---
// 多くのニュースサイトは HEAD/bot を弾くため GET＋UA＋timeout。失敗＝必ずしもリンク切れではない。
export async function checkLink(url, timeoutMs = config.timeouts.linkCheckMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AXIOM-AI-linkcheck/1.0)' },
    });
    return { url, ok: res.ok, status: res.status };
  } catch (err) {
    return { url, ok: null, status: 0, error: err.name === 'AbortError' ? 'timeout' : err.message };
  } finally {
    clearTimeout(timer);
  }
}

// 直近記事をまとめて評価（純粋計算）。返り値は { evals } で、各 eval は evaluateArticle の戻り値。
export function evaluateRecent(arts, limit = Infinity) {
  const evals = [];
  const target = arts.slice(0, limit === Infinity ? arts.length : limit);
  target.forEach((a, i) => {
    // recent = この記事より新しい順で後ろ（=より古い記事）を母集団にする
    const recent = arts.slice(i + 1);
    evals.push(evaluateArticle(a, recent));
  });
  return evals;
}

// ====================== CLI ======================
const isMain = import.meta.url === pathToFileURL(process.argv[1] || '').href;
if (isMain) {
  const args = process.argv.slice(2);

  if (args[0] === '--rate') {
    const [, slug, score, ...rest] = args;
    const n = Number(score);
    if (!slug || !Number.isFinite(n) || n < 1 || n > 5) {
      console.error('使い方: node src/evaluate.js --rate <slug> <1-5> [メモ]');
      process.exit(1);
    }
    const arts = await loadArticles();
    if (!arts.some((a) => a.slug === slug)) {
      console.error(`✗ slug が見つかりません: ${slug}`);
      process.exit(1);
    }
    await appendCalibration(slug, n, rest.join(' '));
    console.log(`✓ 評価を記録: ${slug} = ${n}/5${rest.length ? ` (${rest.join(' ')})` : ''}`);
  } else if (args[0] === '--triage') {
    // judge を走らせる必要があるかを 1/0 で stdout に出す（auto-generate.sh から呼ぶ）。
    // 低リスク（全 draft が tier:'primary' かつ客観フラグ無し）なら 0＝judge スキップ。
    // tier が 'primary' と明示されていない draft は risky 扱い（フェイルセーフ＝judge を走らせる）。
    const draftsFile = path.join(ROOT, 'data', '_drafts.json');
    let drafts = [];
    try { drafts = JSON.parse(await readFile(draftsFile, 'utf8')); } catch { process.stdout.write('0'); process.exit(0); }
    if (!Array.isArray(drafts) || !drafts.length) { process.stdout.write('0'); process.exit(0); }
    const arts = await loadArticles();
    const need = drafts.some((d) => d.tier !== 'primary' || evaluateArticle(d, arts).flags.length > 0);
    process.stdout.write(need ? '1' : '0');
  } else if (args[0] === '--link-check') {
    const arts = await loadArticles();
    const limit = Number(args[1]) || 10;
    const target = arts.slice(0, limit);
    console.log(`出典リンク死活（直近 ${target.length} 件・参考。失敗＝必ずしも切れではない）`);
    for (const a of target) {
      const r = await checkLink(a.link);
      const mark = r.ok === true ? '✓' : r.ok === null ? '?' : '✗';
      console.log(`  ${mark} [${r.status || r.error}] ${a.slug} ${a.link}`);
    }
  } else {
    // 既定: 直近記事を客観評価 → ledger 追記 → サイト集計 → 表示
    const arts = await loadArticles();
    const limit = Number(args[0]) || 20;
    const evals = evaluateRecent(arts, limit);
    for (const e of evals) await appendEvaluation({ ...e, source: 'objective' });
    const summary = await writeRunSummary(arts, evals);
    const flagged = evals.filter((e) => e.flags.length);
    console.log(`✓ 客観評価: 直近 ${evals.length} 件を採点し ledger に追記（計 ${arts.length} 記事）`);
    console.log(`  画像ヒット率 ${(summary.imageHitRate * 100).toFixed(0)}% / 平均フラグ ${summary.avgFlagsPerEvaluated} 件`);
    console.log(`  セクション分布: ${JSON.stringify(summary.sectionDistribution)}`);
    if (flagged.length) {
      console.log(`  ⚠ フラグのある記事 ${flagged.length} 件:`);
      for (const e of flagged) console.log(`    - ${e.slug}: ${e.flags.join(' / ')}`);
    } else {
      console.log('  フラグなし（すべて床を満たす）');
    }
  }
}
