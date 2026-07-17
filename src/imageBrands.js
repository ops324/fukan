// 記事とサムネ写真の「ブランド不一致」を判定する。
// 背景: ストック写真の検索語（"artificial intelligence" 等）には、他社のロゴやアプリ画面が
// 写り込んだ写真が大量に混ざる。そのため Claude の記事に ChatGPT のスクショが付く事故が起きた。
// 対策: 記事が扱っていないブランドが写っている候補を捨てる（記事がブランドに触れていなければ、
// ブランド写真は一律に避ける）。判定は2層:
//   ①テキスト層: 写真の alt/description にブランド名が出るか（例「chatgpt on a phone」）。
//   ②ランキング層: そのブランド名で検索した上位に出る写真か（data/brand-photos.json）。
//     alt は自動生成で当てにならない——例えば OpenAI ロゴの 3D レンダは alt が「ball of string」で、
//     テキスト層では絶対に捕まらない。「そのブランド名で引くと出てくる」方が信号として強い。
//     索引は `npm run refresh-brand-photos` で更新する。無くても①だけで動く（縮退運転）。
//
// article: 記事側（見出し・リード・タグ・出典・image_query）に現れる表記。日本語表記も拾う。
// photo:   写真側（Unsplash/Pexels の英語 alt/description）に現れる表記。誤検出を避けるため
//          単語境界で照合し、一般名詞と衝突しうる語（Meta/Apple/Amazon 等）は入れない。
// queries: ランキング層の索引を作るための検索語（そのブランドのロゴ/UI が写った写真を集める）。
import { readFile } from 'node:fs/promises';

const BRANDS = [
  {
    key: 'openai',
    article: /openai|chat\s?gpt|\bgpt[-\s]?\d|dall[-\s·]?e|\bsora\b|オープンAI|チャットGPT/i,
    photo: /\b(openai|chat\s?gpt|gpt[-\s]?\d|dall[-\s]?e)\b/i,
    queries: ['chatgpt', 'openai', 'openai logo'],
  },
  {
    key: 'anthropic',
    article: /anthropic|\bclaude\b|アンソロピック|クロード/i,
    photo: /\b(anthropic|claude)\b/i,
    queries: ['claude ai', 'anthropic'],
  },
  {
    key: 'google',
    article: /\bgemini\b|\bbard\b|deepmind|ジェミニ|ディープマインド/i,
    photo: /\b(gemini|bard|deepmind|google\s+(ai|search|assistant))\b/i,
    queries: ['gemini ai app', 'google deepmind', 'google bard'],
  },
  {
    key: 'microsoft',
    article: /copilot|\bbing\b|コパイロット/i,
    photo: /\b(copilot|bing)\b/i,
    queries: ['microsoft copilot', 'bing chat'],
  },
  {
    key: 'meta',
    article: /\bllama\b|\bmeta\s?ai\b|ラマ/i,
    // llama は動物のラマと衝突するため、写真側は "meta ai" / "llama ai" のみを見る。
    photo: /\b(meta\s?ai|llama\s?ai)\b/i,
    queries: ['meta ai app'],
  },
  {
    key: 'xai',
    article: /\bgrok\b|\bxai\b|\bx\.ai\b|グロック/i,
    photo: /\b(grok|xai|x\.ai)\b/i,
    queries: ['grok xai'],
  },
  {
    key: 'perplexity',
    article: /perplexity|パープレキシティ/i,
    photo: /\bperplexity\b/i,
    queries: ['perplexity ai'],
  },
  {
    key: 'mistral',
    article: /mistral|ミストラル/i,
    photo: /\bmistral\b/i,
    queries: ['mistral ai'],
  },
  {
    key: 'deepseek',
    article: /deepseek|ディープシーク/i,
    photo: /\bdeepseek\b/i,
    queries: ['deepseek app'],
  },
  {
    key: 'midjourney',
    article: /midjourney|stable\s?diffusion|ミッドジャーニー/i,
    photo: /\b(midjourney|stable\s?diffusion)\b/i,
    queries: ['midjourney', 'stable diffusion'],
  },
];

export const brandKeys = BRANDS.map((b) => b.key);
export const brandQueries = BRANDS.map((b) => ({ key: b.key, queries: b.queries }));

// ランキング層の索引（写真スラッグ → ブランド）。refresh-brand-photos が生成する。
// 無い／壊れていても選定は止めない（テキスト層だけの縮退運転に落ちる）。
const indexPath = new URL('../data/brand-photos.json', import.meta.url);
let brandPhotoSlugs = {};
try {
  const raw = JSON.parse(await readFile(indexPath, 'utf8'));
  brandPhotoSlugs = raw?.slugs || {};
} catch {
  brandPhotoSlugs = {};
}

function matched(text, field) {
  const found = new Set();
  if (!text) return found;
  for (const b of BRANDS) if (b[field].test(text)) found.add(b.key);
  return found;
}

// 記事が扱っているブランド（0個なら「ブランド非依存の記事」）
export function articleBrands(article) {
  const hay = [
    article.headline,
    article.lead,
    article.image_query,
    article.source,
    ...(article.tags || []),
  ].filter(Boolean).join(' ');
  return matched(hay, 'article');
}

// 写真に写り込んでいるブランド。①alt/description のテキスト ②ブランド名検索の索引、の和。
export function photoBrands(photo) {
  const found = matched([photo?.alt, photo?.description].filter(Boolean).join(' '), 'photo');
  const slug = photoSlug(photo);
  if (slug && brandPhotoSlugs[slug]) found.add(brandPhotoSlugs[slug]);
  return found;
}

// 写真の一意スラッグ（fetchImage.imageKey と同じ規則。循環 import を避けるためここに持つ）。
export function photoSlug(photo) {
  const url = photo?.imageUrl;
  if (!url) return null;
  const m = url.match(/photo-([\w-]+)/)          // Unsplash
    || url.match(/\/photos\/(\d+)\//)             // Pexels (URL内id)
    || url.match(/[?&]id=(\d+)/);                 // Pexels (query id)
  return m ? m[1] : null;
}

// 写真が「記事の扱っていないブランド」を写しているか
export function brandConflicts(photo, allowed) {
  for (const key of photoBrands(photo)) if (!allowed.has(key)) return true;
  return false;
}
