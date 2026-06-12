// 記事タグから英語キーワードを作り、Unsplash/Pexels で写真を取得（規約準拠の帰属付き）。
// 重複回避: 候補を複数件取得し、他記事で未使用の画像を選ぶ。
// キー無/ヒット0なら CSS抽象サムネにフォールバック（デザイン崩れゼロ）。
import { config } from './config.js';

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

function keyword(article) {
  // 最優先: Claude が記事を読んで決めた検索ワード（内容に最も合う）
  const q = (article.image_query || '').trim();
  if (q) return q;
  // フォールバック: タグ/見出しからの簡易マップ
  const hay = [...(article.tags || []), article.headline || ''].join(' ');
  for (const [re, kw] of KW_MAP) if (re.test(hay)) return kw;
  return 'artificial intelligence technology';
}

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
  if (!res.ok) return [];
  const data = await res.json();
  return (data.results || []).map((p) => ({
    imageUrl: `${p.urls.raw}&w=1280&q=80&fm=jpg`,
    photographer: p.user?.name || 'Unsplash',
    profileUrl: `${p.user?.links?.html || 'https://unsplash.com'}?utm_source=axiom_ai&utm_medium=referral`,
    provider: 'Unsplash',
    _download: p.links?.download_location || null,
  }));
}

// Pexels: 候補を最大30件返す
async function pexelsCandidates(kw) {
  if (!config.pexelsKey) return [];
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(kw)}&per_page=30&orientation=landscape`;
  const res = await fetch(url, { headers: { Authorization: config.pexelsKey } });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.photos || []).map((p) => ({
    imageUrl: p.src?.large || p.src?.original,
    photographer: p.photographer || 'Pexels',
    profileUrl: p.photographer_url || 'https://www.pexels.com',
    provider: 'Pexels',
    _download: null,
  }));
}

// 戻り値: 画像メタ or { fallbackThumb }
// used: 既に使用済みの imageKey の Set（重複回避）。選んだ画像のキーは used に追加する。
export async function fetchImage(article, index = 0, used = new Set()) {
  const kw = keyword(article);
  try {
    const primary = config.imageProvider === 'pexels' ? pexelsCandidates : unsplashCandidates;
    const secondary = config.imageProvider === 'pexels' ? unsplashCandidates : pexelsCandidates;
    let cands = await primary(kw);
    if (!cands.length) cands = await secondary(kw);

    if (cands.length) {
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
        const { _download, ...img } = pick;
        return img;
      }
    }
  } catch (err) {
    console.warn(`  [image] 取得失敗: ${err.message}`);
  }
  const thumb = config.thumbVariants[index % config.thumbVariants.length];
  return { fallbackThumb: thumb };
}
