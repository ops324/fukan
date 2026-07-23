// 記事タグから英語キーワードを作り、Unsplash/Pexels で写真を取得（規約準拠の帰属付き）。
// 重複回避: 候補を複数件取得し、他記事で未使用の画像を選ぶ。
// 関連度スコアリング: 候補の説明文（alt/description）を記事キーワードと照合し、最も内容が合う候補を選ぶ。
// ブランド不一致回避: 他社ロゴ/UI が写り込んだ写真を捨てる（brandConflicts）。
// キー無/ヒット0なら CSS抽象サムネにフォールバック（デザイン崩れゼロ）。
import { config } from './config.js';
import { articleBrands, brandConflicts } from './imageBrands.js';

// 日本語タグ/見出し→画像検索用の英語キーワード（簡易マップ＋既定値）。
// AI/テックに加え、総合ニュース各分野（政治/国際/カルチャー/エンタメ/経済等）のパターンを含む。
const KW_MAP = [
  [/規制|倫理|法案?|ガイドライン|訴訟|裁判/, 'law justice government'],
  [/医療|診断|臨床|健康|病院|ワクチン|感染/, 'medical healthcare hospital'],
  [/金融|銀行|決済/, 'finance banking'],
  [/上場|IPO|株式|時価総額|投資|調達|資金|金利|為替|景気|物価|インフレ/, 'stock market finance'],
  [/買収|出資|提携|統合|決算|業績/, 'corporate business meeting'],
  [/宇宙|ロケット|衛星|スペース|SpaceX|天文|惑星/i, 'rocket launch space'],
  [/半導体|GPU|チップ|ハードウェア|データセンター/, 'semiconductor chip'],
  [/ロボット/, 'robotics'],
  [/研究|論文|科学|実験|生物|化学|物理/, 'research laboratory'],
  [/スタートアップ|起業/, 'startup office'],
  [/画像|動画|生成|アート|芸術|展覧|美術/, 'art gallery exhibition'],
  [/映画|音楽|ゲーム|エンタメ|俳優|配信|ドラマ/, 'cinema film entertainment'],
  [/選挙|議会|政権|首相|大統領|外交|政策/, 'government parliament politics'],
  [/戦争|紛争|軍|安全保障|地政学|国連|制裁/, 'world map geopolitics'],
  [/気候|環境|エネルギー|再生可能|脱炭素/, 'renewable energy environment'],
  [/コード|開発者|プログラ|エンジニア|ソフトウェア/, 'software code developer'],
];

// 記事セクション（navSections の name）→ 既定の検索語。
// 0ヒットが続いたときの最終フォールバックを AI 特化語から中立語へ切り替える（総合ニュース対応）。
// 未定義セクションは keywordVariants 側の汎用フォールバックに落ちる。
const SECTION_DEFAULT = {
  'AI': 'artificial intelligence technology',
  'テクノロジー': 'technology computer',
  'サイエンス': 'laboratory science research',
  'ビジネス': 'business office meeting',
  '経済・マネー': 'stock market finance',
  '政治': 'government building parliament',
  '国際・地政学': 'world map globe',
  'カルチャー': 'art gallery exhibition',
  'エンタメ': 'cinema film reel',
  'ライフ・キャリア': 'lifestyle people office',
};

// --- 関連度スコアリング用のトークン化 ---
// 英字3字以上のみ拾う（日本語は自然に無視）。2字略語（AI 等）は落ちるが誤検出を避ける割り切り。
function tokenize(text) {
  return (String(text || '').toLowerCase().match(/[a-z]{3,}/g)) || [];
}
// 簡易ステマ: 末尾 ing/ed/s を落として単複・活用の揺れを吸収（過剰一致を避け完全一致で照合）。
function stem(w) {
  return w.replace(/(ing|ed|s)$/,'');
}

// 検索語の候補列を「具体的→広い」順で作る。
// image_query が具体的すぎて 0 ヒットでも、語を減らした版・タグ/見出しの簡易マップ・既定語へと
// 段階的に広げて当てる（過剰具体的なクエリでの抽象サムネ落ちを防ぐ）。
function keywordVariants(article) {
  const variants = [];
  // 最優先: Claude が記事を読んで決めた検索ワード（内容に最も合う）
  const q = (article.image_query || '').trim();
  if (q) {
    variants.push(q);
    const words = q.split(/\s+/);
    if (words.length > 3) variants.push(words.slice(0, 3).join(' ')); // 先頭3語
    if (words.length > 2) variants.push(words.slice(0, 2).join(' ')); // 先頭2語
  }
  // タグ/見出しからの簡易マップ（最初の一致のみ）
  const hay = [...(article.tags || []), article.headline || ''].join(' ');
  for (const [re, kw] of KW_MAP) if (re.test(hay)) { variants.push(kw); break; }
  // 既定語: セクション別の中立語（総合ニュース対応）→ 無ければ従来の汎用語。
  variants.push(SECTION_DEFAULT[article.section] || 'artificial intelligence technology');
  return [...new Set(variants)]; // 重複除去（順序維持）
}

