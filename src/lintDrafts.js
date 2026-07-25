// 下書きの決定論リント（writer 自身が自己批評で実行する検算器）。
// 追加依存なし（Node 組み込みのみ）。LLM もネットワークも使わない＝毎回同じ結果。
//
// 背景: veto の最多カテゴリは一貫して numeric（数値・桁・単位）で、対策はこれまで
// プロンプトの文言だけだった。文言は「読んだつもり」で素通りできるが、実行される検査は
// 素通りできない。2026-07-25 の差し戻し4件は、いずれも**出典を見なくても機械的に
// 疑える形**をしていた:
//   - リード「Brent原油は100ドル超」… 同じ回の別記事（フーシ派の攻撃）の数値が紛れ込み、
//     本文にも出典にも無い（→ summary / crosstalk）
//   - リード「Fable 5の半値」× 本文「およそ3分の1」… 同一対象を別の比率で書いた（→ ratio）
//   - 出典 45 billion light-years を「約45億光年」… 桁違い（→ 出典照合が要るので検出対象外だが、
//     同記事内の「137億光年」と併記された時点で ratio/summary 側に痕跡が出る）
// ここで拾うのは**出典を読まずに分かる矛盾だけ**。出典との照合は judge の仕事であり、
// この検査はそれを代替しない（前段で安い矛盾を落とし、judge を本質的な照合に集中させる）。
//
// 重要な規律:
//  - すべて**警告**。この検査は公開を止めない（exit は常に 0）。壊れても日次を止めない。
//  - 指摘の解消を「数値を消す」で行わせない。出力文言でそれを明示する
//    （値の削除・曖昧化での辻褄合わせは review-fixed.md でも veto 相当としている）。
//  - 偽陽性は前提。writer/judge には「確認の起点であって判定ではない」と伝える。
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { config } from './config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRAFTS_FILE = path.join(ROOT, 'data', '_drafts.json');

// --- 数量表現の抽出 ---
// 単位を明示列挙する（「年」「月」「日」は日付なので入れない＝日付は別カテゴリの担当）。
// 「兆|億|万」は単独でも接頭でも来る（370兆／45億光年／101.6兆円）ため両方を受ける。
const UNIT = [
  '(?:兆|億|万)?(?:ドル|円|ユーロ|ポンド|ウォン|人|名|件|社|台|機|隻|棟|光年|キロ|トン|バレル|議席|票|ポイント|ギガワット|メガワット|テラワット)',
  '(?:兆|億|万)',
  '[%％]',
  '割',
  '倍',
].join('|');
const QUANTITY_RE = new RegExp(`(\\d[\\d,]*(?:\\.\\d+)?)\\s*(${UNIT})`, 'g');

// 全角数字・全角記号を半角に寄せる（表記揺れで同じ値を別物と数えないため）。
export function normalizeDigits(s = '') {
  return String(s)
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[，、]/g, ',')
    .replace(/．/g, '.');
}

// テキストから数量表現を取り出し、正規化キーの集合を返す（例: "100ドル", "3.1ギガワット"）。
export function extractQuantities(text = '') {
  const s = normalizeDigits(text);
  const out = new Map(); // key -> 原文の見え方（メッセージ用）
  for (const m of s.matchAll(QUANTITY_RE)) {
    const value = m[1].replace(/,/g, '');
    const unit = m[2].replace('％', '%');
    out.set(`${value}${unit}`, `${m[1]}${m[2]}`);
  }
  return out;
}

// --- 比率表現（半値・3分の1・2倍・3割）---
// 桁ではなく「同じ対象を別の比率で書く」型の矛盾を拾う。数値の一致検査では捕まらない
// （「半値」に数字が無いため）。実際に Opus 5 の記事がこの形で差し戻された。
const RATIO_RE = /半値|半額|半分|\d+\s*分の\s*\d+|\d[\d,.]*\s*倍|[1-9]\s*割/g;
export function extractRatios(text = '') {
  const s = normalizeDigits(text);
  return new Set((s.match(RATIO_RE) || []).map((x) => x.replace(/\s+/g, '')));
}

// --- 特徴語（固有名詞らしいトークン）---
// 英字3字以上とカタカナ3字以上。漢字語は一般語が大量に混じるため採らない。
const EN_TOKEN_RE = /[A-Za-z][A-Za-z0-9]{2,}/g;
const KANA_TOKEN_RE = /[ァ-ヶ][ァ-ヶー]{2,}/g;
// どの記事にも出うる一般語。混入検出のノイズになるので除く（固有名詞は残す）。
const TOKEN_STOP = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'http', 'https', 'www', 'com', 'net', 'org',
  'html', 'json', 'news', 'inc', 'llc', 'ltd',
  'サービス', 'プラットフォーム', 'テクノロジー', 'ユーザー', 'データ', 'モデル', 'システム',
  'コスト', 'ソフトウェア', 'ハードウェア', 'アプリ', 'ネットワーク', 'セキュリティ', 'エネルギー',
  'グローバル', 'ビジネス', 'マーケット', 'リリース', 'アップデート', 'プロジェクト', 'パートナー',
  'メディア', 'ニュース', 'レポート', 'ツール', 'サーバー', 'クラウド', 'エンジニア', 'メーカー',
]);
// counts: 正規化トークン -> 出現回数、display: 正規化トークン -> 原文の表記（メッセージ用）。
export function featureTokenCounts(text = '') {
  const counts = new Map();
  const display = new Map();
  const add = (raw) => {
    const t = /[A-Za-z]/.test(raw) ? raw.toLowerCase() : raw;
    if (TOKEN_STOP.has(t)) return;
    counts.set(t, (counts.get(t) || 0) + 1);
    if (!display.has(t)) display.set(t, raw);
  };
  for (const m of String(text).match(EN_TOKEN_RE) || []) add(m);
  for (const m of String(text).match(KANA_TOKEN_RE) || []) add(m);
  return { counts, display };
}

