// data/articles.json の読み書き。slug 採番（YYYYMMDD-連番）と link による冪等性を担う。
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { tagSlug } from './tagSlug.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, '..', 'data', 'articles.json');

export async function loadArticles() {
  // ファイル不在は正常な初回（空で開始）。読込/parse 失敗は破損の可能性 → throw。
  // ここで [] を返すと load→save 経路（ingest/set-press-image/migrate/backfill）が
  // 既存記事を空配列で全上書きしてしまうため、握りつぶさず必ず失敗させる。
  if (!existsSync(DATA_FILE)) return [];
  let raw;
  try {
    raw = await readFile(DATA_FILE, 'utf8');
  } catch (e) {
    throw new Error(`articles.json を読み込めません（破損の可能性）: ${e.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`articles.json を JSON として解析できません（破損の可能性）: ${e.message}`);
  }
}

export async function saveArticles(articles) {
  await mkdir(path.dirname(DATA_FILE), { recursive: true });
  await writeFile(DATA_FILE, JSON.stringify(articles, null, 2), 'utf8');
}

// 既存 link 集合（重複判定用）
export function existingLinks(articles) {
  return new Set(articles.map((a) => a.link));
}

const dedupe = (tags) => tags.filter((t, i, arr) => t && arr.indexOf(t) === i);

// 旧カテゴリ → navSections 正規化（config.sectionAliases）。エイリアスがあれば section を
// 寄せ、旧ラベルを先頭タグに退避（重複排除・5件上限）。無ければ section はそのまま。
// ingest（取り込み時）と migrate-sections（一括移行）で共用。
//
// タグの整形は「置換 → 重複排除 → 5件上限」の順で、**エイリアス有無の分岐より前**に行う。
// 分岐の後ろに置くと、エイリアス無しの経路（現行の navSections はすべてこちら）が
// タグを素通しして、パスに使えない文字がそのまま保存される（2026-07-26 の 'AR/VR'）。
// 置換で 2 つのタグが同じ文字列になることがあるため、重複排除は slice より前が必須。
export function normalizeSectionTags(name, tags = []) {
  const clean = dedupe((tags || []).map(tagSlug));
  const aliased = config.sectionAliases?.[name];
  if (!aliased) return { section: name, tags: clean.slice(0, 5) };
  return { section: aliased, tags: dedupe([name, ...clean]).slice(0, 5) };
}

// 日付ベースの slug を採番。同日内の既存件数 + offset で連番。
export function makeSlug(articles, dateStr, offset = 0) {
  // 件数ではなく「既存の最大連番＋1」。削除で欠番が出ても衝突しない。
  let maxSeq = 0;
  for (const a of articles) {
    if (!a.slug || !a.slug.startsWith(`${dateStr}-`)) continue;
    const n = Number(a.slug.slice(dateStr.length + 1));
    if (Number.isFinite(n) && n > maxSeq) maxSeq = n;
  }
  const seq = String(maxSeq + offset + 1).padStart(2, '0');
  return `${dateStr}-${seq}`;
}

// YYYYMMDD（ローカル日付）
export function yyyymmdd(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}
