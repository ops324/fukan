// Vercel／ローカル共通の完全ビルド。articles.json から dist/ に全 HTML を生成し、
// 静的アセット（assets/）を dist/assets/ へ複製して「dist だけで配信が完結する」状態にする。
// Vercel は vercel.json の buildCommand:"npm run build" / outputDirectory:"dist" でこれを実行する。
import { cpSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadArticles } from './store.js';
import { renderSite } from './render.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const arts = await loadArticles();
const stats = await renderSite(arts); // 既定の出力先＝dist

// 静的アセット（styles.css / search.js / logo / og 画像 / press 画像など）を dist へ複製。
// URL は /assets/... のまま不変。render は assets をコピーしないためここで用意する。
cpSync(path.join(ROOT, 'assets'), path.join(DIST, 'assets'), { recursive: true });

console.log(`✓ ${stats.articles} 記事を dist/ にビルドしました（HTML + assets）。`);