// --- 個別の下書きに対する検査（出典不要）---
function isJapaneseSource(link = '') {
  try {
    const host = new URL(link).hostname.toLowerCase();
    return host.endsWith('.jp') || host.endsWith('.jp.');
  } catch {
    return false;
  }
}

export function lintDraft(draft = {}) {
  const findings = [];
  const headline = String(draft.headline || '');
  const lead = String(draft.lead || '');
  const body = String(draft.body_markdown || '');
  const summaryLayer = `${headline}\n${lead}`;

  // 1) 要約層（見出し・リード）の数量が本文に無い。
  // 本文に根拠が無い数値を要約層だけが主張している状態で、別記事からの混入・記憶で書いた
  // 数値がここに出る（Trump 関税記事のリード「Brent原油は100ドル超」がこの形だった）。
  const bodyQty = extractQuantities(body);
  for (const [key, raw] of extractQuantities(summaryLayer)) {
    if (bodyQty.has(key)) continue;
    findings.push({
      code: 'summary-only-number',
      message: `見出し/リードの「${raw}」が本文にありません。出典にある値なら本文でも示す（見出しから消して辻褄を合わせない）。出典に無い値なら、その記述自体が誤り`,
    });
  }

  // 2) 同一記事内で比率表現が食い違う（要約層が比率を主張しているときだけ見る）。
  const ratios = extractRatios(`${summaryLayer}\n${body}`);
  const summaryRatios = extractRatios(summaryLayer);
  if (ratios.size >= 2 && summaryRatios.size >= 1) {
    findings.push({
      code: 'ratio-conflict',
      message: `比率表現が複数あります（${[...ratios].join(' / ')}）。同じ対象を別の比率で書いていないか出典と照合する`,
    });
  }

  // 3) 円建ての数値（出典が日本語圏でない場合）。為替レートは出典に無いので、
  //    自分で換算していれば「出典に無い数値」になる。出典自身が円で報じているなら問題ない。
  if (!isJapaneseSource(draft.link) && /\d[\d,.]*\s*(?:兆|億|万)?円/.test(normalizeDigits(body))) {
    findings.push({
      code: 'currency-conversion',
      message: '円建ての数値があります。出典が円で報じているなら可。自分で為替換算していないか確認する',
    });
  }

  // 4) 全角合成文字（㌦㌫㌧ 等）。プロンプトで禁止している表記の機械検出。
  const composite = (`${summaryLayer}${body}`.match(/[㌀-㏿]/g) || [])[0];
  if (composite) {
    findings.push({
      code: 'composite-char',
      message: `全角合成文字「${composite}」が入っています。「ドル」「%」のように素の表記にする`,
    });
  }

  return findings;
}

// --- 下書き横断の検査（記事間の取り違え）---
// judge だけが全下書きを横断して見られる層だったが、この形の混入は出典を読まずに疑える。
// 稀語（同じ回で2本にしか出ない特徴語）が、一方では主役（見出し/リードに出る・複数回出る）で、
// もう一方では1回しか出ない——このとき後者への混入を疑う。
//
// corpus（直近の公開記事）を渡すと、このサイトで**ありふれた語**を除外する。渡さないと
// 「データセンター」「アクセス」「Nvidia」のような常出語まで拾って指摘が実測 4 倍に膨らみ、
// 本当の混入（Brent／アラムコのような df=0 の語）が埋もれる。判定に使うのは文書頻度だけ
// （直近 corpusRecent 本のうち何本に出るか）で、ネットワークも LLM も要らない。
export function buildCorpusDf(corpus = []) {
  const recent = corpus.slice(0, config.draftLint?.corpusRecent ?? 300);
  const df = new Map();
  for (const a of recent) {
    const { counts } = featureTokenCounts(`${a?.headline || ''}\n${a?.lead || ''}\n${a?.body_markdown || ''}`);
    for (const t of counts.keys()) df.set(t, (df.get(t) || 0) + 1);
  }
  return df;
}

