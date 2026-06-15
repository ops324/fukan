# AXIOM AI — システム仕様書

AI ニュースの取得・執筆・画像付与・サイト生成を全自動化する、ヘッドレス Claude Code ベースのニュースパイプライン。

- 最終更新: 2026-06-15
- 対象リポジトリ: `AIニュースサイト/`
- 本番URL: `https://axiom-ai-xi.vercel.app`（Vercel・git push で自動デプロイ）
- 配信形態: 静的サイト（HTML/CSS、閲覧は依存ゼロ。検索・演出のみ軽量バニラ JS = `search.js` / `reveal.js`）

---

## 1. 概要

ローカルの macOS 上で動作し、**ヘッドレス起動した Claude Code 自身が**最新の AI ニュースを取材・執筆して、
既存デザイン（AXIOM AI）の静的サイトを毎日3回自動更新する。

- **追加課金なし**: 外部 LLM API を従量課金で叩かない。執筆は Claude Code（Anthropic サブスク内）で完結。APIキー不要。
- **サイト側に LLM 呼び出しなし**: 生成物は素の HTML。表示は純粋な静的配信。
- **著作権配慮**: 全文転載ではなく「短い独自要約＋論評＋出典リンク」のアグリゲーター型。

### 設計原則
1. **執筆者＝Claude / 描画＝決定的 Node**: 知性が要る工程（取材・執筆・編集判断）は Claude、機械的工程（採番・画像・描画）は Node スクリプトに分離。
2. **編集判断を持つ**: 新着を時系列で全部載せるのではなく、重要度で選別・序列化する。
3. **冪等**: 処理済みリンクは再生成しない。何度走らせても重複記事は作らない。

---

## 2. アーキテクチャ

```
launchd（毎日 6:00 / 12:00 / 18:00）
  └─ scripts/auto-generate.sh
       └─ claude --dangerously-skip-permissions -p prompts/generate-articles.md
            ① node src/fetchCandidates.js
                 RSS取得 → 重複排除 → 弱いソース除外 → 一次情報優先で並べ
                 → data/_candidates.json（候補プール、既定12件）
            ② Claude が編集判断・取材・執筆（セッション内）
                 - 候補を重要度1〜5で採点、3以上を最大2件選別、類似は統合
                 - 元記事を WebFetch で読み、数値を WebSearch で裏取り
                 → data/_drafts.json（下書き）
            ③ node src/ingestDrafts.js
                 slug採番 → 画像取得 → 重複排除 → data/articles.json 保存
                 → render（index / archive / articles/* / sections/* / tags/*
                           / 法的6ページ / search-index.json / sitemap.xml
                           / robots.txt / feed.xml / feed.xsl）
       └─ 健全性チェック（記事数増減・exit code）→ 異常なら macOS 通知
       └─ 変更があれば git commit & push（Vercel 自動デプロイ）
       └─ 実行結果を data/scheduler.log に追記
```

---

## 3. ディレクトリ構成

