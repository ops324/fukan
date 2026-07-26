// ヘッドレスClaude執筆フロー用: Claude が書いた data/_drafts.json を取り込み、
// slug採番・画像取得・重複排除・保存・サイト再生成までを決定的に行う。
// drafts の各要素: { headline, lead, body_markdown, tags[], section, source, link }
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { loadArticles, saveArticles, makeSlug, yyyymmdd, existingLinks, normalizeSectionTags } from './store.js';
import { fetchImage, imageKey, articleImageTokens, relevanceScore } from './fetchImage.js';
import { fetchPressImage } from './pressImage.js';
import { renderSite } from './render.js';
import { evaluateArticle, appendEvaluation, writeRunSummary, maxFeatureContainment } from './evaluate.js';
import { appendVeto } from './vetoLedger.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const draftsPath = path.join(ROOT, 'data', '_drafts.json');
const reviewPath = path.join(ROOT, 'data', '_review.json');
// Phase 4: LLM 画像一致チェックのターゲット（境界スコアの新規 stock 画像）。gitignore 済み。
// 後続の auto-generate.sh 画像査読ステップ→applyImageReview.js が消費・削除する。
const imageTargetsPath = path.join(ROOT, 'data', '_image_review_targets.json');

let drafts;
try {
  drafts = JSON.parse(await readFile(draftsPath, 'utf8'));
} catch {
  console.error(`✗ ${path.relative(ROOT, draftsPath)} が読めません。Claude が下書きを書き出したか確認してください。`);
  process.exit(1);
}
if (!Array.isArray(drafts)) { console.error('✗ _drafts.json は配列である必要があります。'); process.exit(1); }

// 別モデル judge の判定（data/_review.json）。あれば veto された下書きを破棄する。
// 形式: [{ link, verdict: 'pass'|'veto', scores?, overall?, critique?, suggestions? }, ...]
// judge が走らなかった/失敗した場合は単に存在しない → 客観ゲートのみで通常公開（日次を止めない）。
const reviewByLink = new Map();
if (existsSync(reviewPath)) {
  try {
    const review = JSON.parse(await readFile(reviewPath, 'utf8'));
    if (Array.isArray(review)) for (const r of review) { if (r?.link) reviewByLink.set(r.link, r); }
  } catch { console.error('  WARN: _review.json を解析できませんでした（judge 判定を無視して続行）'); }
}

const store = await loadArticles();
const seen = existingLinks(store);
const dateStr = yyyymmdd();
const created = [];
const createdReviews = []; // created[i] に対応する judge 判定（無ければ null）

// 既存記事で使用済みの画像キーを集めておく（重複回避）
const usedImages = new Set();
for (const a of store) { const k = imageKey(a.image); if (k) usedImages.add(k); }

