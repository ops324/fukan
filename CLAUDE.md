# 俯瞰（FUKAN）— 開発ルール

総合ニュースサイト（テック・AI・科学・経済・政治・国際・カルチャー等）。完全ローカル・課金最小・**アグリゲーター型短評**（要約＋中立論評＋出典リンク。全文転載しない）。
源泉データは `data/articles.json`、`npm run build` が全 HTML ＋ 静的アセットを `dist/` に生成する（`npm run render` は HTML のみを dist へ再生成）。
詳細仕様は [SPEC.md](SPEC.md) / [README.md](README.md)、記事の編集方針は [prompts/generate-articles.md](prompts/generate-articles.md) を参照。

このリポジトリは **`git push` した瞬間に Vercel 本番へ自動デプロイ**され、さらに **launchd の自動ジョブ（1日2回・6時/18時）が差分を自動 commit/push** する。壊れたコード・データはそのまま公開事故になる。以下を必ず守ること。

**配信モデル（重要）**: 生成物（HTML/feed/sitemap/search-index）は **VCS にコミットせず**、Vercel が `vercel.json` の `buildCommand:"npm run build"` / `outputDirectory:"dist"` で**デプロイ時に生成・配信**する。`dist/` は gitignore 済み。これにより自動ジョブの各コミットは実質 `data/articles.json` の差分のみになり、Git 肥大を防ぐ（生成物を毎ジョブ数百ファイル churn させない）。`dist/` の外（リポジトリ直下）にあるソース・ドキュメントは公開配信されない。

## 1. コード品質・脆弱性・デグレ防止【最重点】
- **ES Modules**（`"type":"module"`）。Lint/Formatter は未導入 → **周囲のコードのスタイル**（命名・インデント・コメント密度）に合わせる。
- **設定は一元管理**: 挙動を変える定数・件数・ソースは `src/config.js` に集約。スクリプトやテンプレートに直書きしない。
- **XSS / インジェクション防止**: 外部 RSS・外部由来の文字列を HTML/XML へ差し込む箇所は必ずエスケープを通す。
  - テンプレート（`templates/*.js`）= `esc()` / 本文 Markdown = `mdToHtml()`（ともに `src/markdown.js`）。
    `mdToHtml()` は marked レンダラで**生HTMLをテキスト化**し、リンク/画像の `href`/`src` を**プロトコル許可リスト**（`http(s)`/`mailto`/相対/アンカーのみ）で検証する。`javascript:` 等は `#` に無害化。退行は `npm run check` の `checkSanitizer()` が hard-fail で検知。
  - XML（sitemap/feed）= `render.js` 内の `xmlEsc`
  - 新たに「外部入力 → 出力」の経路を足したら、必ずエスケープ経路を確認する。
- **秘密情報**: API キー類は `.env`（gitignore 済み）のみ。コード・コミット・ログ・生成物に出さない。新キーは `.env.example` に項目だけ追記。
  - 例外的に `CF_BEACON_TOKEN` / `SITE_URL` は**公開前提の値**（全ページに出てよい）。
- **デグレ不変条件（壊さない）**:
  - `data/articles.json` のスキーマ（`slug, headline, lead, body_markdown, tags[], section, source, link, importance(1-5), image_query, image, mode, createdAt, publishedAt`）を**後方互換**で維持。`importance` 欠落のレガシー記事あり（render は 3 にフォールバック）。`createdAt`＝取り込み時刻／`publishedAt`＝出典の発行日時（任意・並び/表示/鮮度の基準）。`publishedAt` 欠落時は `createdAt` にフォールバック。
  - **`slug` 一意・`link` 一意**（link による冪等な重複排除）の前提を壊さない。
  - `npm run build`（および `npm run render`）が**全ページ例外なく完走**すること（1 テンプレの破壊で全生成が止まる）。これが落ちると Vercel のデプロイビルドも失敗する。
- **自己改善ハーネス（MVP）の不変条件**（詳細 SPEC §12）:
  - `src/config.js` の `constitution`（事実忠実性・創作禁止・全文転載しない 等）と `lockedDecisions`（署名表記など）は**弱めない**。`lockedDecisions` の文言が記事HTMLから消えると `npm run check` が落ちる（退行検査）。署名「AI 自動要約 + 人手編集」は現状維持。
  - 日次フローは **writer(Haiku, 下書きのみ・量産)→ judge(別モデル/Sonnet, 出典照合・veto)→ ingest(veto尊重・評価をledgerへ)** の3段。writer は安価な Haiku で約30本/日を量産し、judge は writer≠judge を保つため一段上の Sonnet で独立検証する（モデルは `src/config.js` の `writerModel`/`judgeModel` が正本）。`generate-articles.md` は ingest を実行しない（`auto-generate.sh` が査読と取り込みを行う）。
  - **judge が失敗しても日次ジョブは止めない**（客観ゲートのみで公開＋通知）。評価機構の故障で公開事故/停止を起こさないこと。
  - `data/quality/`（評価 ledger）は **data 配下＝dirty ガードに触れない**。客観指標のしきい値は「床」であって最大化目標ではない。