```
AIニュースサイト/
├── index.html              # 生成: トップページ
├── archive.html            # 生成: アーカイブ（記事が retentionTop を超えたら）
├── articles/<slug>.html    # 生成: 各記事ページ
├── sections/<slug>.html    # 生成: ナビ各タブ（セクション別一覧。空でも生成）
├── tags/<tag>.html         # 生成: タグ別一覧（UTF-8ファイル名）＋ index.html（タグクラウド）
├── about/contact/privacy/terms/editorial/disclaimer.html # 生成: 法的・運営ページ
├── sitemap.xml             # 生成: サイトマップ
├── robots.txt              # 生成: クローラ指示（Sitemap 参照）
├── feed.xml                # 生成: RSS 2.0 フィード（XSL 参照付き）
├── feed.xsl                # 生成: feed.xml をブラウザで読み物表示する XSLT
├── search-index.json       # 生成: サイト内検索のクライアント用インデックス
├── assets/
│   ├── styles.css          # デザイン（OKLCH トークン・全クラス・ライト/ダーク・影/質感/演出）
│   ├── search.js           # サイト内検索＋テーマトグル絵文字の初期化（依存ゼロ）
│   ├── reveal.js           # 読了プログレスバー＋段階リビール（依存ゼロ・JS無効でも本文表示）
│   ├── og-default.jpg      # SNSシェア共通OG画像（1200×630）
│   └── logo.png            # 構造化データ publisher.logo（512×512）
├── data/
│   ├── articles.json       # コンテンツの永続ストア（=サイトの正本）
│   ├── _candidates.json    # 一時: 候補プール（実行後に掃除）
│   ├── _drafts.json        # 一時: Claude の下書き（実行後に掃除）
│   ├── .health             # 一時: 新規ゼロの連続回数（監視用・git管理外）
│   └── scheduler.log       # 定期実行ログ
├── prompts/
│   └── generate-articles.md # Claude への執筆指示（編集方針を内包）
├── scripts/
│   └── auto-generate.sh    # launchd ラッパー（ヘッドレス Claude を起動）
├── src/
│   ├── config.js           # 設定（フィード・件数・閾値・画像）
│   ├── fetchCandidates.js  # 候補を JSON 出力
│   ├── fetchNews.js        # RSS/補助API 取得・重複排除・一次情報優先
│   ├── ingestDrafts.js     # 下書き取込（採番・画像・保存・再生成）
│   ├── fetchImage.js       # Unsplash/Pexels 画像（無ければ CSS サムネ）
│   ├── backfill-images.js  # 既存記事に実写真を一括付与
│   ├── render.js           # 重要度序列・保持・アーカイブの描画統括（任意 outDir 対応）
│   ├── renderOnly.js       # 再描画のみ
│   ├── check.js            # 公開前チェック（render完走/スキーマ/鍵混入）
│   ├── store.js            # articles.json 読み書き・slug採番
│   └── markdown.js         # md→html / エスケープ
├── templates/
│   ├── layout.js           # ticker/header(ナビ・検索・テーマトグル)/footer/page 骨格・解析
│   ├── cardbits.js         # 共有: サムネ thumb() / 帰属 credit() / tagHref() / optimizedUrl()
│   ├── index.js            # トップ（＋メルマガ欄）
│   ├── article.js          # 記事詳細（読了時間・共有ボタン・関連記事）
│   ├── section.js          # セクション別一覧
│   ├── tag.js              # タグ別一覧 renderTag() / タグクラウド renderTagsIndex()
│   ├── legal.js            # 法的・運営ページ renderLegalPages()
│   └── archive.js          # アーカイブ
├── CLAUDE.md               # 開発ルール（毎回自動読込・コード品質/Git/検証）
├── README.md               # デザイン・概要
├── SPEC.md                 # 本書（技術仕様・運用）
├── package.json            # スクリプト（candidates / render / check / backfill-images / serve）
├── .env.example            # 環境変数の雛形（すべて任意）
└── _backup/                # 退避（旧HTML・廃止した qwen フォールバック）
```

> ドキュメント3層: **CLAUDE.md＝開発ルール** / **SPEC.md＝技術仕様・運用** / **README.md＝デザイン・概要**。記事の編集方針は `prompts/generate-articles.md`。

---

## 4. データスキーマ（`data/articles.json` の1要素）

```jsonc
{
  "slug": "20260613-09",            // YYYYMMDD-連番（最大連番+1で採番）
  "headline": "…",                  // 日本語見出し（40字以内）
  "lead": "…",                      // 要点1文（80字以内）
  "body_markdown": "…",             // 本文（Markdown・400〜800字）
  "tags": ["…"],                    // 日本語タグ 3〜5個
  "section": "基盤モデル",            // セクション
  "source": "OpenAI",               // 出典名
  "link": "https://…",              // 出典URL（冪等キー）
  "importance": 4,                  // 重要度 1〜5（編集序列に使用）
  "image_query": "data center servers", // Claude が決めた画像検索ワード（内容準拠）
  "image": { "imageUrl": "…", "photographer": "…", "profileUrl": "…", "provider": "unsplash" },
                                    // 画像が無い場合は { "fallbackThumb": "thumb--blue" }
  "mode": "full",
  "createdAt": "2026-06-13T03:29:00.000Z"
}
```

