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
import { atomicWrite } from './atomicWrite.js';
import { config } from './config.js';
import { pressAllowlistCredit } from './pressImage.js';

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

// --- 二重掲載の検出（表記揺れに強い特徴語ベース）---
// 見出し＋リードから「特徴語」＝英字トークン(3字以上)と数値を取る。固有名詞・型番・序数が残る。
// 背景: topicTokens の日本語 bigram は**表記揺れに弱い**。同じ Starship 試験飛行を
// 「スペックス Starship第13次…」と「SpaceX Starship第13次…」で書いた2本の Jaccard は 0.278 しかなく、
// 警告閾値(0.6)にも届かず二重掲載を許した（2026-07-25）。英数字は表記が揺れないので同一性が残る。
export function featureTokens(a) {
  const s = `${a?.headline || ''} ${a?.lead || ''}`;
  const en = (s.match(/[A-Za-z][A-Za-z0-9]{2,}/g) || []).map((x) => x.toLowerCase());
  const num = s.match(/\d+/g) || [];
  return new Set([...en, ...num]);
}

// a の特徴語が recent のどれか1本にどれだけ含まれるか（**非対称**の包含率）を返す。
// Jaccard ではなく包含率にするのは、片方の見出しが長くても同一トピックを捕まえたいため
// （上の実例は Jaccard 0.278 に対し包含率 0.83）。shared も返すのは、特徴語が1〜2語しかない
// 記事だと包含率が簡単に 1.0 になるため、呼び出し側で「共通語数」の下限も課すため。
export function maxFeatureContainment(a, recent = []) {
  const fa = featureTokens(a);
  if (!fa.size) return { ratio: 0, shared: 0, against: null };
  let best = { ratio: 0, shared: 0, against: null };
  for (const r of recent) {
    const fr = featureTokens(r);
    let shared = 0;
    for (const t of fa) if (fr.has(t)) shared++;
    if (!shared) continue;
    const ratio = shared / fa.size;
    if (shared > best.shared || (shared === best.shared && ratio > best.ratio)) {
      best = { ratio, shared, against: r.slug || r.headline || null };
    }
  }
  return best;
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

// --- ledger 追記（有界化つき）---
// 純追記だと jsonl が無制限成長し auto-commit に載り続けるため、maxLines+margin を超えたら
// 直近 maxLines 行に切り詰め、溢れた古い行は gitignore 済みの <file>.archive.jsonl へ退避する。
// 追記は毎回・有界化は margin ごと（間は純追記＝git 差分は末尾1行のみで小さい）。
export async function appendBounded(file, line, maxLines) {
  await appendFile(file, line + '\n', 'utf8');
  const margin = config.ledger?.margin ?? 500;
  if (!maxLines || maxLines <= 0) return;
  let content;
  try { content = await readFile(file, 'utf8'); } catch { return; }
  const lines = content.split('\n').filter(Boolean);
  if (lines.length <= maxLines + margin) return; // まだ余裕あり → 純追記のまま
  const keep = lines.slice(-maxLines);
  const dropped = lines.slice(0, -maxLines);
  // 履歴はローカルの archive に退避（gitignore 済み＝git は肥大しない）。
  // 退避を切り詰めより先に行う順序は維持する——この間で落ちても失われるのは
  // 「archive に重複が入る」だけで、行の消失は起きない（失敗の向きが安全側）。
  await appendFile(`${file}.archive.jsonl`, dropped.join('\n') + '\n', 'utf8');
  // 切り詰めは原子的に。ledger は git 追跡対象なので、中途半端な truncate が
  // そのまま commit・push されると壊れた行が本番リポジトリに残る。
  // 読み手（vetoLedger / check）は壊れた行を skip する作りなので、静かに件数が減って気づけない。
  await atomicWrite(file, keep.join('\n') + '\n');
}

// rec は evaluateArticle の戻り値に source 等を足したもの。judge 結果(scores/critique)も合流可。
export async function appendEvaluation(rec) {
  await ensureDir();
  const line = JSON.stringify({ evaluatedAt: new Date().toISOString(), source: 'objective', ...rec });
  await appendBounded(EVAL_FILE, line, config.ledger?.evalMaxLines ?? 4000);
}

// この run が評価した記事のうち、「公式プレス画像が付くはず（allowlist出典・importance十分）なのに
// stock写真に落ちた」件数。fetchPressImage の silent failure（例: UAをドメインに拒否され続ける等）の
// 再発を検知するためのセンチネル。既存記事全体ではなく evals（＝この run が触った記事）だけを対象にする
// ことで、対応しないと決めたレガシーの積み残しに埋もれず「今回増えたかどうか」を可視化する。
// importance 不足で press を試みてすらいない記事（image kind='fallback'）は誤検知になるため除外し、
// 実際に stock（kind='photo'）に落ちたものだけを数える。
function countPressAllowlistMisses(arts, evals) {
  const bySlug = new Map(arts.map((a) => [a.slug, a]));
  const minImportance = config.pressImage?.minImportance ?? config.imageImportanceFloor;
  let misses = 0;
  for (const e of evals) {
    const a = bySlug.get(e.slug);
    if (!a) continue;
    if ((Number(a.importance) || 3) < minImportance) continue; // press 対象外
    if (!pressAllowlistCredit(a.link || '')) continue; // 非許可ドメイン（press対象外）
    if (imageKindOf(a.image) === 'photo') misses++; // press が付くはずが stock に落ちた
  }
  return misses;
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
    // この run で評価した記事に限った「公式出典なのにstock」件数（累積ではない。回帰検知用センチネル）。
    pressAllowlistMiss: countPressAllowlistMisses(arts, evals),
    avgFlagsPerEvaluated: evals.length ? Number((totalFlags / evals.length).toFixed(2)) : 0,
  };
  // 1実行1行で追記（ファイル乱立を避け、時系列分析しやすくする）。有界化つき。
  await appendBounded(RUNS_FILE, JSON.stringify(summary), config.ledger?.runsMaxLines ?? 2000);
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
    // 決定論リント（lintDrafts）の指摘も「高リスク」の材料にする。数値の食い違いや別記事からの
    // 語の混入は、まさに独立検証（judge の出典照合）が要る型なので、ここで judge を確実に走らせる。
    let lintFlagged = 0;
    try {
      const { lintDrafts } = await import('./lintDrafts.js');
      lintFlagged = lintDrafts(drafts, arts).length;
    } catch { /* リントの失敗で triage を止めない（従来どおり tier とフラグで判定する） */ }
    const need = lintFlagged > 0 || drafts.some((d) => d.tier !== 'primary' || evaluateArticle(d, arts).flags.length > 0);
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
    if (summary.pressAllowlistMiss > 0) {
      console.log(`  ⚠ 公式出典なのにstock画像に落ちた記事（今回評価分）: ${summary.pressAllowlistMiss} 件`);
    }
    console.log(`  セクション分布: ${JSON.stringify(summary.sectionDistribution)}`);
    if (flagged.length) {
      console.log(`  ⚠ フラグのある記事 ${flagged.length} 件:`);
      for (const e of flagged) console.log(`    - ${e.slug}: ${e.flags.join(' / ')}`);
    } else {
      console.log('  フラグなし（すべて床を満たす）');
    }
  }
}
