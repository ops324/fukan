// カードの共有部品: 実写真サムネ・セクションチップ等（index/article/section で共用）。
// 画像クレジットは一覧では出さず、記事ページ本体（article.js の heroFigure）にのみ表示する。
import { esc } from '../src/markdown.js';
import { config } from '../src/config.js';

// セクション名の中立ラベル。多色チップ（色信号の競合）は撤去し、色を持たない
// 控えめなカテゴリ表記に統一（認知負荷の低減）。extraClass は任意の追加クラス。
export function sectionChip(name, extraClass = '') {
  const label = name || 'AI';
  const cls = `cat${extraClass ? ` ${extraClass}` : ''}`;
  return `<span class="${cls}">${esc(label)}</span>`;
}

// タグページへのリンク（日本語タグは URL エンコード。ファイル名は生UTF-8で出力）
export function tagHref(tag, base = '') {
  return `${base}tags/${encodeURIComponent(tag)}.html`;
}

// 重要度(1-5)。レガシー記事の欠落は 3 にフォールバック（render.js と同義）。
export const imp = (a) => Number(a.importance) || 3;

// 重要度が高い記事に控えめなアクセントを付けるためのクラス（等価グリッドでのスキャン性向上）。
export function priorityClass(a) {
  return imp(a) >= 4 ? ' is-priority' : '';
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