---

## 5. 編集方針（エディトリアルポリシー）

| 項目 | 内容 | 関連設定 |
|---|---|---|
| 一次情報優先 | フィードを `tier`（primary=企業公式 / media=報道）で区別。候補は primary を上位に。media の主張は Claude が WebSearch で裏取り。 | `config.rssFeeds[].tier` |
| 重要度で選別 | Claude が候補を 1〜5 で採点し、閾値以上のみ・1回最大N本を掲載。類似トピックは1本に統合。 | `importanceFloor`=3, `maxArticles`=2 |
| 重要度で序列 | ヒーロー大見出し／カード／人気記事を重要度順（同点は新しい順）に配置。「最新記事」のみ時系列。 | `render.js: importanceThenRecency` |
| AI関連度フィルタ | media tier 候補は `aiKeywords` のヒット数が閾値未満なら除外（primary 公式は常に通す）。 | `aiKeywords`, `relevanceFloorMedia`=1 |
| 関連記事 | 「あわせて読みたい」はタグ共有×3＋同セクション×2 でスコアし上位3件。不足は重要度で補完。 | `render.js: relatedFor` |
| 保持とアーカイブ | トップは最新 N 本。超過分は `archive.html`（月別一覧）へ。記事HTMLは全保持。 | `retentionTop`=40 |
| 掲載数 | 1回最大2本 × 1日3回 = 約6本/日。重要なものが無い回は載せない。 | `maxArticles`, スケジュール |

重要度ルブリック: 5=業界を変える重大発表 / 4=主要企業の新製品・大型調達・注目研究 / 3=標準 / 1〜2=些末（掲載しない）。

---

## 6. 画像処理（取得・帰属・フォールバック）

> **AI 画像生成は行わない。** 記事に合う写真を**フリー素材 API（Unsplash）から取得**して表示する。
> DALL·E / Imagen 等の従量課金や、ローカル Stable Diffusion は使わない。

処理は `src/fetchImage.js`（`ingestDrafts.js` から記事ごとに呼ばれる）:

1. **キーワード生成** — 検索ワードは次の優先順:
   - **①記事ごとの `image_query`**（最優先）— Claude が記事を読んで決めた英語の画像検索ワード（2〜4語）。
     内容を視覚的に表す具体的な被写体（例: `data center servers` / `rocket launch` / `programming code screen`）。
     ドラフトに含めさせ、記事レコードにも保存する（将来の再取得でも内容準拠を維持）。
   - **②簡易語彙マップ**（フォールバック）— `image_query` が無い記事は `tags`／見出しから推定。
   - **③既定** `artificial intelligence technology`。
2. **取得（候補30件）** — `imageProvider`（既定 Unsplash、無ければ Pexels）で landscape 写真を**最大30件**検索。
3. **重複回避** — 候補の中から**他記事で未使用の写真を選ぶ**。判定は `imageKey()`（URL から写真固有IDを抽出）。
   使用済みキーの `Set` を生成・バックフィル全体で共有し、既存記事とも突き合わせる。
   全件使用済みのときのみ index ベースで分散（最終手段は重複許容）。
4. **帰属** — 取得できたら `{ imageUrl, photographer, profileUrl, provider }` を記録し、
   **撮影者名＋プロフィールリンクを必ず表示**（Unsplash 規約準拠）。Unsplash はダウンロードトリガーを叩く（規約準拠）。
5. **フォールバック** — キー未設定・ヒット0・APIエラー時は `{ fallbackThumb: "thumb--blue" 等 }` を返し、
   CSS 抽象グラデーションサムネを表示（デザイン崩れゼロ）。