// 記事側の「重み付き英語トークン集合」。候補写真の説明文と照合して関連度を測る土台。
// image_query（最強シグナル）＞ KW_MAP(JA→EN, 全マッチ) ＞ tags/headline の英字、の順に重み付け。
// 汎用語は除外せず低重み化する（被写体語まで巻き込んで消さない）。
export function articleImageTokens(article) {
  const cfg = config.imageRelevance;
  const m = new Map(); // stem(token) -> weight（大きい方を採用）
  const add = (tok, w) => { const k = stem(tok); if (k) m.set(k, Math.max(m.get(k) || 0, w)); };

  // ① image_query（Claude が本文から決めた英語＝最強シグナル）
  for (const t of tokenize(article.image_query)) add(t, cfg.queryWeight);
  // ② tags+headline を KW_MAP で JA→EN 展開（keywordVariants の break と違い、ここは全マッチ収集）
  const hay = [...(article.tags || []), article.headline || ''].join(' ');
  for (const [re, kw] of KW_MAP) if (re.test(hay)) for (const t of tokenize(kw)) add(t, cfg.mapWeight);
  // ③ tags/headline に直接含まれる英字（GPU/IPO/NVIDIA 等の固有・略語）
  for (const t of tokenize(hay)) add(t, cfg.tagWeight);
  // ④ 汎用語を薄める（消さない）
  for (const t of m.keys()) if (cfg.genericTokens.includes(t)) m.set(t, cfg.genericWeight);
  return m;
}

// 候補写真の関連度スコア。写真の alt+description のトークンごとに記事側の重みを加点。
// Pexels は description が空（alt のみ寄与）、Unsplash は alt+description。片側でも記事語と重なれば加点。
export function relevanceScore(photo, tokens) {
  let s = 0;
  for (const t of tokenize(`${photo?.alt || ''} ${photo?.description || ''}`)) s += tokens.get(stem(t)) || 0;
  return s;
}

// API のレート制限。「ヒット0」と区別するため送出する（fetchImage は握り潰して抽象サムネに落とす）。
export class RateLimitError extends Error {}

// 画像の一意キー（重複判定用）。保存済みレコードからも導出できるよう URL から抽出。
export function imageKey(img) {
  if (!img) return null;
  if (img.imageUrl) {
    const m = img.imageUrl.match(/photo-([\w-]+)/)        // Unsplash
      || img.imageUrl.match(/\/photos\/(\d+)\//)           // Pexels (URL内id)
      || img.imageUrl.match(/[?&]id=(\d+)/);               // Pexels (query id)
    if (m) return m[1];
    return img.imageUrl.split('?')[0];                     // 最終手段: パス部分
  }
  return null;
}

// Unsplash: 候補を最大30件返す（id/帰属/ダウンロードトリガー付き）
async function unsplashCandidates(kw) {
  if (!config.unsplashKey) return [];
  const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(kw)}&per_page=30&orientation=landscape&content_filter=high`;
  const res = await fetch(url, { headers: { Authorization: `Client-ID ${config.unsplashKey}` } });
  // レート制限を「ヒット0」と区別する。区別しないと、制限中の実行が「該当写真なし」に見えてしまう
  // （索引生成が空の索引を正常扱いで書き潰す等）。呼び出し側が握り潰すかは呼び出し側が決める。
  if (res.status === 403 || res.status === 429) throw new RateLimitError(`Unsplash rate limit (${res.status})`);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.results || []).map((p) => ({
    imageUrl: `${p.urls.raw}&w=1280&q=80&fm=jpg`,
    photographer: p.user?.name || 'Unsplash',
    profileUrl: `${p.user?.links?.html || 'https://unsplash.com'}?utm_source=axiom_ai&utm_medium=referral`,
    provider: 'Unsplash',
    alt: p.alt_description || '',
    description: p.description || '',
    _download: p.links?.download_location || null,
  }));
}

// Pexels: 候補を最大30件返す
async function pexelsCandidates(kw) {
  if (!config.pexelsKey) return [];
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(kw)}&per_page=30&orientation=landscape`;
  const res = await fetch(url, { headers: { Authorization: config.pexelsKey } });
  if (res.status === 429) throw new RateLimitError('Pexels rate limit (429)');
  if (!res.ok) return [];
  const data = await res.json();
  return (data.photos || []).map((p) => ({
    imageUrl: p.src?.large || p.src?.original,
    photographer: p.photographer || 'Pexels',
    profileUrl: p.photographer_url || 'https://www.pexels.com',
    provider: 'Pexels',
    alt: p.alt || '',
    description: '',
    _download: null,
  }));
}

