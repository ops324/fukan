// judge 判定（data/_review.json）の読み取り — 「その判定は使えるか」の唯一の正本。
//
// 背景（2026-11-04）: judge は 25本中3本を veto と判定して _review.json を書き出したが、
// 中身が壊れた JSON だった。auto-generate.sh のガードは **ファイルの存在（-f）しか見ていない**
// ため「査読は成功した」と扱われ、judge_absent も Slack 通知も出ないまま、ingestDrafts が
// 判定を読めずに veto を無視して3本（桁誤り・出典に無い記述を含む）を取り込んだ。
// 記事は正常に見えるので、push が GitHub の 500 で失敗していなければそのまま公開されていた。
//
// 設計: 「使える判定か」の判断をここ1か所に閉じ、ガード（auto-generate.sh）と消費側
// （ingestDrafts.js / prepareFixRound.js）が同じ答えを見る。別々に判定すると
// 「ガードは通すが消費側は読めない」＝veto が無言で消える、というズレが再発する。
// tagSlug.js と同じ考え方で、配線の外れは check.js が合成入力で検知する。
//
// 「使えない」と判定したときに日次を止めないのは SPEC §12 のとおり（評価機構の故障で
// 公開事故や停止を招かない）。ここが返すのは事実だけで、止めるかどうかは呼び出し側が決める。
import { readFile } from 'node:fs/promises';

export const VERDICTS = new Set(['pass', 'veto']);

// 判定1行として使えるか。必須は link と verdict だけ（scores や critique が無くても
// veto は尊重できる。必須を増やすと、欠けただけで veto が丸ごと無効になる方向に倒れる）。
export function isUsableRow(r) {
  return !!r && typeof r === 'object' && !Array.isArray(r)
    && typeof r.link === 'string' && r.link.trim() !== ''
    && VERDICTS.has(r.verdict);
}

// _review.json の中身（文字列）を検査する純関数。
// draftLinks を渡すと「判定が付かなかった下書き」= missing を数える。
//   ok=false … 判定として使えない（呼び出し側は judge 不在と同じに扱う）
//   ok=true かつ complete=false … 読めたぶんは使えるが、一部の下書きが未査読
// 壊れた行を落として続けるのは意図的: 1行の不備で veto 全部を捨てると、
// 正しく読めた veto まで公開されてしまう（検出のために事故を広げることになる）。
export function validateVerdicts(raw, draftLinks = []) {
  const base = { ok: false, complete: false, rows: [], total: 0, usable: 0, dropped: 0, missing: 0 };
  if (raw == null) return { ...base, reason: '判定ファイルがありません' };

  let parsed;
  try {
    parsed = JSON.parse(String(raw));
  } catch (err) {
    return { ...base, reason: `不正な JSON です: ${err.message}` };
  }
  if (!Array.isArray(parsed)) {
    return { ...base, reason: `配列ではありません（${parsed === null ? 'null' : typeof parsed}）` };
  }

  const rows = parsed.filter(isUsableRow);
  const total = parsed.length;
  const dropped = total - rows.length;
  if (!rows.length) {
    return { ...base, total, dropped, reason: `link と verdict を持つ行がありません（${total} 行を検査）` };
  }

  const judged = new Set(rows.map((r) => r.link));
  const missing = draftLinks.filter((l) => typeof l === 'string' && l && !judged.has(l)).length;
  const complete = dropped === 0 && missing === 0;
  const notes = [];
  if (dropped) notes.push(`形式不備で無視した行 ${dropped} 件`);
  if (missing) notes.push(`判定が付かなかった下書き ${missing} 件`);

  return {
    ok: true,
    complete,
    rows,
    total,
    usable: rows.length,
    dropped,
    missing,
    reason: complete ? `判定 ${rows.length} 件を読み込みました` : notes.join('・'),
  };
}

// ファイルから読んで検査する。存在しない場合も ok=false（判定が無いのと使えないのを
// 呼び出し側で区別したいときは exists を見る）。
export async function readVerdicts(reviewPath, draftLinks = []) {
  let raw = null;
  let exists = true;
  try {
    raw = await readFile(reviewPath, 'utf8');
  } catch {
    exists = false;
  }
  return { ...validateVerdicts(exists ? raw : null, draftLinks), exists };
}

// --- CLI: node src/reviewVerdict.js --validate [--review <path>] [--drafts <path>] ---
// auto-generate.sh のガードが「消費側と同じ判断」を得るための入口。
// 終了コードで答える（stdout を解析させると、書式を変えた瞬間にガードが沈黙する）:
//   0 … 判定は使えて、全下書きに判定が付いている
//   1 … 判定として使えない（judge 不在と同じに扱う）
//   2 … 読めたぶんは使えるが、一部が未査読／形式不備
// 理由は stderr に出す（scheduler.log に残る）。
// --review / --drafts を取るのは check.js が合成フィクスチャで終了コードを検証するため
// （既定パスだけだと、退行検査が作業ツリーの data/ を汚さずに検証できない）。
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href
    && process.argv.includes('--validate')) {
  const { default: path } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const argOf = (name) => {
    const i = process.argv.indexOf(name);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
  };
  const reviewPath = argOf('--review') || path.join(ROOT, 'data', '_review.json');
  const draftsPath = argOf('--drafts') || path.join(ROOT, 'data', '_drafts.json');

  let draftLinks = [];
  try {
    const drafts = JSON.parse(await readFile(draftsPath, 'utf8'));
    if (Array.isArray(drafts)) draftLinks = drafts.map((d) => d?.link).filter(Boolean);
  } catch { /* 下書きが読めないなら網羅性は測れない。判定自体の検査は続ける */ }

  const v = await readVerdicts(reviewPath, draftLinks);
  if (!v.ok) {
    console.error(`  judge 判定が使えません: ${v.reason}`);
    process.exit(1);
  }
  if (!v.complete) {
    console.error(`  judge 判定が不完全です: ${v.reason}（読めた ${v.usable} 件は尊重して続行）`);
    process.exit(2);
  }
  console.error(`  judge 判定 OK: ${v.usable} 件`);
  process.exit(0);
}