**表示箇所**（実写真＋帰属。無ければ CSS 抽象サムネにフォールバック）
- トップ: ヒーロー大画像＋注目カード（`templates/index.js` の `thumb()` / `credit()`）。
- 記事詳細: アイキャッチ＋「あわせて読みたい」関連カード（`templates/article.js` の `thumb()` / `credit()`）。
- ヒーロー横・最新一覧・人気記事・関連トピックタグ: テキストのみ（画像なし）。

**運用**
- 有効化: `.env` に `UNSPLASH_KEY`（または `PEXELS_KEY`）。Unsplash 無料 Demo は 50 req/h で 1日6記事に十分。
- 一括メンテ: `npm run backfill-images` — ①画像が無い記事に付与、②**他記事と重複している画像をユニークな写真へ差し替え**、の両方を行い再描画。
- 新規記事: 生成時に自動取得（`ingestDrafts.js` が使用済みキーを seed して `fetchImage` を呼ぶ → 既存記事と重複しない）。
- `.env` は git 管理外（キーは公開されない）。

---

## 7. 設定リファレンス（`src/config.js`）

| キー | 既定 | 説明 |
|---|---|---|
| `siteUrl` | 本番URL | 共有リンク・検索・canonical の絶対パス（`SITE_URL` で上書き可） |
| `siteName` / `siteDescription` | AXIOM AI / 紹介文 | OGP・JSON-LD・RSS で使用 |
| `ogImage` / `logo` | /assets/og-default.jpg / /assets/logo.png | 共通OG画像・publisher.logo の絶対パス基準 |
| `operator` | FlowMate / 滝本哲也 / 所在地 / contact@flowmate.jp | 運営者ページ・JSON-LD publisher の情報 |
| `maxArticles` | 2 | 1回に掲載する本数（`MAX_ARTICLES` 環境変数で上書き可） |
| `candidatePool` | 12 | Claude に提示する候補数 |
| `importanceFloor` | 3 | これ未満の重要度は掲載しない |
| `retentionTop` | 40 | トップ掲載の上限。超過分はアーカイブへ |
| `skipUrlPatterns` | 動画/音声系 | 取材に向かない弱いソースを除外 |
| `aiKeywords` | AI関連語44件 | media 候補のAI関連度判定に使うキーワード |
| `relevanceFloorMedia` | 1 | media 候補のキーワードヒットがこれ未満なら除外 |
| `rssFeeds` | AI系8フィード | `tier` 付き。一次情報3＋メディア5 |
| `imageProvider` / `*Key` | unsplash | 画像API（未設定なら CSS サムネ） |
| `analytics.token` | 空（`CF_BEACON_TOKEN`） | Cloudflare Web Analytics の beacon トークン。空なら出力しない |

---

## 7.5 フロント機能（コンテンツ・体験）

