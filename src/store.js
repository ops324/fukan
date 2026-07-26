// data/articles.json の読み書き。slug 採番（YYYYMMDD-連番）と link による冪等性を担う。
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { tagSlug } from './tagSlug.js';
import { atomicWrite } from './atomicWrite.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, '..', 'data', 'articles.json');

// --- 楽観的並行制御（CAS）---
// articles.json を書くスクリプトは7本あり、いずれも「全体を読む → 手元で変える → 全体を書く」。
// 自動ジョブ（6:00/18:00）と手動コマンドが重なると、後から保存した側が相手の変更を
// まるごと消す（ロストアップデート。2026-07-27 に再現確認済み）。
//
// ロックではなく CAS を選んだ理由: 排他ロックは取り残すと**公開が止まる**——しかも
// process.on('exit') は SIGINT/SIGTERM で発火しないので、手動コマンドの Ctrl-C という
// 最も起きやすい中断を拾えない。可逆で可視な障害（ロストアップデートは git 履歴から
// 復元でき、差分にも現れる）を、不可逆で不可視な障害に変換してしまう。
// CAS は衝突時に「書かずに中止」＝データ損失もデッドロックも起こさず、
// 7本すべてが通る saveArticles の1箇所で済み、将来増える書き手も自動的に守られる。
//
// 限界（正直に）: 完全な排他ではない。read→hash→rename の数ミリ秒は残る。
// load→save の間（API 呼び出しを挟むと数分）に比べれば桁違いに小さい、というだけ。
let lastRead = null; // { hash, existed } … 直近に読んだディスク上の状態
const digest = (s) => createHash('sha1').update(s).digest('hex');

export async function loadArticles() {
  // ファイル不在は正常な初回（空で開始）。読込/parse 失敗は破損の可能性 → throw。
  // ここで [] を返すと load→save 経路（ingest/set-press-image/migrate/backfill）が
  // 既存記事を空配列で全上書きしてしまうため、握りつぶさず必ず失敗させる。
  if (!existsSync(DATA_FILE)) {
    // 「不在だった」ことも記録する。CAS でこれを見ないと、不在時に読んだ [] を
    // 別プロセスが記事を作った後に保存して全消しする経路が残る（上のコメントの事故を CAS 経由で再発させる）。
    lastRead = { hash: null, existed: false };
    return [];
  }
  let raw;
  try {
    raw = await readFile(DATA_FILE, 'utf8');
  } catch (e) {
    throw new Error(`articles.json を読み込めません（破損の可能性）: ${e.message}`);
  }
  try {
    const parsed = JSON.parse(raw);
    lastRead = { hash: digest(raw), existed: true };
    return parsed;
  } catch (e) {
    throw new Error(`articles.json を JSON として解析できません（破損の可能性）: ${e.message}`);
  }
}

// force: true で CAS を明示的に飛ばす（復旧作業など、上書きが意図であるとき）。
// 既定では、読み込み後にディスク側が変わっていたら**書かずに throw** する。
export async function saveArticles(articles, { force = false } = {}) {
  const json = JSON.stringify(articles, null, 2);
  await mkdir(path.dirname(DATA_FILE), { recursive: true });

  // lastRead が null＝このプロセスは読んでいない（判定材料が無い）ので CAS は課さない。
  if (!force && lastRead) {
    const cur = existsSync(DATA_FILE)
      ? { hash: digest(await readFile(DATA_FILE, 'utf8')), existed: true }
      : { hash: null, existed: false };
    if (cur.existed !== lastRead.existed || cur.hash !== lastRead.hash) {
      throw new Error(
        'articles.json が読み込み後に別のプロセスによって変更されました。'
        + '上書きすると相手の変更（自動ジョブが取り込んだ記事など）が失われるため保存を中止しました。'
        + ' 自動ジョブ（6:00/18:00）と重なった可能性があります。'
        + ' 時間をおいて、このコマンドを最初からやり直してください。',
      );
    }
  }

  await atomicWrite(DATA_FILE, json);
  // 同一プロセス内の2回目以降の保存（set-press-image は2箇所で保存する）が
  // 自分自身の1回目を「他人の変更」と誤検知しないよう、書いた内容で更新する。
  lastRead = { hash: digest(json), existed: true };
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
