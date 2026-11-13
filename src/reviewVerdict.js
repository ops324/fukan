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

// --- 破損した判定の救済 ---
// 2026-11-07 / 11-10 の本番ランで _review.json が2回 parse 不能になり、judge は veto を
// 出していたのに判定が丸ごと失われ、計6本（100倍の単位誤り・見出しの参加国誤りを含む）が
// 公開された。PR #49 のガードは judge_absent を記録し通知し原本を退避したが、veto の適用
// そのものは防げていない——**損失を可視化しただけで、損失を防いでいなかった**。
//
// 原因は judge のエスケープ漏れ。日本語の prose の中で英語を ASCII の二重引用符で囲み、
// 自分の JSON を壊す（11-07 は position 2216 の "Alice Huang"、11-10 は position 683 の
// "cash-out-1-75-billion"。どちらも suggestions 内）。根本は prompts/review-drafts.md 側で
// 直すが、LLM の出力なので「壊れない」を前提にはできない。ここは保険。
//
// 要点: 壊れるのは prose フィールドで、しかも **判定の判断に使うのは link と verdict だけ**
// （isUsableRow）。つまり判定に不要なフィールドのせいで判定全体が失われていた。
// 救済はその非対称を解く。情報を落とす量が少ない順に試し、落とせない1件は捨てる。
// **推測で補完はしない**——判定を創作すると judge が居ないのと同じになる。

// 壊れやすい prose フィールドを、**捨ててよい順に**並べる。順に1つずつ足して捨てていき、
// parse できた時点で止める（まとめて捨てると、要らない1つのために要るものまで失う）。
//   suggestions … どこからも読まれない（judge の提案メモ）
//   fixHint     … prepareFixRound が修正リトライの入力に使う。捨てると hint 無しで修正に回る
//                 （veto 自体は守れるが、修正の当たりが落ちる）
const FRAGILE_FIELDS = ['suggestions', 'fixHint'];

// スカラー文字列フィールドを「行まるごと」で拾う。行に閉じるまで引用符を含まないことを
// 要求するのが要で、critique 内の URL を link と取り違えない（judge は fixHint に出典 URL を
// 書くため、行アンカー無しだと別記事の URL を掴む）。
function lineScalar(chunk, key) {
  const m = chunk.match(new RegExp(`^\\s*"${key}"\\s*:\\s*"([^"\\n]*)"\\s*,?\\s*$`, 'm'));
  return m ? m[1] : null;
}

// インデント幅つきの行構造でトップレベルのオブジェクトに切る。
// 括弧の数え上げは使えない——エスケープ漏れの引用符が文字列の内外判定を壊すため、
// 数え上げは破損オブジェクトの境界を取り違える（実測で先頭の veto を取り落とした）。
// 一方 judge の出力は常に整形済みで、配列要素だけが「行頭インデント＋単独の {」で始まる
// （入れ子の scores は `"scores": {` と行内で開くので誤検出しない）。
function splitObjectChunks(raw) {
  const lines = String(raw).split('\n');
  const chunks = [];
  for (let i = 0; i < lines.length; i += 1) {
    const open = lines[i].match(/^(\s*)\{\s*$/);
    if (!open) continue;
    const indent = open[1];
    // 同じインデントで閉じる行を探す（深い位置の `},` は要素の終わりではない）。
    for (let j = i + 1; j < lines.length; j += 1) {
      if (new RegExp(`^${indent}\\},?\\s*$`).test(lines[j])) {
        chunks.push(lines.slice(i, j + 1).join('\n').replace(/,\s*$/, ''));
        i = j;
        break;
      }
    }
  }
  return chunks;
}

// 指定フィールドをテキストとして切り落とす。キーの直後から、次のキー（または
// オブジェクトの終わり）の直前までを捨てる。壊れた引用符に依存しないのが利点。
function dropFields(chunk, keys) {
  let s = chunk;
  for (const key of keys) {
    s = s.replace(
      new RegExp(`^\\s*"${key}"\\s*:[\\s\\S]*?(?=^\\s*"[A-Za-z_][\\w]*"\\s*:|^\\s*\\}\\s*$)`, 'm'),
      '',
    );
  }
  return s.replace(/,(\s*[}\]])/g, '$1');
}

