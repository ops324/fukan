// 公式プレス画像の自動採用（報道用素材）。
// 記事の出典(link)が config.pressImage.allowlist のドメイン（＝各社が自社について発表する公式ページ）なら、
// そのページの og:image を取得し、提供クレジット＋出典リンク付きのプレス画像レコードとして返す。
//
// 方針（権利配慮）:
// - 対象は「報道対象“本人”の公式ドメイン」だけ（第三者メディアの画像は転載しない）。allowlist で厳格化。
// - og:image は各社が SNS 共有用に自ら配布している画像＝報道用素材として最も defensible な範囲。
// - 必ず「提供: <社名>」クレジット＋出典リンクを伴う（check.js が press 画像のクレジット必須を強制）。
// - 取得失敗・非許可ドメイン・不正URLは null を返し、呼び出し側は従来の stock/抽象サムネへフォールバックする
//   （＝今より悪くならない安全設計）。
import { config } from './config.js';

// link のホストが allowlist のドメイン（それ自身 or サブドメイン）に一致すれば、その credit を返す。
function matchAllowed(link) {
  let host;
  try { host = new URL(link).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; }
  for (const { domain, credit } of config.pressImage.allowlist || []) {
    const d = domain.toLowerCase();
    if (host === d || host.endsWith(`.${d}`)) return credit;
  }
  return null;
}

// HTML の meta タグから og:image（無ければ twitter:image）の content を抜き出す。
// property/name はどちらの並びにも対応し、最小限の HTML エンティティを復号する。
function extractImageUrl(html) {
  const metaRe = /<meta\b[^>]*>/gi;
  const attr = (tag, name) => {
    const m = tag.match(new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
    return m ? (m[1] ?? m[2] ?? '') : null;
  };
  let ogImage = null;
  let twImage = null;
  const tags = html.match(metaRe) || [];
  for (const tag of tags) {
    const key = (attr(tag, 'property') || attr(tag, 'name') || '').toLowerCase();
    if (key !== 'og:image' && key !== 'og:image:url' && key !== 'og:image:secure_url' && key !== 'twitter:image') continue;
    const content = attr(tag, 'content');
    if (!content) continue;
    if (key === 'twitter:image') { twImage = twImage || content; continue; }
    ogImage = ogImage || content;
  }
  return decodeEntities(ogImage || twImage || '');
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&#0*38;/g, '&')
    .replace(/&#x0*26;/gi, '&')
    .replace(/&#0*47;/g, '/')
    .replace(/&#x0*2f;/gi, '/')
    .trim();
}

// CSS/HTML インジェクション防止: 絶対 http(s) URL で、url('...') やタグを破れる文字を含まないものだけ許可。
// テンプレートは background-image: url('<esc(url)>') に差し込むため、ここで素性の悪い URL を弾いておく。
function safeAbsoluteUrl(raw, base) {
  let u;
  try { u = new URL(raw, base); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const href = u.href;
  if (!/^https?:\/\/[^\s'"()<>\\]+$/i.test(href)) return null;
  return href;
}

// 記事に自動プレス画像を付けられるなら image レコードを、無理なら null を返す。
// used: 使用済み画像キーの Set（渡されれば imageUrl を登録し他記事との重複回避に寄与する）。
export async function fetchPressImage(article, used = null) {
  const cfg = config.pressImage;
  if (!cfg?.enabled) return null;
  if ((Number(article.importance) || 3) < (cfg.minImportance ?? config.imageImportanceFloor)) return null;
  const link = (article.link || '').trim();
  if (!link) return null;
  const credit = matchAllowed(link);
  if (!credit) return null; // 非許可ドメイン → stock へフォールバック

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs || 8000);
  try {
    const res = await fetch(link, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; FukanNewsBot/1.0; +https://fukan-news.vercel.app)',
        Accept: 'text/html',
      },
    });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('html')) return null;
    // og:image は <head> にあるので冒頭だけ読めば十分（巨大ページの全読込を避ける）。
    const html = (await res.text()).slice(0, 200000);
    const rawUrl = extractImageUrl(html);
    if (!rawUrl) return null;
    const imageUrl = safeAbsoluteUrl(rawUrl, link);
    if (!imageUrl) return null;
    if (used) used.add(imageUrl.split('?')[0]);
    return {
      kind: 'press',
      imageUrl,
      credit,
      creditUrl: link,
      source: 'og:image auto', // 内部メモ（表示はしない。手動登録と区別する印）
    };
  } catch {
    return null; // タイムアウト・ネットワーク・パース失敗 → stock へフォールバック
  } finally {
    clearTimeout(timer);
  }
}
