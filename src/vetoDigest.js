// veto の傾向を writer プロンプトへ還流する短いフィードバックを生成する。
// 決定的・オフライン（LLM/ネットワーク不使用）。veto が無ければ何も出力しない。
//
// 体裁 digest（qualityDigest.js）と必ず別セクションにする理由:
//   母集団   … 公開された記事 / 捨てられた下書き
//   測るもの … 床（qualityThresholds）からの逸脱 / constitution 違反
//   是正     … 出力の「形状」（字数・タグ数） / 執筆の「手順」（照合・引用・確認）
// 混ぜると writer が両者を同列に扱い、事実誤りの優先度が下がる。順序は veto を先（賭け金が大きい）。
//
// 禁止事項（不変条件）: ここに「veto を N 件未満にせよ」等の目標値を書かない。書くと
// 「数値を省略してぼかす」という最悪の最適化を誘発する。是正は必ず手続きの指示として書く。
import { config } from './config.js';

// カテゴリ → writer への具体的な是正指示（qualityDigest.js の GUIDANCE と同格の対応表）。
// 「〜するな」ではなく「こう手を動かせ」と書く。検証可能な手順にするのが要点。
const VETO_GUIDANCE = {
  numeric: [
    '金額・人数・％・倍率は、**出典の原文表記を一度そのまま書き写してから**日本語に直す。',
    'billion=10億／million=100万／trillion=1兆。$1.5B=15億ドル、$15B=150億ドル、£3 billion=30億ポンド。',
    '**通貨換算をしない**（$16.5M は「1650万ドル」。円に直さない。為替レートは出典に無い）。',
    '数値を書いた直後に、その1つを出典の該当箇所と照合してから次の文へ進む。',
  ],
  entity: [
    '人名・組織名・大学名・製品名・地名は出典から**そのまま写す**。記憶や類似名から再構成しない。',
    'カタカナ表記は出典の綴りに合わせる（例:「カリム・カーン」を「カーム・カーン」と書かない）。',
  ],
  contradiction: [
    '同じ数値が見出し・リード・本文に複数回出るときは、書き終えてから**必ず突き合わせる**。',
    '内訳を並べたら合計が一致するか確認する（例: 見出し「20万人」／本文の内訳合計11万人）。',
  ],
  fabrication: [
    '背景説明・比較・専門的補足を「知っていること」から足さない。出典で確認できないものは書かない。',
    '出典が触れていない主体・因果・評価を補わない（例: 共同実施を単独実施と書き換えない）。',
  ],
  date: [
    '日付・年号は出典から写す。「初頭」「初期」など曖昧語で言い換えず、出典の表現をそのまま使う。',
  ],
  unreachable: [
    '出典が取得できない候補は**選別の段階で外す**（無理に書かない）。他ソースでの裏取りが前提。',
  ],
};

const LABEL = {
  numeric: '数値・桁・単位の誤り',
  entity: '固有名詞の取り違え',
  contradiction: '下書き内部の矛盾',
  fabrication: '出典にない事実の創作',
  date: '日付・時系列の誤り',
  unreachable: '出典が取得できず検証不能',
};

// rows は readVetoes() の結果（新しい順）。writer プロンプトへ注入するテキストを返す。
export function buildVetoDigest(rows) {
  // 母集団は「初回査読で veto された下書き」全部。ledger の行は救済（rescued）されたものも
  // 含めて**すべて初回 veto**であり、writer が実際に犯した誤りの記録である。
  //
  // ここで rescued を除いていた時期があり、修正リトライ（fixRound）を入れた途端に writer への
  // フィードバックが痩せた: 2026-07-25 の 15 件中 11 件（73%）が救済され、writer は自分の失敗の
  // 4 件しか見られなくなっていた。**安全網が働くほど writer が学べなくなる**という逆説で、
  // 「writer が自分の失敗を見られない構造に戻さない」(CLAUDE.md) に反する。母集団に戻す。
  //
  // 救済されたかどうか（結果）は writer に見せない——「直してもらえる」と学ぶと初回の精度を
  // 上げる動機が消える。見せるのは誤りの型と是正手順だけ。救済率は stderr（人間向け）に出す。
  const list = Array.isArray(rows) ? rows : [];
  const vetoed = list.filter((r) => r && typeof r === 'object');
  if (!vetoed.length) return '';

  const { minCount, maxCategories, maxChars } = config.vetoDigest;
  const counts = new Map();
  for (const r of vetoed) {
    for (const c of r?.categories || []) counts.set(c, (counts.get(c) || 0) + 1);
  }
  const top = [...counts.entries()]
    .filter(([, n]) => n >= minCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxCategories);
  if (!top.length) return '';

  const lines = [];
  for (const [cat, n] of top) {
    const pct = Math.round((n / vetoed.length) * 100);
    const label = LABEL[cat] || cat;
    lines.push(`- **${label}: ${n}本（${pct}%）**`);
    for (const g of VETO_GUIDANCE[cat] || []) lines.push(`  → ${g}`);
  }

  const out = [
    '## 直近の不採用（veto）傾向 — 今回の執筆で最優先に潰すこと',
    `直近${config.vetoDigest.windowDays}日で査読が ${vetoed.length} 本を不採用（veto）にしました。原因の内訳:`,
    ...lines,
    '',
    '注意: これらの是正は「数値や固有名詞を書かない」ことでは達成されない。**正確に書く**ことで達成する。',
  ].join('\n');

  return out.length > maxChars ? `${out.slice(0, maxChars)}\n（以下省略）` : out;
}

// 救済率のサマリ（1行）。writer には見せず、ログ（stderr）にだけ出すための関数。
// 救済率を writer プロンプトに入れると「通ればよい」という目標値として作用してしまう。
export function summarizeRescue(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const refix = list.filter((r) => r?.stage === 'refix');
  if (!refix.length) return '';
  const rescued = refix.filter((r) => r?.outcome === 'rescued').length;
  const pct = Math.round((rescued / refix.length) * 100);
  const warn = pct >= 80 ? '  ⚠ 救済率が高すぎます（再査読のゲーム化を疑い、手動監査を検討）' : '';
  return `veto 救済率: ${rescued}/${refix.length} (${pct}%)${warn}`;
}