| 機能 | 概要 | 実装 |
|---|---|---|
| タグページ | `tags/<タグ>.html`（UTF-8名）と `tags/index.html`（件数で大小をつけるタグクラウド）。記事内タグ・パンくずから辿れる。 | `templates/tag.js`, `render.js` |
| 関連記事 | タグ／セクションの一致度で「あわせて読みたい」を選出。関連集合内で**被写体（`image_query` キーワード＋画像URL）を分散**させ、同種写真の並びを避ける（関連度は犠牲にしない＝無関係記事は混ぜない）。 | `render.js: relatedFor` / `pickDiverse` / `imgSig` |
| 重要度の視覚強調 | `importance>=4` の記事は等価グリッド（トップの注目カード・最新記事）で控えめなアクセント（カード上端のアクセント線／リストの区切り線をアクセント色）を付与し、スキャン性を上げる（von Restorff 効果）。位置による階層（hero→側→カード→時系列）は従来どおり。 | `templates/cardbits.js: priorityClass`, `index.js`, `styles.css`（`.is-priority`） |
| 記事体験 | 読了時間（≈400字/分）、公開時刻、機能する共有ボタン（X / はてブ / リンクコピー）。共有URLは `siteUrl` 基準の絶対パス。**読了プログレスバー**（本文 `.prose` のあるページに自動表示）。 | `templates/article.js`, `assets/reveal.js` |
| 奥行き・演出 | 影トークン（`--shadow-sm/md/lg`・ライト/ダークで濃淡）、紙の微細グレイン、ヒーローの極薄発光、カードの hover リフト＋画像ズーム、見出しの下線スライド、スクロールに応じた**段階リビール**。すべて `prefers-reduced-motion` で無効化。`js` クラスは `reveal.js` が付与するため **JS 無効/失敗でも本文・カードは常に表示**（プログレッシブエンハンスメント）。 | `assets/styles.css`（ENHANCEMENTS節）, `assets/reveal.js`, `layout.js` |
| アクセシビリティ・人間工学 | ダーク基調は**純黒×純白を避ける**（背景 `paper-0`=14%・本文 `ink-0`=93%で約16:1）ことでハレーションを低減。メタ／写真クレジットは `ink-2` で 5.9:1（WCAG AA 合格）。タップ領域はテーマトグル・ナビ各項目とも **44×44px 以上**。ティッカーは `prefers-reduced-motion` で停止＋**ホバー/フォーカスで一時停止**。 | `assets/styles.css`（TOKENS節・`.ticker`・`.theme-toggle`・`.site-nav`）, `templates/cardbits.js`・`article.js`（クレジット色） |
| ライト/ダーク | ヘッダーのトグルで切替。`<head>` のインラインJSが localStorage／OS設定から `data-theme` を paint 前に適用（フラッシュ防止）。 | `styles.css` の `[data-theme="light"]`, `layout.js` |
| サイト内検索 | `search-index.json` をクライアントで部分一致検索（見出し/タグ/セクション/リード重み付け、キーボード操作対応）。追加依存なし。 | `assets/search.js`, `render.js` |
| 画像最適化 | Unsplash 画像に配信パラメータ（`w/q/auto=format/fit=crop`）を付与＋`images.unsplash.com` を preconnect。CLS はサムネの `aspect-ratio` で抑制。 | `cardbits.js: optimizedUrl`, `layout.js` |
| アナリティクス | `CF_BEACON_TOKEN` 設定時のみ Cloudflare Web Analytics（Cookieless・無料）の beacon を全ページに出力。未設定なら無出力。 | `config.analytics`, `layout.js` |

---

## 8. 定期実行（launchd）

- ラベル: `com.axiom.generate`
- plist: `~/Library/LaunchAgents/com.axiom.generate.plist`
- スケジュール: 毎日 **6:00 / 12:00 / 18:00**
- 実行: `scripts/auto-generate.sh`（ollama 不要・claude CLI を使用）
- ログ: `data/scheduler.log`
- 健全性監視: 実行前後で `articles.json` の件数を比較。**異常終了・articles.json 破損・push 失敗・
  新規ゼロが3回連続**のとき macOS 通知（`osascript`）を出す。連続回数は `data/.health` に記録。
- **ソース変更ガード**: commit 前に `src/ templates/ scripts/ prompts/ package.json` の未コミット変更を検査し、
  あれば **auto-commit/push を中止して通知**する（作業途中コードが無人ジョブで自動公開される事故を防ぐ）。
  生成物・`data/` は対象外。クリーンな通常時のみ `git add -A` → commit → push する。

```sh
# 状態 / 停止 / 再開 / 即時実行
launchctl print  gui/$(id -u)/com.axiom.generate | grep -i state
launchctl bootout   gui/$(id -u) ~/Library/LaunchAgents/com.axiom.generate.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.axiom.generate.plist
launchctl kickstart -k gui/$(id -u)/com.axiom.generate
```

> Mac がスリープ中の時刻はスキップされ、起床後に1回だけ補完実行される（launchd 仕様）。

---

## 9. 手動操作

