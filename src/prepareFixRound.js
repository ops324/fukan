// 修正リトライの準備 — judge が「文言修正で救える」と判定した veto を抽出する。
// 決定的・LLM 不使用。stdout に対象件数だけを出す（auto-generate.sh がこれを見て分岐する）。
//
// 副作用（対象が1件以上のときだけ）:
//   data/_drafts.bak.json  … 修正前の完全バックアップ。mergeFixReview.js が原状復帰に使う
//   data/_fix_targets.json … fix-writer への入力（link/headline/critique/fixHint のみ）
//
// scores を渡さないのは意図的。数値目標を与えると「点を上げる」方向の最適化を誘発するため
// （SPEC §12.6）。fix-writer に必要なのは「出典と何が食い違っているか」だけ。
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { readVerdicts } from './reviewVerdict.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const draftsPath = path.join(ROOT, 'data', '_drafts.json');
const reviewPath = path.join(ROOT, 'data', '_review.json');
const backupPath = path.join(ROOT, 'data', '_drafts.bak.json');
const targetsPath = path.join(ROOT, 'data', '_fix_targets.json');

// 何が起きても「0」を返して素通りさせる（修正ラウンドの準備失敗で日次を止めない）。
async function main() {
  if (!config.fixRound?.enabled) return 0;

  let drafts;
  try {
    drafts = JSON.parse(await readFile(draftsPath, 'utf8'));
  } catch {
    return 0; // 下書きが無い回は対象なし
  }
  if (!Array.isArray(drafts)) return 0;

  // 判定の読み取りは src/reviewVerdict.js が正本（ingestDrafts / auto-generate.sh と同じ判断）。
  // ここが独自に JSON.parse していたため、2026-11-04 は壊れた判定を無言で「対象 0 件」として
  // 返し、fixable:true の veto 1本が修正リトライに回らなかった——しかも理由はどこにも出なかった
  // （呼び出し側が 2>/dev/null で stderr を捨てていた）。判定の解釈を増やさないこと。
  const verdict = await readVerdicts(reviewPath, drafts.map((d) => d?.link).filter(Boolean));
  if (!verdict.ok) {
    // 判定が「無い」のは正常（judge スキップ回）。「あるのに使えない」のは異常なので必ず出す。
    if (verdict.exists) console.error(`  修正リトライをスキップ: judge 判定が使えません（${verdict.reason}）`);
    return 0;
  }
  const review = verdict.rows;

  const draftByLink = new Map(drafts.filter((d) => d?.link).map((d) => [d.link, d]));
  const targets = [];
  for (const r of review) {
    if (r?.verdict !== 'veto' || r?.fixable !== true) continue;
    const d = draftByLink.get(r.link);
    if (!d) continue; // 下書きが見つからない判定は無視（突合キーは link）
    targets.push({
      link: r.link,
      headline: d.headline,
      critique: String(r.critique || ''),
      fixHint: String(r.fixHint || ''),
    });
    if (targets.length >= (config.fixRound?.maxTargets ?? 8)) break;
  }
  if (!targets.length) return 0;

  // バックアップを先に書く。これが無いと mergeFixReview は原状復帰できないので、
  // 失敗したらターゲットを書かずに諦める（＝修正ラウンドを起こさない）。
  await writeFile(backupPath, JSON.stringify(drafts, null, 2), 'utf8');
  await writeFile(targetsPath, JSON.stringify(targets, null, 2), 'utf8');
  return targets.length;
}

let count = 0;
try {
  count = await main();
} catch {
  count = 0;
}
process.stdout.write(String(count));