- **依存は最小**: runtime 依存は `dotenv` / `marked` / `rss-parser` の3つのみ。安易に増やさない（閲覧側はゼロ依存の静的物）。
- **render は“非決定的”**: 日付ラベル・`feed.xml` の `lastBuildDate`・`sitemap` の `lastmod` が毎回更新される。
  → ただし出力先は `dist/`（gitignore 済み）なので、この揺れが **git 差分に出ることはない**。追加の揺れ（`Math.random()` 等）を新たに持ち込まない。

## 2. Git・コミット・デプロイ
- **手動開発の具体手順は [CONTRIBUTING.md](CONTRIBUTING.md) を参照**（`work/<topic>` → PR → マージ）。PR は CI（`.github/workflows/check.yml` = `npm run check`）通過を確認してからマージする。
- **push = 即本番**。`npm run check` 通過 ＋ 目視確認まで `origin main` に push しない。
- **commit / push は明示依頼があったときだけ**行う。
- **コード改善・機能追加・リスクある変更は作業ブランチで行う（既定）**。`main` 直コミットは記事内容や軽微な文言／ドキュメント微修正に限る。
  - 手順: `git switch -c work/<topic>` → 実装 → `npm run check` ＋ preview で検証 → 依頼を受けて `main` にマージ（その瞬間に本番反映）。
  - **理由（このリポジトリ固有・重要）**: 自動ジョブの `git push origin main` は **`main` 上の未 push コミットをまとめて送る**。
    つまり「WIP を `main` にコミットだけして push しない」は安全ではなく、次の自動実行（6/18時）が本番へ出してしまう。
    WIP コミットをブランチに置けば `main` の外に居るため、自動ジョブに拾われない。§(C)のガードは dirty な作業ツリーは止めるが、
    **未 push コミットは止められない**——その穴をブランチ運用で塞ぐ。
  - 自動ジョブのコミットは実質 `data/articles.json`（＋プレス画像等の追跡アセット）のみを触る——生成物は `dist/`（gitignore）に出るため commit されない。よって `src/` のコード変更とは通常競合しない（マージ/リベースはクリーンになりやすい）。
- **自動ジョブとの共存**: `scripts/auto-generate.sh` が差分を自動 commit/push する。`src/` や `templates/` に**作業途中（dirty）の変更を放置しない**——commit（ブランチ上で）するか stash／退避してから離席する。
  （保険として auto-generate.sh はソース系が dirty なら自動コミットを中止し通知するが、根本はこの規律。）
- **コミットメッセージ**:
  - 自動ジョブ: `auto: YYYY-MM-DD HH:MM 記事を更新`（人間は使わない）
  - 人間 / Claude: `feat / fix / docs / chore / refactor` プレフィックス。フッターに
    `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` を付ける。

## 3. テスト・検証（公開前は必須）
自動テストは無い。**公開前に必ず `npm run check`**（レンダー完走＋スキーマ/一意性＋鍵混入チェック。作業ツリーは汚さない）。

| コマンド | 用途 |
|---|---|
| `npm run check` | 公開前ゲート（必須）。レンダー完走＋スキーマ/一意性＋鍵混入＋**constitution 退行検査**＋**客観品質警告**（警告は非ブロック） |
| `npm run candidates` | RSS 取得の疎通（`data/_candidates.json` 生成） |
| `npm run build` | `articles.json` から `dist/` に全 HTML ＋ `dist/assets/` を生成（Vercel のデプロイビルドと同一）。ローカル目視はこれ |
| `npm run render` | `articles.json` から `dist/` に HTML のみ再生成（アセットは複製しない。下書き再描画用） |
| `npm run migrate-sections` | 旧カテゴリ section を `config.sectionAliases` で navSections へ一括正規化（旧ラベルはタグへ退避・冪等）。実行後 `npm run build` |
| `npm run evaluate` | 直近記事を客観評価して ledger に記録（`--rate <slug> <1-5> [メモ]` で人手評価）。SPEC §12 |
| `npm run backfill-images` | 画像の補完／重複解消（画像系を触ったとき） |
| `npm run refresh-brand-photos` | ブランド写真の索引（`data/brand-photos.json`）を更新。他社ロゴ/UI の写り込み判定に使う。マージ方式＝レート制限に当たっても再実行で続きから育つ。月1回程度 |
| `npm run recheck-images` | 既存記事のサムネをブランド不一致で点検（dry-run・API不要）。`-- --apply` で差し替え＋再生成、`-- --limit N` で件数を絞る |
| `npm run set-press-image` | 公式プレス画像を手動登録（クレジット必須・自動上書き保護。SPEC §6.1） |
| `npm run serve` | `npm run build` 実行後、`dist/` を http://localhost:8000 で配信してローカル確認 |

フロント目視は `npm run serve`（dist を配信）か Claude の preview_*（ポートは環境依存）で起動 → console/network のエラー確認 → トップ／記事／セクション／タグ／`feed.xml` を確認し、スクショで証跡を残す。

**公開前チェックリスト**
- [ ] `npm run check` が緑
- [ ] 主要ページ（トップ／記事／セクション／タグ／RSS）が崩れていない
- [ ] `sitemap.xml` / `robots.txt` / `feed.xml` / `search-index.json` が生成されている
- [ ] `git diff` に鍵・個人情報・想定外の巨大差分がない