```sh
npm install                  # 依存導入（rss-parser / marked / dotenv）
npm run check                # 公開前ゲート（レンダー完走＋スキーマ/slug・link一意＋鍵混入チェック）
npm run candidates           # 候補だけ確認（data/_candidates.json）
zsh scripts/auto-generate.sh # 取材→執筆→反映まで全自動で1回
npm run render               # articles.json から再描画のみ
npm run backfill-images      # 既存記事の抽象サムネを実写真へ一括差し替え（要 UNSPLASH_KEY）
open index.html
```

> `npm run check` は一時ディレクトリへお試しレンダーするため**作業ツリーを汚さない**。手動で `git push`（=本番反映）する前に必ず実行する。開発時の規約は [CLAUDE.md](CLAUDE.md) を参照。

リセット: `data/articles.json` と `articles/*.html` を削除。

---

## 10. 前提・依存

- **claude**（Claude Code CLI）が認証済みであること。執筆はこれに依存（Anthropic サブスク内）。
- **Node.js 18+**（内蔵 `fetch` を使用）。依存は `rss-parser` / `marked` / `dotenv` のみ。
- 画像APIキー（任意）: `UNSPLASH_KEY` / `PEXELS_KEY` を `.env` に。未設定でも CSS 抽象サムネで動作。

---

## 11. 設計上の既知事項

- **claude CLI 認証が切れると定期ジョブは失敗する**。`data/scheduler.log` を時々確認する。
- 記事の正本は `data/articles.json`。HTML はそこからの派生（いつでも `npm run render` で再生成可能）。
- **コード改善はブランチで**: 自動ジョブの `git push origin main` は `main` 上の未 push コミットも一緒に送るため、
  WIP を `main` に直コミットすると次の自動実行で本番へ出る。改善・機能追加は作業ブランチで行い、検証後に `main` へマージする（[CLAUDE.md](CLAUDE.md) §2）。
- `makeSlug` は「同日最大連番+1」方式（削除で欠番が出ても衝突しない）。
- zsh の `$status` は読取専用のため、シェルスクリプトでは別名（`rc`）を使う。
- **再描画は非決定的**: `feed.xml` の `lastBuildDate` と `sitemap.xml` の `lastmod` が毎回更新されるため、
  内容が同じでも `npm run render` のたびに差分が出る（＝差分＝変更ではない）。`npm run check` は
  この性質を踏まえ「2回描画して diff 空」方式は採らず、一時dirへの描画完走で健全性を判定する。
- **ナビ**: ヘッダー各タブは `config.navSections` から `sections/<slug>.html` を生成・リンク（`render.js`）。
  記事0のセクションも空状態ページを生成する。記事のパンくず／タグはセクション・タグページへリンク済み。
  **フッターは実ページ（運営者情報/編集方針/お問い合わせ/プライバシー/利用規約/免責/RSS）へ接続済み**。
- **未実装機能の扱い**: バックエンドが無いため、ログイン・メール購読・メルマガUIは**設置しない**（「準備中」アラートも撤去済み）。
  記事の購読は **RSS（`feed.xml`）** で提供。`feed.xml` は XSL（`feed.xsl`）でブラウザ表示時は読み物化、リーダーには通常のRSSとして機能。
- **広告**: 空の広告プレースホルダは撤去済み。AdSense 等を導入する際に枠を追加する（プライバシーポリシーは Cookie 利用に言及済み）。
- **SEO（P0・実装済み）**: OGP / Twitter Card / canonical / JSON-LD（NewsArticle・WebSite・Organization）/
  sitemap.xml / robots.txt / RSSフィード（feed.xml＋feed.xsl）を出力。共通OG画像 `assets/og-default.jpg`。
- **アナリティクス**: Cloudflare Web Analytics を導入済み（`.env` の `CF_BEACON_TOKEN`）。トークンは公開前提の値で、
  HTML（=デプロイ物）に埋め込まれる。`.env` 自体は git 管理外。