// 下書きの sources[] を検証して整える（決定論・LLM 不使用）。
// writer が拾った出所不明のサイトをそのまま公開しないよう、config.trustedSecondary に
// 載っているホスト（それ自身 or そのサブドメイン）だけを残す。重複と主出典は除く。
function normalizeSources(raw, primaryLink) {
  if (!Array.isArray(raw)) return [];
  const seenUrl = new Set(primaryLink ? [primaryLink] : []);
  const out = [];
  for (const s of raw) {
    const url = typeof s?.url === 'string' ? s.url.trim() : '';
    const name = typeof s?.name === 'string' ? s.name.trim() : '';
    if (!/^https?:\/\//.test(url) || !name || seenUrl.has(url)) continue;
    let host;
    try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { continue; }
    const trusted = (config.trustedSecondary || []).some((d) => host === d || host.endsWith(`.${d}`));
    if (!trusted) { console.error(`  … 信頼リスト外の参照を除外: ${host}`); continue; }
    seenUrl.add(url);
    out.push({ url, name });
  }
  return out.slice(0, 4); // 出典欄が長くなりすぎないよう上限
}

for (const d of drafts) {
  if (!d?.headline || !d?.body_markdown || !d?.link) { console.error('  スキップ（必須欠落）'); continue; }
  if (seen.has(d.link)) { console.error(`  スキップ（重複）: ${d.link}`); continue; }
  // judge が veto した下書きは公開しない（「無理に書かない」原則と一致）。強い根拠時のみ veto される。
  const rv = reviewByLink.get(d.link);
  if (rv?.verdict === 'veto') {
    console.error(`  ✗ veto により破棄: ${d.headline}${rv.critique ? ` — ${rv.critique}` : ''}`);
    // 失敗を ledger に残す（vetoDigest が writer へ還流し、同じ型の誤りの再発を減らす）。
    // ledger の故障で公開を止めないよう必ず握りつぶす（SPEC §12「評価機構の故障で公開事故を起こさない」）。
    try {
      await appendVeto({
        link: d.link,
        headline: d.headline,
        section: d.section,
        source: d.source,
        tier: d.tier,
        importance: Number(d.importance) || null,
        critique: rv.critique,
        scores: rv.scores,
        overall: rv.overall,
        flags: evaluateArticle(d, store).flags,
        // judge がその出典を実際に読めたか。**検査バイアスの測定に要る**——出典を読めなかった
        // 記事は誤りがあっても検出されず veto に上がらないため、これを pass 側にも記録して
        // 初めて「読めた記事」と「読めなかった記事」の品質を比較できる（SPEC §11）。
        ...(rv.sourceFetched != null ? { sourceFetched: rv.sourceFetched } : {}),
        ...(rv.fixable != null ? { fixable: rv.fixable, fixHint: rv.fixHint } : {}),
        // 修正リトライを経てなお veto された＝救済に失敗した回（救済率の分母になる）。
        ...(rv.fixAttempted ? { stage: 'refix' } : {}),
      });
    } catch (err) {
      console.error(`  WARN: veto の記録に失敗しました（取り込みは継続）: ${err.message}`);
    }
    continue;
  }
  // 同じニュースの二重掲載を止める。link 重複排除は「同一URL」しか捕まえないため、出典違いで
  // 同じ出来事を書いた下書きは素通りする（2026-07-25 に同じ Starship 試験飛行を2本公開した）。
  // 母集団に created を含めるのは同一ラン内の重複も止めるため。直近 recentWindow 本に絞るのは
  // 古い記事との偶然一致を避けるため（続報は正当なので、遠い過去とは比較しない）。
  const dupPool = [...created, ...store].slice(0, config.qualityThresholds.recentWindow + created.length);
  const fc = maxFeatureContainment(d, dupPool);
  const dupSim = evaluateArticle(d, dupPool).metrics.maxDupSim;
  const qt = config.qualityThresholds;
  const byFeature = fc.shared >= qt.dupBlockMinShared && fc.ratio >= qt.dupBlockContainment;
  if (byFeature || dupSim >= qt.dupBlockJaccard) {
    const why = byFeature
      ? `特徴語 ${fc.shared} 語一致・包含率 ${fc.ratio.toFixed(2)}${fc.against ? ` ↔ ${fc.against}` : ''}`
      : `見出し類似度 ${dupSim.toFixed(2)}`;
    console.error(`  ✗ 二重掲載により破棄: ${d.headline}（${why}）`);
    continue;
  }
  seen.add(d.link);
  const importance = Math.min(5, Math.max(1, Number(d.importance) || 3));
  // 画像はヒーロー候補となる重要記事(importance>=imageImportanceFloor)だけに付ける（取得・ページ重量の節約）。
  // 軽微な記事は image:null（表示テンプレは画像が無ければ何も出さない）。
  // ① 出典が公式ドメインなら og:image（報道用素材）を優先採用 → ② 無理なら stock 写真へフォールバック。
  let image = null;
  if (importance >= config.imageImportanceFloor) {
    image = await fetchPressImage({ ...d, importance }, usedImages);
    if (image) console.error(`  [press] 公式画像を採用: ${d.headline} — 提供: ${image.credit}`);
    else image = await fetchImage(d, created.length, usedImages);
  }
  // 裏取りに使った2次媒体を検証（信頼リスト外・主出典の重複・壊れた URL を落とす）。
  const extraSources = normalizeSources(d.sources, d.link);
  // 旧カテゴリは navSections へ正規化（旧ラベルはタグへ退避）。新規の総合カテゴリは素通り。
  const { section, tags } = normalizeSectionTags(
    d.section || 'AI',
    Array.isArray(d.tags) ? d.tags.slice(0, 5) : [],
  );
  created.push({
    slug: makeSlug(store, dateStr, created.length),
    headline: String(d.headline).trim(),
    lead: String(d.lead || '').trim(),
    body_markdown: String(d.body_markdown).trim(),
    tags,
    section,
    source: d.source || '',
    link: d.link,
    // 裏取りに使った2次媒体。読者が検証できるよう記事ページに併記する（templates/article.js）。
    // 空なら省略してレガシー記事と同じ形にする。
    ...(extraSources.length ? { sources: extraSources } : {}),
    importance,
    image_query: (d.image_query || '').trim(),
    image,
    mode: 'full',
    createdAt: new Date().toISOString(),
    // 出典の発行日時（候補の publishedAt を正規化）。並び・表示・鮮度の基準。
    // 不明なら null → render は createdAt にフォールバック（後方互換）。
    publishedAt: d.publishedAt ? new Date(d.publishedAt).toISOString() : null,
  });
  createdReviews.push(rv || null);
}

if (!created.length) {
  console.log('取り込む新規記事はありませんでした。');
} else {
  const all = [...created, ...store];
  // レンダーが先・保存が後。「articles.json に保存されている ＝ レンダーできる」を
  // 構造的な不変条件にする（renderSite は渡された配列だけを見て articles.json を読まない）。
  // 逆順だと render の失敗時に描画できないデータが残り、自動ジョブがそれを push して
  // Vercel のデプロイビルドまで巻き込む（2026-07-26 の事故）。dist/ は gitignore 済みなので
  // 途中まで書かれた生成物がリポジトリに残ることもない。
  const stats = await renderSite(all);
  await saveArticles(all);
  console.log(`✓ ${created.length} 件取り込み、計 ${stats.articles} 記事を出力。`);
  for (const a of created) console.log(`  + ${a.headline}`);

  // --- 評価を ledger に蓄積（=学習の記憶）---
  // 客観指標（決定的）＋ judge 判定（あれば）を合流して1記事1行で残す。
  try {
    const evalsForCreated = [];
    for (let i = 0; i < created.length; i++) {
      const a = created[i];
      const rv = createdReviews[i];
      const objective = evaluateArticle(a, store); // 母集団は取り込み前の既存記事
      evalsForCreated.push(objective);
      await appendEvaluation({
        ...objective,
        source: rv ? 'merged' : 'objective',
        ...(rv ? { scores: rv.scores, overall: rv.overall, critique: rv.critique, suggestions: rv.suggestions } : {}),
        // pass 側にも記録するのが要点。veto だけ見ると「読めない出典は veto が少ない＝品質が良い」と
        // 誤読してしまう（実際は検査できていないだけ）。両方揃って初めて比較できる。
        ...(rv?.sourceFetched != null ? { sourceFetched: rv.sourceFetched } : {}),
      });
      // 一度 veto され、修正リトライで救済された記事。veto ledger にも結果を残し、
      // 救済率（rescued / (rescued + discarded)）を同じファイルから測れるようにする。
      // 救済率が100%に張り付くのは「執筆改善」ではなく再査読のゲーム化のシグナル（SPEC §12.6）。
      if (rv?.fixAttempted) {
        try {
          await appendVeto({
            link: a.link,
            headline: a.headline,
            section: a.section,
            source: a.source,
            importance: a.importance,
            critique: rv.initialCritique || rv.critique,
            scores: rv.scores,
            overall: rv.overall,
            stage: 'refix',
            outcome: 'rescued',
          });
        } catch { /* 記録の失敗は公開を妨げない */ }
      }
    }
    await writeRunSummary(all, evalsForCreated);
  } catch (err) {
    console.error(`  WARN: 評価の記録に失敗しました（公開は完了済み）: ${err.message}`);
  }

  // --- Phase 4: LLM 画像一致チェックのターゲット抽出（境界スコアのみ・任意）---
  // 決定論スコアが band 内＝「機械的には判断が付きにくい」新規 stock 画像だけを LLM 査読に回す。
  // 採点・査読の材料は alt＋description（description も保存するようになった）。press/抽象サムネは対象外。
  const lr = config.imageRelevance.llmReview;
  if (lr?.enabled) {
    const [lo, hi] = lr.band;
    const targets = [];
    for (const a of created) {
      if (!a.image?.imageUrl || a.image.kind === 'press') continue;
      const alt = a.image.alt || '';
      const description = a.image.description || '';
      const score = relevanceScore({ alt, description }, articleImageTokens(a));
      if (score >= lo && score < hi) {
        targets.push({ slug: a.slug, headline: a.headline, lead: a.lead, alt, description, score });
      }
    }
    if (targets.length) {
      await writeFile(imageTargetsPath, JSON.stringify(targets, null, 2));
      console.log(`  [image-llm] 境界スコアの画像 ${targets.length} 件を査読対象に書き出し。`);
    }
  }
}

// 一時ファイルを掃除（judge の _review.json も含む）。
// 注: _image_review_targets はこの ingest が書いた「後続 LLM 査読への入力」なので、ここでは消さない
// （消すと auto-generate.sh の画像査読ステップが読めない）。消費側の applyImageReview.js と、
// auto-generate.sh 開始時の掃除に委ねる。_image_review（査読結果）も同様に applyImageReview が消す。
for (const f of [draftsPath, reviewPath, path.join(ROOT, 'data', '_candidates.json')]) {
  try { await unlink(f); } catch { /* noop */ }
}
