// 直近記事の客観品質フラグを集計し、writer プロンプトへ還流する短いフィードバックを生成する。
// 自己改善ハーネスの「評価→蓄積」を writer へ戻して「改善」を閉じるための最小実装。
// 決定的・オフライン（LLM/ネットワーク不使用）。警告が無ければ何も出力しない。
// 使い方: node src/qualityDigest.js  （auto-generate.sh が writer プロンプト末尾に追記する）
import { pathToFileURL } from 'node:url';
import { loadArticles } from './store.js';
import { evaluateRecent } from './evaluate.js';

const RECENT_N = 8; // 直近この本数を母集団に傾向を見る

// フラグ文字列「本文が短い (357<450)」→ カテゴリ「本文が短い」（末尾の括弧詳細を除く）。
function flagKey(flag) {
  return flag.replace(/\s*[(（].*$/, '').trim();
}

// カテゴリ → writer への具体的な是正指示。未知カテゴリはそのまま提示する。
const GUIDANCE = {
  '本文が短い': '本文は550〜750字を目安に厚く（450字未満の薄い候補は無理に書かず外す）',
  '本文が長い': '本文は550〜750字目安に収める（900字を超えない）',
  '見出しが長い': '見出しは40字以内',
  'リードが長い': 'リードは80字以内・要点1文',
  'タグ数が範囲外': 'タグは3〜5個',
  '話題が近い記事あり': '直近記事と重複する話題は統合し、二重掲載しない',
};

export function buildDigest(arts, recentN = RECENT_N) {
  const evals = evaluateRecent(arts, recentN);
  const sample = evals.length;
  if (!sample) return '';

  const counts = new Map(); // カテゴリ -> 件数
  for (const e of evals) {
    for (const f of e.flags || []) {
      const key = flagKey(f);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  if (!counts.size) return '';

  const lines = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key, n]) => `- ${key}: ${n}本 → ${GUIDANCE[key] || '是正すること'}`);

  return [
    '## 直近記事の品質フィードバック（必ず是正）',
    `直近${sample}本中、以下の逸脱が観測されました。今回の執筆では必ず避けること:`,
    ...lines,
  ].join('\n');
}

// CLI: 直近の傾向を stdout に出力（無ければ空＝何も出さない）。
const isMain = import.meta.url === pathToFileURL(process.argv[1] || '').href;
if (isMain) {
  const arts = await loadArticles();
  const digest = buildDigest(arts);
  if (digest) process.stdout.write(`${digest}\n`);
}
