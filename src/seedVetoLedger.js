// 遡及シード — data/scheduler.log に埋もれた過去の veto を vetoes.jsonl へ流し込む。
// veto ledger（src/vetoLedger.js）を新設する以前の記録はログにしか無く、そのままでは
// vetoDigest が初日「母集団ゼロ」で何も注入できない。過去分を入れて初回から傾向を効かせる。
//
// 使い方:
//   npm run seed-veto-ledger              dry-run（件数とカテゴリ内訳を表示するだけ）
//   npm run seed-veto-ledger -- --apply   実際に vetoes.jsonl へ追記
//   npm run seed-veto-ledger -- --apply --force  seed 済みでも強制的に再投入
//
// 注意: ログの行は `✗ veto により破棄: <headline> — <critique>`（ingestDrafts.js の出力）。
// link はログに出ていないため null になる。vetoDigest は link を使わないので影響しない。
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyCritique, appendVetoes, readVetoes } from './vetoLedger.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOG_FILE = path.join(ROOT, 'data', 'scheduler.log');
const ORIGIN = 'seed:scheduler.log';

const RUN_START = /^=====\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s+Claude執筆ジョブ開始/;
const VETO_LINE = /^\s*✗ veto により破棄:\s*(.+)$/;

// ログ1本を走査して veto レコードの配列を返す（純粋な読み取り）。
export function parseLog(text) {
  const recs = [];
  let runAt = null;
  for (const line of text.split('\n')) {
    const run = line.match(RUN_START);
    if (run) {
      // ログの時刻はローカル（JST）表記。Date に解釈させて ISO に正規化する。
      const t = new Date(run[1].replace(' ', 'T'));
      runAt = Number.isNaN(t.getTime()) ? null : t.toISOString();
      continue;
    }
    const m = line.match(VETO_LINE);
    if (!m) continue;
    // headline と critique は最初の「 — 」で分ける（critique 内の — は保持する）。
    const rest = m[1];
    const sep = rest.indexOf(' — ');
    const headline = (sep >= 0 ? rest.slice(0, sep) : rest).trim();
    const critique = sep >= 0 ? rest.slice(sep + 3).trim() : '';
    recs.push({
      vetoedAt: runAt || new Date(0).toISOString(),
      link: null,
      headline,
      critique,
      categories: classifyCritique(critique),
      stage: 'initial',
      outcome: 'discarded',
      origin: ORIGIN,
    });
  }
  return recs;
}

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const force = args.includes('--force');

let text;
try {
  text = await readFile(LOG_FILE, 'utf8');
} catch {
  console.error(`ログが読めません: ${LOG_FILE}`);
  process.exit(1);
}

const recs = parseLog(text);
if (!recs.length) {
  console.log('veto の記録がログにありません。');
  process.exit(0);
}

// カテゴリ内訳（複数該当あり＝のべ計上）。
const counts = new Map();
let uncategorized = 0;
for (const r of recs) {
  if (!r.categories.length) uncategorized++;
  for (const c of r.categories) counts.set(c, (counts.get(c) || 0) + 1);
}
const span = [recs[0]?.vetoedAt, recs[recs.length - 1]?.vetoedAt].map((s) => String(s).slice(0, 10));
console.log(`ログから ${recs.length} 件の veto を検出（${span[0]} 〜 ${span[1]}）`);
for (const [c, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${c.padEnd(14)} ${String(n).padStart(3)}件 (${Math.round((n / recs.length) * 100)}%)`);
}
console.log(`  ${'未分類'.padEnd(12)} ${String(uncategorized).padStart(3)}件 (${Math.round((uncategorized / recs.length) * 100)}%)`);

// 冪等ガード: 二重投入は vetoDigest の割合を歪めるので既定で拒否する。
const existing = await readVetoes({ maxRows: 100000 });
const seeded = existing.filter((r) => r?.origin === ORIGIN).length;
if (seeded && !force) {
  console.log(`\nseed 済みです（${seeded} 件）。再投入するなら --force を付けてください。`);
  process.exit(0);
}

if (!apply) {
  console.log('\n（dry-run。実際に書き込むには -- --apply）');
  process.exit(0);
}

const n = await appendVetoes(recs);
console.log(`\n✓ ${n} 件を data/quality/vetoes.jsonl へ追記しました。`);
