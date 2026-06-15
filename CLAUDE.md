# AXIOM AI — 開発ルール

AI ニュースサイト。完全ローカル・課金0・**アグリゲーター型短評**（要約＋中立論評＋出典リンク。全文転載しない）。
源泉データは `data/articles.json`、`npm run render` が全 HTML を再生成する。
詳細仕様は [SPEC.md](SPEC.md) / [README.md](README.md)、記事の編集方針は [prompts/generate-articles.md](prompts/generate-articles.md) を参照。

このリポジトリは **`git push` した瞬間に Vercel 本番へ自動デプロイ**され、さらに **launchd の自動ジョブ（1日3回）が差分を自動 commit/push** する。壊れたコード・データはそのまま公開事故になる。以下を必ず守ること。

## 1. コード品質・脆弱性・デグレ防止【最重点】
- **ES Modules**（`"type":"module"`）。Lint/Formatter は未導入 → **周囲のコードのスタイル**（命名・インデント・コメント密度）に合わせる。
- **設定は一元管理**: 挙動を変える定数・件数・ソースは `src/config.js` に集約。スクリプトやテンプレートに直書きしない。
- **XSS / インジェクション防止**: 外部 RSS・外部由来の文字列を HTML/XML へ差し込む箇所は必ずエスケープを通す。
  - テンプレート（`templates/*.js`）= `esc()` / 本文 Markdown = `mdToHtml()`（ともに `src/markdown.js`）
  - XML（sitemap/feed）= `render.js` 内の `xmlEsc`
  - 新たに「外部入力 → 出力」の経路を足したら、必ずエスケープ経路を確認する。
- **秘密情報**: API キー類は `.env`（gitignore 済み）のみ。コード・コミット・ログ・生成物に出さない。新キーは `.env.example` に項目だけ追記。
  - 例外的に `CF_BEACON_TOKEN` / `SITE_URL` は**公開前提の値**（全ページに出てよい）。
- **デグレ不変条件（壊さない）**:
  - `data/articles.json` のスキーマ（`slug, headline, lead, body_markdown, tags[], section, source, link, importance(1-5), image_query, image, mode, createdAt`）を**後方互換**で維持。`importance` 欠落のレガシー記事あり（render は 3 にフォールバック）。
  - **`slug` 一意・`link` 一意**（link による冪等な重複排除）の前提を壊さない。
  - `npm run render` が**全ページ例外なく完走**すること（1 テンプレの破壊で全生成が止まる）。
- **依存は最小**: runtime 依存は `dotenv` / `marked` / `rss-parser` の3つのみ。安易に増やさない（閲覧側はゼロ依存の静的物）。
- **render は現状“非決定的”**: 日付ラベル・`feed.xml` の `lastBuildDate`・`sitemap` の `lastmod` が毎回更新される。
  → **「`npm run render` 後に差分が出た＝自分が変更した」ではない**。これは正常。追加の揺れ（`Math.random()` 等）を新たに持ち込まない。

## 2. Git・コミット・デプロイ
- **push = 即本番**。`npm run check` 通過 ＋ 目視確認まで `origin main` に push しない。
- **commit / push は明示依頼があったときだけ**行う。
- **コード改善・機能追加・リスクある変更は作業ブランチで行う（既定）**。`main` 直コミットは記事内容や軽微な文言／ドキュメント微修正に限る。
  - 手順: `git switch -c work/<topic>` → 実装 → `npm run check` ＋ preview で検証 → 依頼を受けて `main` にマージ（その瞬間に本番反映）。
  - **理由（このリポジトリ固有・重要）**: 自動ジョブの `git push origin main` は **`main` 上の未 push コミットをまとめて送る**。
    つまり「WIP を `main` にコミットだけして push しない」は安全ではなく、次の自動実行（6/12/18時）が本番へ出してしまう。
    WIP コミットをブランチに置けば `main` の外に居るため、自動ジョブに拾われない。§(C)のガードは dirty な作業ツリーは止めるが、
    **未 push コミットは止められない**——その穴をブランチ運用で塞ぐ。
  - 自動ジョブのコミットは生成物＋`data/articles.json` のみを触るため、`src/` のコード変更とは通常競合しない（マージ/リベースはクリーンになりやすい）。
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
| `npm run check` | 公開前ゲート（必須） |
| `npm run candidates` | RSS 取得の疎通（`data/_candidates.json` 生成） |
| `npm run render` | `articles.json` から全 HTML 再生成 |
| `npm run backfill-images` | 画像の補完／重複解消（画像系を触ったとき） |
| `npm run serve` | http://localhost:8000 でローカル確認 |

フロント目視は `npm run serve` か Claude の preview_*（ポートは環境依存）で起動 → console/network のエラー確認 → トップ／記事／セクション／タグ／`feed.xml` を確認し、スクショで証跡を残す。

**公開前チェックリスト**
- [ ] `npm run check` が緑
- [ ] 主要ページ（トップ／記事／セクション／タグ／RSS）が崩れていない
- [ ] `sitemap.xml` / `robots.txt` / `feed.xml` / `search-index.json` が生成されている
- [ ] `git diff` に鍵・個人情報・想定外の巨大差分がない
