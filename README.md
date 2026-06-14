# AXIOM AI — デザインプロトタイプ

Bloomberg / FT 系を参照した、上品で信頼感のある近未来的 AI ニュースサイトのデザインプロトタイプ。

スタンドアロン HTML/CSS、依存ゼロ、ブラウザでファイルを開くだけで動きます。

---

## ファイル構成

```
AIニュースサイト/
├── index.html           # トップ（記事一覧）
├── article.html         # 記事詳細
├── assets/
│   └── styles.css       # 全スタイル + デザイントークン
└── .hallmark/log.json   # 次回 Hallmark 実行時の多様化メモリ
```

## 開く

```sh
open index.html
```

トップから記事タイトルをクリックすると `article.html` に遷移します。

---

## デザインシステム

### カラー（OKLCH）

| トークン | 用途 | 値 |
|---|---|---|
| `--color-paper-0` | ページ背景 | `oklch(11% 0.012 250)` — 深いネイビーブラック |
| `--color-paper-1` | カード／サイドバー | `oklch(14% 0.014 250)` |
| `--color-ink-0` | 本文 | `oklch(96% 0.006 85)` — 暖かいオフホワイト |
| `--color-ink-2` | メタ情報 | `oklch(58% 0.008 85)` |
| `--color-accent` | 電子インク・ブルー | `oklch(78% 0.15 220)` |
| `--color-accent-warm` | Bloomberg 風ゴールド | `oklch(75% 0.16 65)` |
| `--color-breaking` | 速報レッド | `oklch(63% 0.22 25)` |

### タイポグラフィ（全て Google Fonts・商用無料）

| 役割 | フォント |
|---|---|
| 見出し（Display） | **Fraunces**（可変フォント、イタリックの表情が美しい） |
| 本文（Body） | **Inter**（日本語フォールバック: Hiragino Kaku Gothic ProN, Yu Gothic） |
| メタ・データ（Mono） | **IBM Plex Mono**（タイムスタンプ、ティッカー、ラベル等） |

### スペーシング

4pt スケール、`--space-2xs` (4px) ～ `--space-5xl` (128px) を意味的に命名。

---

## 画像戦略（著作権リスク回避）

**Unsplash の無料素材 API** から記事に合う実写真を1枚取得し、撮影者名＋プロフィールリンクの
**帰属表記付き**で、トップのヒーロー／カードと記事詳細に表示する（Unsplash 規約準拠）。
`.env` に `UNSPLASH_KEY` を設定すると有効。**未設定・検索ヒット0の場合は OKLCH グラデーションの
抽象サムネ**（`.thumb--blue` 等）に自動フォールバックするため、キー無しでもデザインは崩れない。

- ニュース画像の転載はしない（実写真は Unsplash の商用利用可・帰属付き素材のみ）。
- AI 画像生成（DALL·E / Imagen 等の従量課金サービス）は使用しない。
- 既存記事への一括付与は `npm run backfill-images`。

---

## 広告枠の組み込み

AdSense 等の広告ネットワークを後付けしてもレイアウトが崩れないよう、最初から自然な位置にプレースホルダ（破線枠＋IAB標準サイズ）を配置しています。

### トップ

| 位置 | サイズ |
|---|---|
| ヒーロー直下 | 970 × 90 リーダーボード |
| サイドバー上部 | 300 × 250 レクタングル |

### 記事詳細

| 位置 | サイズ |
|---|---|
| 本文中盤 | 970 × 250 インライン |
| 右サイドバー | 300 × 250 |

---

## レスポンシブ

- 1100px 以上: 3 カラム（本文 7 ＋ 左 2 ＋ 右 3）
- 768px 〜 1100px: 2 カラム（サイドバーが下に）
- 〜 768px: シングルカラム、ナビは横スクロール対応

ブラウザ DevTools で 375 / 768 / 1280 / 1920 px を確認してください。

---

## アクセシビリティ

- WCAG AA 準拠コントラスト（ダーク背景に対し ink-0 = 96% lightness）
- 全インタラクティブ要素に `:focus-visible` リング（コントラスト 3:1 以上）
- `prefers-reduced-motion: reduce` でティッカーアニメ・パルスを停止
- セマンティック HTML（`<main>` / `<aside>` / `<article>` / `<nav>` / `aria-label`）

---

## 自動生成パイプライン（実装済み）

ニュース取得 → 記事執筆 → 画像付与 → サイト生成を、**ヘッドレス Claude Code** が自動化する。
launchd が `claude --dangerously-skip-permissions -p` でヘッドレス起動し、Claude 自身が
**元記事を WebFetch で読み、数値を WebSearch で裏取りしながら**忠実な日本語短評を執筆する。
APIキー不要（Anthropic サブスク内）。画像は無料素材 API（未設定でも CSS 抽象サムネ）。
サイト側コードに LLM 呼び出しは無い（執筆者は Claude 自身）。

```
launchd → scripts/auto-generate.sh
  → claude -p prompts/generate-articles.md
       ① node src/fetchCandidates.js  … 新着候補を data/_candidates.json へ
       ② 各候補を WebFetch/WebSearch で取材 → data/_drafts.json へ下書き
       ③ node src/ingestDrafts.js      … slug採番/画像/重複排除/保存/再生成
```

### 前提
- `claude`（Claude Code CLI）が認証済みで使えること。
- Node.js 18+（内蔵 `fetch` を使用）。`npm install` で依存を導入。

