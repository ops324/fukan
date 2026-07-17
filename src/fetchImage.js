// 記事タグから英語キーワードを作り、Unsplash/Pexels で写真を取得（規約準拠の帰属付き）。
// 重複回避: 候補を複数件取得し、他記事で未使用の画像を選ぶ。
// ブランド不一致回避: 他社ロゴ/UI が写り込んだ写真を捨てる（brandConflicts）。
// キー無/ヒット0なら CSS抽象サムネにフォールバック（デザイン崩れゼロ）。
import { config } from './config.js';
import { articleBrands, brandConflicts } from './imageBrands.js';

// 日本語タグ→画像検索用の英語キーワード（簡易マップ＋既定値）
const KW_MAP = [
  [/規制|倫理|法|ガイドライン/, 'regulation technology'],
  [/医療|診断|臨床/, 'medical technology'],
  [/金融|銀行/, 'finance technology'],
  [/上場|IPO|株式|時価総額|投資|調達|資金/, 'stock market finance'],
  [/買収|出資|提携|統合/, 'corporate business meeting'],
  [/宇宙|ロケット|衛星|スペース|SpaceX/i, 'rocket launch space'],
  [/半導体|GPU|チップ|ハードウェア/, 'semiconductor chip'],
  [/ロボット/, 'robotics'],
  [/研究|論文|科学|評価/, 'research laboratory'],
  [/スタートアップ/, 'startup office'],
  [/画像|動画|生成|アート/, 'digital art abstract'],
  [/コード|開発者|プログラ|エンジニア/, 'software code developer'],
];

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
  variants.push('artificial intelligence technology'); // 既定
  return [...new Set(variants)]; // 重複除去（順序維持）
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
  try {
    // 具体的→広い順に検索語を試し、最初にヒットした候補集合を採用（0ヒットでの抽象落ちを防ぐ）。
    for (const kw of keywordVariants(article)) {
      let cands = await searchCandidates(kw);
      if (!cands.length) continue; // この語は0ヒット → 次の（より広い）語へ

      // 他社ロゴ/UI が写り込んだ写真を捨てる（Claude の記事に ChatGPT のスクショ、を防ぐ）。
      // 全滅したら次の（より広い）語へ。最後まで残らなければ抽象サムネに落ちる＝誤った写真より安全。
      cands = cands.filter((c) => !brandConflicts(c, allowed));
      if (!cands.length) continue;

      // 未使用の候補を優先。全て使用済みなら index ベースで分散（最終手段は重複許容）。
      const pick = cands.find((c) => { const k = imageKey(c); return k && !used.has(k); })
        || cands[index % cands.length];
      if (pick) {
        const k = imageKey(pick);
        if (k) used.add(k);
        // Unsplash 規約: ダウンロードトリガー（ベストエフォート）
        if (pick._download) {
          fetch(pick._download, { headers: { Authorization: `Client-ID ${config.unsplashKey}` } }).catch(() => {});
        }
        const { _download, description, ...img } = pick;
        return img;
      }
    }
  } catch (err) {
    if (strict && err instanceof RateLimitError) throw err;
    console.warn(`  [image] 取得失敗: ${err.message}`);
  }
  const thumb = config.thumbVariants[index % config.thumbVariants.length];
  return { fallbackThumb: thumb };
}