// 1オブジェクト分のテキストを行に変える。how は「どこまで復元できたか」。
function recoverRow(chunk) {
  try {
    const r = JSON.parse(chunk);
    if (isUsableRow(r)) return { row: r, how: 'full' };
  } catch { /* 次の手を試す */ }

  // 捨ててよい順に1つずつ足して捨て、parse できた時点で止める。
  for (let n = 1; n <= FRAGILE_FIELDS.length; n += 1) {
    const trimmed = dropFields(chunk, FRAGILE_FIELDS.slice(0, n));
    if (trimmed === chunk) continue;
    try {
      const r = JSON.parse(trimmed);
      if (isUsableRow(r)) return { row: r, how: 'trimmed' };
    } catch { /* 次のフィールドも捨てて試す */ }
  }

  // 最小復元: link と verdict だけ。critique が壊れていても veto は veto として尊重する
  // （必須を増やすと「欠けただけで veto が無効」に倒れる、という isUsableRow と同じ理由）。
  const link = lineScalar(chunk, 'link');
  const verdict = lineScalar(chunk, 'verdict');
  if (link && link.trim() && VERDICTS.has(verdict)) {
    const row = { link, verdict };
    const critique = lineScalar(chunk, 'critique');
    if (critique) row.critique = critique;
    // scores は数値だけの入れ子で prose を含まないため、取れるなら ledger のために残す。
    const sm = chunk.match(/^\s*"scores"\s*:\s*(\{[^{}]*\})\s*,?\s*$/m);
    if (sm) { try { row.scores = JSON.parse(sm[1]); } catch { /* 無くてもよい */ } }
    const om = chunk.match(/^\s*"overall"\s*:\s*(-?\d+(?:\.\d+)?)\s*,?\s*$/m);
    if (om) row.overall = Number(om[1]);
    const fm = chunk.match(/^\s*"sourceFetched"\s*:\s*(true|false)\s*,?\s*$/m);
    if (fm) row.sourceFetched = fm[1] === 'true';
    return { row, how: 'minimal' };
  }
  return { row: null, how: 'failed' };
}

// 壊れた判定ファイルから、復元できた行だけを取り出す。
// 返す rows は isUsableRow を満たすものだけ（＝そのまま判定として使える）。
export function salvageRows(raw) {
  const chunks = splitObjectChunks(raw);
  const rows = [];
  const by = { full: 0, trimmed: 0, minimal: 0, failed: 0 };
  for (const c of chunks) {
    const { row, how } = recoverRow(c);
    by[how] += 1;
    if (row) rows.push(row);
  }
  return { rows, chunks: chunks.length, by };
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
    // 全損させる前に救済を試す。judge が壊した JSON でも veto の大半は無傷で残っている
    // （実測: 2ファイルから veto 2件・4件が全件復元できた）。
    const s = salvageRows(String(raw));
    if (!s.rows.length) {
      return { ...base, total: s.chunks, reason: `不正な JSON です: ${err.message}` };
    }
    const judgedS = new Set(s.rows.map((r) => r.link));
    const missingS = draftLinks.filter((l) => typeof l === 'string' && l && !judgedS.has(l)).length;
    const lost = s.chunks - s.rows.length;
    return {
      ok: true,
      // 救済した回は常に complete=false。壊れていた以上「全下書きに判定が付いた」とは
      // 言えないので、ガードの終了コードは 2（一部未査読）になる。
      complete: false,
      salvaged: true,
      salvagedBy: s.by,
      rows: s.rows,
      total: s.chunks,
      usable: s.rows.length,
      dropped: lost,
      missing: missingS,
      reason: `不正な JSON ですが ${s.rows.length}/${s.chunks} 件を復元しました`
        + `（完全 ${s.by.full}・prose除去 ${s.by.trimmed}・最小 ${s.by.minimal}・復元不能 ${s.by.failed}）`
        + `: ${err.message}`,
    };
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
