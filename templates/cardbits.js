// カードの共有部品: 実写真サムネ・セクションチップ等（index/article/section で共用）。
// 画像クレジットは一覧では出さず、記事ページ本体（article.js の heroFigure）にのみ表示する。
import { esc } from '../src/markdown.js';
import { config } from '../src/config.js';
import { tagSlug } from '../src/tagSlug.js';

// セクション名の中立ラベル。多色チップ（色信号の競合）は撤去し、色を持たない
// 控えめなカテゴリ表記に統一（認知負荷の低減）。extraClass は任意の追加クラス。
export function sectionChip(name, extraClass = '') {
  const label = name || 'AI';
  const cls = `cat${extraClass ? ` ${extraClass}` : ''}`;
  return `<span class="${cls}">${esc(label)}</span>`;
}

// タグページへのリンク（日本語タグは URL エンコード。ファイル名は生UTF-8で出力）。
// パスに使えない文字は tagSlug で潰す＝ render.js の書き出し名と必ず一致させる。
export function tagHref(tag, base = '') {
  return `${base}tags/${encodeURIComponent(tagSlug(tag))}.html`;
}

// 出典発行日時（無ければ取り込み時刻）の ISO 文字列。<time datetime> 用（a11y）。
export function isoDate(a) {
  const src = a.publishedAt || a.createdAt;
  if (!src) return '';
  const d = new Date(src);
  return Number.isNaN(d.getTime()) ? '' : esc(d.toISOString());
}

// 「カテゴリ · 日付＋時刻」のエブロー。section を省く場合は withCat=false（ブロック内は見出しと重複するため）。
// index の最新リスト/レールと、一覧系（section/tag/archive）の feedList で共用する。
export function metaLine(a, withCat = true) {
  const cat = withCat ? `<span class="feed-item__cat">${esc(a.section || 'AI')}</span>` : '';
  const dt = esc([a.displayDateShort || a.displayDate, a.displayTime].filter(Boolean).join(' '));
  return `<div class="feed-item__meta">${cat}<time class="feed-item__time" datetime="${isoDate(a)}">${dt}</time></div>`;
}

// 重要度(1-5)。レガシー記事の欠落は 3 にフォールバック（render.js と同義）。
export const imp = (a) => Number(a.importance) || 3;

// 重要度が高い記事に控えめなアクセントを付けるためのクラス（等価グリッドでのスキャン性向上）。
export function priorityClass(a) {
  return imp(a) >= 4 ? ' is-priority' : '';
}

// --- 版面マーク（.plate）------------------------------------------------
// 全記事の約48%は出典側の事情で写真を持たない。そこを「欠落」ではなく「型」として
// 扱うための装置。写真には擬態せず、3本の罫の長さ・太さの組み合わせで示す組版の標。
// 形はセクションで決まり、変奏（標の全長）は slug で決まる。
//
// ハッシュは FNV-1a（32bit）。Math.random() は使わない——render の決定性を壊さない
// ため（CLAUDE.md の不変条件）。同じ記事は何度ビルドしても同じ版面になる。
function hash32(s = '') {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// セクション → 標の形。近い性格のセクションは同じ形に寄せて「族」を作る。
//   asc = 情報・計算系 / peak = 観測系 / weight = 数量系 / desc = 記録系
//   split = 表現系 / pair = 技術系
const PLATE_SYSTEM = new Map([
  ['AI', 'asc'],
  ['テクノロジー', 'pair'],
  ['サイエンス', 'peak'],
  ['ビジネス', 'weight'],
  ['経済・マネー', 'weight'],
  ['政治', 'desc'],
  ['国際・地政学', 'peak'],
  ['カルチャー', 'split'],
  ['エンタメ', 'split'],
  ['ライフ・キャリア', 'desc'],
]);
const PLATE_VARIANTS = 3;

// 装飾なので aria-hidden。セクション名はメタ行が既に読み上げるため情報の欠落は無い。
export function plate(a, extraClass = '') {
  const system = PLATE_SYSTEM.get(a.section) || 'desc';
  const v = (hash32(a.slug || '') % PLATE_VARIANTS) + 1;
  const cls = `plate plate--${system} plate--v${v}${extraClass ? ` ${extraClass}` : ''}`;
  return `<div class="${cls}" aria-hidden="true"><span class="plate__label">${esc(a.section || 'AI')}</span></div>`;
}

// Unsplash 画像URLに配信最適化パラメータを付与（バイト数削減）。他プロバイダ/不明URLは素通し。
export function optimizedUrl(url, w = 1200) {
  if (!url || !url.includes('images.unsplash.com')) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}w=${w}&q=70&auto=format&fit=crop`;
}

// 実写真があれば背景画像サムネ、無ければ CSS 抽象サムネ。
// href を渡すと画像全体を記事へのリンクにする（見出しと同一記事への重複リンクになるため
// マウス操作専用とし、tabindex=-1 + aria-hidden で AT/キーボードには出さない）。
export function thumb(a, variant, href) {
  const img = a.image || {};
  const fig = img.imageUrl
    ? `<figure class="thumb" style="background-image: url('${esc(optimizedUrl(img.imageUrl, 800))}'); background-size: cover; background-position: center;" aria-hidden="true"></figure>`
    : `<figure class="thumb ${variant}" aria-hidden="true"></figure>`;
  if (!href) return fig;
  return `<a class="thumb-link" href="${esc(href)}" tabindex="-1" aria-hidden="true">${fig}</a>`;
}