// 検索語1つで候補を引く（primary→secondary の順）。既存画像の素性を後から調べる用途にも使う。
export async function searchCandidates(kw) {
  const primary = config.imageProvider === 'pexels' ? pexelsCandidates : unsplashCandidates;
  const secondary = config.imageProvider === 'pexels' ? unsplashCandidates : pexelsCandidates;
  // primary がレート制限でも secondary で拾えることがある。両方だめなら制限を呼び出し側へ伝える。
  let limited = null;
  try {
    const cands = await primary(kw);
    if (cands.length) return cands;
  } catch (err) {
    if (!(err instanceof RateLimitError)) throw err;
    limited = err;
  }
  try {
    const cands = await secondary(kw);
    // secondary が空でも、primary が制限中なら「ヒット0」と断定できない（secondary はキー未設定だと
    // 常に空を返す）。制限を握り潰すと、空の結果が正常な 0 件として下流に流れる。
    if (!cands.length && limited) throw limited;
    return cands;
  } catch (err) {
    if (!(err instanceof RateLimitError)) throw err;
    throw limited || err;
  }
}

// 戻り値: 画像メタ or { fallbackThumb }
// used: 既に使用済みの imageKey の Set（重複回避）。選んだ画像のキーは used に追加する。
// strict: レート制限を送出する。既存画像の差し替え用途では、制限による「取得0」を「適した写真なし」と
//   取り違えると、まともな写真を抽象サムネで潰してしまうため呼び出し側で止める必要がある。
//   日次の取り込み（ingest）は既定の false のまま＝制限時は抽象サムネに落として公開を止めない。
export async function fetchImage(article, index = 0, used = new Set(), { strict = false } = {}) {
  const allowed = articleBrands(article);
  const cfg = config.imageRelevance;
  const tokens = articleImageTokens(article);
  // 選定確定時の共通処理: used 追加・Unsplash ダウンロードトリガー・内部フィールド剥がし。
  const finalize = (pick) => {
    const k = imageKey(pick);
    if (k) used.add(k);
    if (pick._download) { // Unsplash 規約: ダウンロードトリガー（ベストエフォート）
      fetch(pick._download, { headers: { Authorization: `Client-ID ${config.unsplashKey}` } }).catch(() => {});
    }
    // _download は内部用なので剥がす。description は写真の内容説明で、後日の関連度再点検（recheck）や
    // LLM 査読の判定材料になる（Unsplash の alt_description は null が多く alt だけでは約4割が採点不能なため、
    // description を残すと遡及点検のカバレッジが上がる）。空なら保存しない（レコード肥大を避ける）。
    const { _download, description, ...img } = pick;
    if (description) img.description = description;
    return img;
  };
  let weakBest = null; // どのクエリも minScore に届かなかったとき用の最良候補（実写を抽象サムネより優先）
  try {
    // 具体的→広い順に検索語を試し、最初にヒットした候補集合を採用（0ヒットでの抽象落ちを防ぐ）。
    for (const kw of keywordVariants(article)) {
      let cands = await searchCandidates(kw);
      if (!cands.length) continue; // この語は0ヒット → 次の（より広い）語へ

      // 他社ロゴ/UI が写り込んだ写真を捨てる（Claude の記事に ChatGPT のスクショ、を防ぐ）。
      // 全滅したら次の（より広い）語へ。最後まで残らなければ抽象サムネに落ちる＝誤った写真より安全。
      cands = cands.filter((c) => !brandConflicts(c, allowed));
      if (!cands.length) continue;

      if (!cfg.enabled) {
        // 安全弁: 従来の「未使用を先頭から採用、無ければ index 分散」に即戻す。
        return finalize(cands.find((c) => { const k = imageKey(c); return k && !used.has(k); })
          || cands[index % cands.length]);
      }

      // 関連度スコアで並べ替え（Array.sort は安定＝API の候補順を同点内で保持し決定論的）。
      const scored = cands.map((c) => ({ c, s: relevanceScore(c, tokens) })).sort((a, b) => b.s - a.s);
      const best = scored[0].s;
      // 最高でも minScore 未満＝記事語と実質重ならないクエリ。弱一致として退避し、より広い語へ。
      if (best < cfg.minScore) {
        if (!weakBest || scored[0].s > weakBest.s) weakBest = scored[0];
        continue;
      }
      // 最高スコア±tolerance を「同等」とみなし、その帯内で未使用を優先。
      const top = scored.filter((x) => x.s >= best - cfg.tolerance).map((x) => x.c);
      const unusedInTop = top.filter((c) => { const k = imageKey(c); return k && !used.has(k); });
      // 帯内に未使用が無ければ全候補から未使用を探す（従来の dedup 強度を維持）。最終手段は帯内 index 分散。
      const pick = (unusedInTop.length ? unusedInTop[index % unusedInTop.length] : null)
        || cands.find((c) => { const k = imageKey(c); return k && !used.has(k); })
        || top[index % top.length];
      return finalize(pick);
    }
  } catch (err) {
    if (strict && err instanceof RateLimitError) throw err;
    console.warn(`  [image] 取得失敗: ${err.message}`);
  }
  // どのクエリも minScore 未満だったが弱一致はある → 抽象サムネより実写を優先（acceptWeak 時）。
  if (weakBest && cfg.acceptWeak) return finalize(weakBest.c);
  const thumb = config.thumbVariants[index % config.thumbVariants.length];
  return { fallbackThumb: thumb };
}
