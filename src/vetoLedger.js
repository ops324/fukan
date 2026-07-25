// veto ledger — judge が不採用にした下書きの「記憶」。
// 追加依存なし（Node 組み込みのみ）。LLM は使わない＝決定的。
//
// 背景: veto された下書きは ingestDrafts.js がその場で破棄し、理由は scheduler.log にしか
// 残らなかった（gitignore・機械可読でない）。結果 writer は自分の失敗を一度も見ておらず、
// 同じ型の誤り（桁・単位の誤変換が veto の約6割）を繰り返していた。ここに蓄積して
// vetoDigest.js が writer へ還流する（SPEC §12.6）。
//
// 保存先を evaluations.jsonl と分けている理由: veto 記事は slug 未採番（makeSlug は
// ingestDrafts の created.push 内）で、既存 ledger の「1公開記事=1行・slug がキー」という
// 契約を壊すため。また veto のバーストが公開記事の retention を押し出すのも避けたい。
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { appendBounded } from './evaluate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QUALITY_DIR = path.join(ROOT, 'data', 'quality');
export const VETO_FILE = path.join(QUALITY_DIR, 'vetoes.jsonl');

async function ensureDir() { await mkdir(QUALITY_DIR, { recursive: true }); }

// --- critique の分類（語彙表）---
// 置き場所について: この表は qualityDigest.js の GUIDANCE と同格の「カテゴリ→文言」対応表で、
// 正規表現のマッチ順やロジックと不可分なためモジュール内に置く（config.js は運用者が回す
// ダイヤル＝件数・しきい値のみに保つ。40本規模の正規表現を入れると一覧として読めなくなる）。
//
// 精度について: この分類は「どの是正指示を上位に出すか」の順位付けにしか使わない。
// ±10pp の誤差があっても「numeric が圧倒的1位」という結論は語彙の選び方に対して頑健。
// critique の原文は必ず保存するので、語彙表を直せば後から再分類できる（不可逆にしない）。
const CATEGORY_RULES = [
  // 数値・桁・単位。veto の最多カテゴリ（実測 約60%）。
  ['numeric', /桁|単位|\d+\s*倍(の(開き|差|乖離|誤差))?|億|兆|万ドル|百万|million|billion|trillion|[％%]|パーセント|価格|金額|誤換算|換算|数値|人数|件数|株価|売上|時価総額/],
  // 固有名詞。「『X』と記述しているが出典は『Y』」のように、カテゴリ語を使わず鉤括弧の
  // ペアで対比する critique が多いため、括弧2組（中身が非数値）のパターンも拾う。
  ['entity', /固有名詞|人名|社名|企業名|大学|機関名|氏名|名前を|綴り|正式名称|取り違え|[「『][^」』\d]{2,40}[」』][^。]{0,40}(出典|正しく|実際)[^。]{0,20}[「『][^」』]{2,60}[」』]/],
  // 下書き“内部”の不整合に限定する（出典との不一致は numeric/entity 側に寄せる）。
  // writer への指示が根本的に違うため混ぜない: 内部矛盾＝書いた後に突き合わせろ／
  // 出典との不一致＝出典を取り直せ。
  ['contradiction', /見出しと本文|リードと本文|本文と見出し|内訳|合計(が|は)|自己矛盾|内部矛盾|整合(し|が)(ない|とれ)/],
  // 出典に無いことを書いた（創作）。
  ['fabrication', /創作|出典にない|出典に(は)?(記載|言及)がない|書かれていない|存在しない|捏造|根拠がない|独自に(追加|付加)|推測で|事実に反する/],
  // 日付・時系列。「20XX年」だけだと広すぎるので、誤り指摘の文脈を伴う場合に限る。
  // 同一文中に異なる年号が2つ並ぶのは「出典はX年だが本文はY年」の典型（例: 2026年初頭 vs 2024年初期）。
  ['date', /日付(が|の)(誤|間違|不一致)|発表日|時系列|年月日|20\d\d年[^。]{0,20}(誤|実際は|正しく|ではなく)|20\d\d年[^。]{0,60}20\d\d年/],
  // 出典が取れず検証できない＝修正では救えない唯一のカテゴリ。
  ['unreachable', /取得できな|アクセス(でき|不能|不可)|403|404|取得不可|裏取りできな|検証(でき|が)ない|到達できな|ファクトチェックが(実施)?でき/],
];

// 「誤記」「正しくは」は固有名詞にも数値にも使われる弱いシグナル。数値カテゴリに該当する
// critique（例:「$5を$1と誤記」）でこれを entity に数えると固有名詞の件数が水増しされるため、
// numeric 非該当のときだけ entity として採用する（意味論的にも数値の誤記は numeric が正しい）。
const ENTITY_WEAK = /誤記|正しくは|表記が/;

// critique（judge の1-2文）からカテゴリ配列を返す純関数。該当なしは空配列。
export function classifyCritique(critique) {
  const s = String(critique || '');
  if (!s.trim()) return [];
  const cats = CATEGORY_RULES.filter(([, re]) => re.test(s)).map(([name]) => name);
  if (!cats.includes('entity') && !cats.includes('numeric') && ENTITY_WEAK.test(s)) cats.push('entity');
  return cats;
}

// --- 書き込み ---
// rec は呼び出し側が組み立てる（link/headline/critique/scores 等）。categories は critique から
// 自動付与する（呼び出し側が渡していれば尊重）。
function toLine(rec) {
  return JSON.stringify({
    vetoedAt: new Date().toISOString(),
    categories: classifyCritique(rec?.critique),
    stage: 'initial',
    outcome: 'discarded',
    origin: 'runtime',
    ...rec,
  });
}

export async function appendVeto(rec) {
  await ensureDir();
  await appendBounded(VETO_FILE, toLine(rec), config.ledger?.vetoMaxLines ?? 2000);
}

// 一括追記（遡及シード用）。169件を1件ずつ appendBounded に通すと毎回ファイル全体を
// 読み直すため、最後の1件だけ appendBounded に渡して有界化を1回だけ効かせる。
export async function appendVetoes(recs) {
  if (!Array.isArray(recs) || !recs.length) return 0;
  await ensureDir();
  const lines = recs.map(toLine);
  const last = lines.pop();
  if (lines.length) await appendFile(VETO_FILE, lines.join('\n') + '\n', 'utf8');
  await appendBounded(VETO_FILE, last, config.ledger?.vetoMaxLines ?? 2000);
  return recs.length;
}

// --- 読み出し ---
// 末尾 maxRows 行を読み、windowDays で時刻フィルタしてから新しい順に返す。
// 「末尾＝直近」を仮定せず vetoedAt でソートするのは、遡及シードで古い行が後から
// 追記されるため（順序依存を設計から排除する）。
export async function readVetoes({ windowDays = 0, maxRows = 4000 } = {}) {
  let content;
  try { content = await readFile(VETO_FILE, 'utf8'); } catch { return []; }
  const lines = content.split('\n').filter(Boolean).slice(-maxRows);
  const rows = [];
  for (const l of lines) {
    try { rows.push(JSON.parse(l)); } catch { /* 壊れた行は飛ばす（記録の故障で止めない） */ }
  }
  const cutoff = windowDays > 0 ? Date.now() - windowDays * 86400000 : 0;
  return rows
    .filter((r) => {
      if (!cutoff) return true;
      const t = Date.parse(r?.vetoedAt || '');
      return Number.isNaN(t) ? true : t >= cutoff; // 時刻不明は落とさない
    })
    .sort((a, b) => String(b?.vetoedAt || '').localeCompare(String(a?.vetoedAt || '')));
}