### 手動実行

```sh
npm run candidates           # 候補だけ確認（data/_candidates.json）
zsh scripts/auto-generate.sh # 取材→執筆→反映まで全自動で1回
npm run render               # articles.json から index/archive/記事ページを再生成のみ
open index.html
```

### 設計のポイント

- **記事はアグリゲーター型の短評**（全文リライトではない）。Claude が元記事を読み、
  「短い独自要約＋論評＋目立つ出典リンク」を生成 → 著作権リスクと事実誤りを同時に抑制。
- **冪等**：処理済み `link` は再生成しない。`data/articles.json` が蓄積され、走らせるほど記事が増える。
- リセットしたい場合は `data/articles.json` と `articles/*.html` を削除。

### 編集方針（エディトリアルポリシー）

機械的に全部載せるのではなく、編集判断を加えている:

- **一次情報優先** — 各フィードに `tier`（`primary`=企業公式 / `media`=報道）。候補は primary を上位に並べ、
  ヘッドレス Claude が media の主張を WebSearch で裏取りしてから採用する（`src/config.js` の `rssFeeds`）。
- **重要度で選別＋序列化** — Claude が候補を重要度 1〜5 で採点し、`importanceFloor`(3) 以上だけを
  1回 `maxArticles`(2) 本まで掲載（＝1日6本前後）。重要なものが無い回は載せない。類似トピックは1本に統合。
- **重要度で配置** — `render.js` がトップのヒーロー大見出し／カード／人気記事を重要度順に並べる
  （`importanceThenRecency`）。「最新記事」リストのみ時系列。
- **保持とアーカイブ** — トップは最新 `retentionTop`(40) 本まで。超過分は `archive.html`（月別一覧）へ。記事HTMLは全保持。

### 主な設定（`src/config.js`）

| 項目 | 既定 | 説明 |
|---|---|---|
| `maxArticles` | 2 | 1 回に掲載する本数（×3回/日 = 6本）。`MAX_ARTICLES` で上書き可 |
| `candidatePool` | 12 | Claude に提示する候補数（この中から重要度で選別） |
| `importanceFloor` | 3 | 重要度がこれ未満の候補は掲載しない |
| `retentionTop` | 40 | トップ掲載の上限。超過分は `archive.html` へ |
| `rssFeeds` | AI 系 8 フィード（`tier`付き） | 一次情報/メディアの別。増減はここで編集 |
| `imageProvider` | `unsplash` | `unsplash` / `pexels`（キー未設定なら CSS サムネ） |

### 定期実行（設定済み）

`~/Library/LaunchAgents/com.axiom.generate.plist` を登録済みで、**毎日 6:00 / 12:00 / 18:00** に
`scripts/auto-generate.sh`（＝ヘッドレス Claude 方式）が自走する。ログは `data/scheduler.log`。

```sh
# 状態確認 / 一時停止 / 再開 / 即時実行
launchctl print  gui/$(id -u)/com.axiom.generate | grep -i state
launchctl bootout   gui/$(id -u) ~/Library/LaunchAgents/com.axiom.generate.plist   # 停止
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.axiom.generate.plist   # 再開
launchctl kickstart -k gui/$(id -u)/com.axiom.generate                            # 今すぐ1回
```

---

## 機能（コンテンツ・体験・運用）

- **関連記事**: タグ／セクションの一致度でスコアリングして提示（`src/render.js` の `relatedFor`）。
- **タグページ**: `tags/<タグ>.html` を自動生成、`tags/index.html` はタグクラウド。記事内タグから辿れる。
- **AI 関連度フィルタ**: media 系 RSS の AI 無関係記事を `config.aiKeywords` で足切り（公式 primary は常に通す）。
- **記事体験**: 読了時間の目安、公開時刻、機能する共有ボタン（X / はてブ / リンクコピー）。
- **ライト／ダークテーマ**: ヘッダーのトグルで切替（OS 設定に追従、localStorage で保持）。
- **サイト内検索**: 静的（追加依存ゼロ）。`search-index.json` をクライアントで部分一致検索。
- **画像最適化**: Unsplash 画像に配信パラメータを付与＋ `images.unsplash.com` を preconnect（CWV 改善）。
- **パイプライン監視**: `scripts/auto-generate.sh` が異常終了・push 失敗・新規ゼロ連続を検知して macOS 通知。
- **アナリティクス（任意）**: `.env` に `CF_BEACON_TOKEN` を設定すると Cloudflare Web Analytics（Cookieless）を出力。未設定なら無効。
- **SEO**: 全ページに OGP / Twitter Card / canonical / JSON-LD（NewsArticle・WebSite・Organization）。`sitemap.xml` / `robots.txt` / `feed.xml`（RSS）を生成。共通OG画像 `assets/og-default.jpg`。
- **法的・運営ページ**: 運営者情報 / お問い合わせ / プライバシーポリシー / 利用規約 / 編集方針 / 免責事項を生成し、フッターに接続。

## 今後の発展（任意）

1. **Astro + Cloudflare Pages** へ移植（無料枠で十分）
2. **Google Search Console** に `sitemap.xml` を登録してインデックスを促進
3. **AdSense 申請**（運営者情報・プライバシー・お問い合わせページは実装済み）

---

## ライセンス

このプロトタイプのコードは自由に改変してください。Google Fonts（Fraunces / Inter / IBM Plex Mono）は SIL Open Font License（商用利用可）。