export function lintCrossDrafts(drafts = [], corpusDf = new Map()) {
  const maxDrafts = config.draftLint?.crosstalkMaxDrafts ?? 2;
  const dfMax = config.draftLint?.corpusDfMax ?? 3;
  const perDraft = drafts.map((d) => {
    const headline = String(d?.headline || '');
    const lead = String(d?.lead || '');
    const { counts, display } = featureTokenCounts(`${headline}\n${lead}\n${String(d?.body_markdown || '')}`);
    return { summaryLayer: `${headline}\n${lead}`, counts, display, headline };
  });

  // token -> 出現した下書き index の配列
  const index = new Map();
  perDraft.forEach((p, i) => {
    for (const t of p.counts.keys()) {
      if (!index.has(t)) index.set(t, []);
      index.get(t).push(i);
    }
  });

  const findings = drafts.map(() => []);
  for (const [token, owners] of index) {
    if (owners.length < 2 || owners.length > maxDrafts) continue; // 全体に散る一般語は対象外
    if ((corpusDf.get(token) || 0) >= dfMax) continue;            // サイトの常出語（一般語・常連企業名）は対象外
    for (const i of owners) {
      if (perDraft[i].counts.get(token) !== 1) continue; // この記事では1回だけ＝浮いている
      const other = owners.find((j) => {
        if (j === i) return false;
        const p = perDraft[j];
        return p.counts.get(token) >= 2 || p.summaryLayer.includes(p.display.get(token));
      });
      if (other === undefined) continue;
      findings[i].push({
        code: 'crosstalk',
        message: `「${perDraft[other].display.get(token)}」は同じ回の別記事（${perDraft[other].headline.slice(0, 24)}…）の語で、この記事には1回しか出ません。その記事の出典に実在するか確認する`,
      });
    }
  }
  return findings;
}

// --- 全体（下書き配列 → 指摘）---
// corpus は直近の公開記事（任意）。渡すと混入判定からサイトの常出語を除ける（推奨）。
export function lintDrafts(drafts = [], corpus = []) {
  if (!Array.isArray(drafts) || !drafts.length) return [];
  if (config.draftLint?.enabled === false) return [];
  const cross = lintCrossDrafts(drafts, buildCorpusDf(corpus));
  const max = config.draftLint?.maxFindingsPerDraft ?? 6;
  return drafts
    .map((d, i) => ({
      index: i,
      headline: String(d?.headline || ''),
      link: String(d?.link || ''),
      findings: [...lintDraft(d), ...cross[i]].slice(0, max),
    }))
    .filter((r) => r.findings.length);
}

// 人が読む形（writer の stdout・judge への注記）に整形する。
export function formatLintReport(results = []) {
  if (!results.length) return '';
  const lines = [];
  for (const r of results) {
    lines.push(`- ${r.headline || r.link}`);
    for (const f of r.findings) lines.push(`  ・[${f.code}] ${f.message}`);
  }
  return lines.join('\n');
}

// ====================== CLI ======================
// 使い方:
//   node src/lintDrafts.js          … data/_drafts.json を検査して人が読む形で出力
//   node src/lintDrafts.js --json   … 同じ結果を JSON で出力（機械処理用）
// 終了コードは常に 0。この検査は公開を止めない（判定は judge の仕事）。
const isMain = import.meta.url === pathToFileURL(process.argv[1] || '').href;
if (isMain) {
  const asJson = process.argv.includes('--json');
  let drafts = [];
  try {
    drafts = JSON.parse(await readFile(DRAFTS_FILE, 'utf8'));
  } catch {
    if (asJson) process.stdout.write('[]\n');
    else console.log('下書き（data/_drafts.json）がありません。');
    process.exit(0);
  }
  // 公開済み記事は「サイトの常出語」を判定する母集団（混入検出のノイズ抑制）。読めなくても検査は続ける。
  let corpus = [];
  try {
    const { loadArticles } = await import('./store.js');
    corpus = await loadArticles();
  } catch { /* 記事が読めなくても lint は動く（常出語の除外が効かなくなるだけ） */ }
  const results = lintDrafts(drafts, corpus);
  if (asJson) {
    process.stdout.write(`${JSON.stringify(results)}\n`);
    process.exit(0);
  }
  // 機械可読の写しも残す（auto-generate.sh が件数を読む／後追いで中身を確認できる）。
  // 書けなくても検査結果の表示は続ける（一時ファイルの失敗で日次を止めない）。
  try {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path.join(ROOT, 'data', '_lint.json'), `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  } catch { /* 書けなくても続行 */ }
  if (!results.length) {
    console.log(`✓ 下書きリント: ${Array.isArray(drafts) ? drafts.length : 0} 本に機械的な疑いはありません。`);
    process.exit(0);
  }
  console.log(`⚠ 下書きリント: ${results.length}/${drafts.length} 本に確認すべき点があります（偽陽性を含みます）。`);
  console.log(formatLintReport(results));
  console.log('');
  console.log('直し方: 出典に戻って**正しい値に書き換える**。数値や固有名詞を削って黙らせない');
  console.log('（削除・曖昧化で辻褄を合わせるのは訂正ではなく回避で、再査読で veto されます）。');
  console.log('出典に無い記述だった場合のみ、削除が正しい訂正です。');
  process.exit(0);
}
