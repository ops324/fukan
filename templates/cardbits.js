// カードの共有部品: 実写真サムネと Unsplash 帰属（index/article/section で共用）。
import { esc } from '../src/markdown.js';

// タグページへのリンク（日本語タグは URL エンコード。ファイル名は生UTF-8で出力）
export function tagHref(tag, base = '') {
  return `${base}tags/${encodeURIComponent(tag)}.html`;
}

// Unsplash 画像URLに配信最適化パラメータを付与（バイト数削減）。他プロバイダ/不明URLは素通し。
export function optimizedUrl(url, w = 1200) {
  if (!url || !url.includes('images.unsplash.com')) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}w=${w}&q=70&auto=format&fit=crop`;
}

// 実写真があれば背景画像サムネ、無ければ CSS 抽象サムネ
export function thumb(a, variant) {
  const img = a.image || {};
  if (img.imageUrl) {
    return `<figure class="thumb" style="background-image: url('${esc(optimizedUrl(img.imageUrl, 800))}'); background-size: cover; background-position: center;" aria-hidden="true"></figure>`;
  }
  return `<figure class="thumb ${variant}" aria-hidden="true"></figure>`;
}

// Unsplash 規約準拠の帰属（実写真のときのみ）
export function credit(a) {
  const img = a.image || {};
  if (!img.imageUrl) return '';
  return `<span style="color: var(--color-ink-2); font-size: var(--text-xs);">Photo: <a href="${esc(img.profileUrl)}" target="_blank" rel="noopener">${esc(img.photographer)}</a> / ${esc(img.provider)}</span>`;
}
